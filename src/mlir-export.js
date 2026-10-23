import { assertValidMLIR, validateMLIRText } from './mlir-validate.js';

const opName = op => op.name.getStringRef();
const valueName = value => {
    if (value.modelLensSSAName) return value.modelLensSSAName;
    const group = value.owner?.results;
    if (group?.length > 1 && group.every((item,i)=>item.name === group[0].name+(i ? `.${i}` : ''))) return `${group[0].name}#${value.resultNumber}`;
    return value.name || value.value;
};
const inside = (range, ranges) => ranges.some(([start,end])=>range[0]>=start && range[1]<=end);

// Slice the parsed source, never serialize the lossy display model. Only external
// SSA uses are renamed, at parser-recorded locations (including nested regions).
export async function exportMLIR(index, graphIndex, nodeIndices, {progress=()=>{}}={}) {
    if (!index?.capabilities?.mlirExport || !index.mlir) throw new Error('目前模型不支援匯出 MLIR。');
    const { source, info, graphs, metadata } = index.mlir;
    const graph = graphs[graphIndex];
    if (!graph) throw new Error('找不到目前 MLIR scope。');
    if (!Array.isArray(nodeIndices) || !nodeIndices.length || nodeIndices.length>32 || nodeIndices.some(i=>!Number.isInteger(i) || !graph.operations[i])) throw new Error('請選取 1～32 個同一 scope 的 layers。');
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
    const text = `// Model Lens extracted SSA subgraph. External values are function arguments.\n${aliases}\n"builtin.module"() ({\n  "func.func"() <{sym_name = "extracted", function_type = (${inputTypes}) -> (${outputTypes})}> ({\n  ^bb0(${args}):\n    ${snippets.join('\n    ')}${terminator}\n  }) : () -> ()\n}) : () -> ()\n${resources}\n`;
    progress('在本機檢查匯出 MLIR 的語法與 SSA 連線…');
    const validation=await validateMLIRText(text,{metadata});
    return { blob: new Blob([text], { type: 'text/plain;charset=utf-8' }), layers: selected.length, inputs, outputs, validation };
}
