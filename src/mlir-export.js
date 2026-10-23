import { assertValidMLIR, validateMLIRText } from './mlir-validate.js?v=6f69f7d6ff83cad0';

const opName = op => op.name.getStringRef();
const valueName = value => {
    if (value.modelLensSSAName) return value.modelLensSSAName;
    const group = value.owner?.results;
    if (group?.length > 1 && group.every((item,i)=>item.name === group[0].name+(i ? `.${i}` : ''))) return `${group[0].name}#${value.resultNumber}`;
    return value.name || value.value;
};
const inside = (range, ranges) => ranges.some(([start,end])=>range[0]>=start && range[1]<=end);
const functionFor = (index,graph) => {
    let row=index.mlir.ir.byBlock.get(graph?.block)?.owner;
    while(row && opName(row.op)!=='func.func')row=row.parent;
    return row?.op;
};

// Slice the parsed source, never serialize the lossy display model. Only external
// SSA uses are renamed, at parser-recorded locations (including nested regions).
export async function exportMLIR(index, graphIndex, nodeIndices, {progress=()=>{},scope='auto',selections}={}) {
    if (!index?.capabilities?.mlirExport || !index.mlir) throw new Error('目前模型不支援匯出 MLIR。');
    const { source, info, graphs, metadata } = index.mlir;
    if(!['auto','function','slice'].includes(scope))throw new Error('未知的 MLIR 匯出範圍。');
    if(scope==='slice' && (selections?.length>1 || graphs[graphIndex]?.cfgFunction)) {
        const {exportMLIRSlice}=await import('./mlir-slice.js?v=6f69f7d6ff83cad0');
        return exportMLIRSlice(index,selections || [{graph:graphIndex,nodes:nodeIndices}],{progress});
    }
    if(selections && (!Array.isArray(selections) || selections.some(s=>!s || !Array.isArray(s.nodes) || !s.nodes.length || s.nodes.some(n=>!Number.isInteger(n) || !graphs[s.graph]?.operations[n]) || functionFor(index,graphs[s.graph])!==functionFor(index,graphs[graphIndex]))))throw new Error('完整 function 匯出需選取同一個 function 的有效 layers。');
    const graph = graphs[graphIndex];
    if (!graph) throw new Error('找不到目前 MLIR scope。');
    if (!Array.isArray(nodeIndices) || !nodeIndices.length || nodeIndices.length>32 || nodeIndices.some(i=>!Number.isInteger(i) || !graph.operations[i])) throw new Error('請選取 1～32 個同一 scope 的 layers。');
    if(scope==='function' && !graph.cfgFunction) {
        const owner=index.mlir.ir.byOp.get(functionFor(index,graph));
        if(!owner)throw new Error('此 scope 不在 func.func 內，請選擇局部選取。');
        const blocks=index.mlir.ir.regions.filter(r=>r.owner?.context===owner.context).reduce((n,r)=>n+r.blocks.length,0);
        return exportControlFlow(index,graphIndex,{...graph,cfgFunction:owner.op,cfgExport:{blocks,function:owner.op.getAttr('sym_name')?.value || 'function'}},progress);
    }
    if (graph.cfgFunction) return exportControlFlow(index,graphIndex,graph,progress);
    let enclosing=index.mlir.ir.byBlock.get(graph.block);
    while(enclosing) {
        if(enclosing.blocks.length>1) throw new Error('此多 block region 不在 func.func 內；請回到上層 scope，選取擁有此 region 的 operation，才能保留完整控制流程。');
        enclosing=enclosing.parent;
    }
    const selected = [...new Set(nodeIndices)].sort((a,b)=>a-b).map(i=>graph.operations[i]);
    const ranges = selected.map(op=>info.operations.get(op));
    if (ranges.some(range=>!range)) throw new Error('缺少 MLIR 原始文字範圍，無法安全匯出。');
    if (selected.some(op=>op.successors?.length || /\.(yield|br|cond_br|switch)$/.test(opName(op)))) throw new Error('選取內容包含跨 block 分支或 region terminator；請只選取該 block 內的資料流 operations。');
    if (info.symbols.some(range=>inside(range,ranges))) throw new Error('選取內容含 symbol reference；目前無法一併擷取外部 symbol 定義。請先將呼叫內聯後再匯出。');
    progress('在本機檢查來源 MLIR 的 SSA 定義、型別與 scope…');
    assertValidMLIR(index,{graphIndex});

    const local = new Set();
    const walk = op => {
        for (const result of op.results || []) local.add(result);
        for (const region of op.regions || []) for (const block of region.blocks || []) {
            for (const arg of block.arguments || []) local.add(arg);
            for (const child of block.operations || []) walk(child);
        }
    };
    selected.forEach(walk);
    const uses = info.uses.filter(use=>inside(use.range,ranges));
    const external = [...new Set(uses.map(use=>use.value).filter(value=>!local.has(value)))];
    let prefix = '%ml_input_';
    while (source.includes(prefix)) prefix = `%_${prefix.slice(1)}`;
    const names = new Map(external.map((value,i)=>[value,`${prefix}${i}`]));
    const typeText = value => {
        const range = info.types.get(value.type);
        if (!range) throw new Error(`無法保留 ${valueName(value)} 的原始 MLIR 型別，已停止匯出。`);
        return source.slice(...range);
    };
    const inputs = external.map(value=>({ name: valueName(value), argument: names.get(value), type: typeText(value) }));
    const returns = selected.filter(op=>opName(op)==='func.return');
    const outputValues = selected.flatMap(op=>op.results || []).filter(value=> {
        const users = info.uses.filter(use=>use.value===value);
        return !users.length || users.some(use=>!inside(use.range,ranges));
    });
    if (returns.length) {
        if (returns.length!==1 || selected.at(-1)!==returns[0] || outputValues.some(value=>!returns[0].operands.includes(value))) throw new Error('選取的 func.return 不涵蓋全部子圖輸出；請取消選取 return，讓匯出器建立新的回傳邊界。');
        outputValues.splice(0,outputValues.length,...returns[0].operands);
    }
    const outputs = outputValues.map(value=>({ name: valueName(value), value: names.get(value) || valueName(value), type: typeText(value) }));
    const snippets = ranges.map(([start,end])=> {
        let snippet = source.slice(start,end);
        const edits = uses.filter(use=>names.has(use.value) && use.range[0]>=start && use.range[1]<=end).sort((a,b)=>b.range[0]-a.range[0]);
        for (const use of edits) snippet = snippet.slice(0,use.range[0]-start)+names.get(use.value)+snippet.slice(use.range[1]-start);
        return snippet;
    });
    const aliases = info.declarations.map(range=>source.slice(...range)).join('\n');
    const resources = info.resources.map(range=>source.slice(...range)).join('\n');
    const inputTypes = inputs.map(input=>input.type).join(', ');
    const outputTypes = outputs.map(output=>output.type).join(', ');
    const args = inputs.map(input=>`${input.argument}: ${input.type}`).join(', ');
    const terminator = returns.length ? '' : `\n    "func.return"(${outputs.map(output=>output.value).join(', ')}) : (${outputTypes}) -> ()`;
    const intro=`// Model Lens extracted SSA subgraph. External values are function arguments.\n${aliases}\n"builtin.module"() ({\n  "func.func"() <{sym_name = "extracted", function_type = (${inputTypes}) -> (${outputTypes})}>`;
    const body=`${intro} ({\n  ^bb0(${args}):\n    ${snippets.join('\n    ')}${terminator}\n  })`;
    let text=`${body} : () -> ()\n}) : () -> ()\n${resources}\n`;
    const {attachSlicePattern}=await import('./mlir-pattern-projection.js?v=6f69f7d6ff83cad0');
    text=await attachSlicePattern(index,index.mlir.ir.byBlock.get(graph.block),text,body.length,{selected:new Set(selected),blocks:new Map([[graph.block,0]]),operators:new Map(selected.map((op,i)=>[op,i])),arguments:new Map((graph.block.arguments || []).filter(v=>names.has(v)).map(v=>[v,external.indexOf(v)]))});
    progress('在本機檢查匯出 MLIR 的語法與 SSA 連線…');
    const validation=await validateMLIRText(text,{metadata,dialects:index.mlir.dialects});
    return { blob: new Blob([text], { type: 'text/plain;charset=utf-8' }), layers: selected.length, inputs, outputs, validation };
}

// Cutting a branch or a phi-like block argument independently changes program
// semantics. Preserve the entire enclosing function, verbatim, instead.
async function exportControlFlow(index,graphIndex,graph,progress) {
    const {source,info,metadata,dialects,ir}=index.mlir,op=graph.cfgFunction;
    const range=info.operations.get(op);
    if(!range) throw new Error('缺少 function 原文範圍，無法保留控制流程。');
    progress('在本機檢查來源 MLIR 的 CFG、SSA 與 dominance…');
    assertValidMLIR(index,{graphIndex});
    if(info.symbols.some(span=>inside(span,[range]))) throw new Error('Function 含 symbol reference；尚未擷取外部 symbol dependencies，已停止匯出。');
    const aliases=info.declarations.map(span=>source.slice(...span)).join('\n');
    const resources=info.resources.map(span=>source.slice(...span)).join('\n');
    const text=`// Model Lens CFG export: complete enclosing function; branches and block arguments preserved.\n${aliases}\n"builtin.module"() ({\n${source.slice(...range)}\n}) : () -> ()\n${resources}\n`;
    progress('在本機重新檢查匯出 MLIR 的 CFG、SSA 與 dominance…');
    const validation=await validateMLIRText(text,{metadata,dialects});
    const attr=op.getAttr('function_type'),signature=attr?.value || attr?.type;
    const inputs=(op.regions[0].blocks[0].arguments || []).map(value=>({name:valueName(value)}));
    const outputs=(signature?.results || []).map((type,i)=>({name:`result ${i}`}));
    const context=ir.byOp.get(op).context,layers=ir.rows.filter(row=>row.context===context && row.op!==op).length;
    return {blob:new Blob([text],{type:'text/plain;charset=utf-8'}),layers,inputs,outputs,validation,controlFlow:graph.cfgExport};
}
