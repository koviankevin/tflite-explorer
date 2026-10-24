import {assertValidMLIR,validateMLIRText} from './mlir-validate.js?v=48cf132f532c0b5d';
import {operationSemantics} from './mlir-dialects.js?v=48cf132f532c0b5d';
import {buildDominance,opName} from './mlir-ir.js?v=48cf132f532c0b5d';
import {typeSpelling} from './mlir-engine.js?v=48cf132f532c0b5d';
import {slicePatternGraph} from './mlir-pattern-projection.js?v=48cf132f532c0b5d';

// A CFG slice is a new function contract. Keep execution routes, cut ordinary
// data dependencies into inputs, and retain cyclic producers that must change
// on each iteration. Never invent a value for an untaken branch.
export async function exportMLIRSlice(index,selections,{progress=()=>{}}={}) {
    const {source,info,ir,graphs,metadata,dialects}=index.mlir;
    if(!Array.isArray(selections) || !selections.length)throw new Error('請選取至少一個 layer。');
    const selected=new Set();let func;
    for(const {graph,nodes} of selections) {
        const g=graphs[graph];
        if(!g?.cfgFunction || !Array.isArray(nodes) || !nodes.length || nodes.some(n=>!Number.isInteger(n) || !g.operations[n]))throw new Error('局部控制流程匯出的 block／layer 無效。');
        if(func && func!==g.cfgFunction)throw new Error('局部控制流程匯出必須位於同一個 function。');
        func=g.cfgFunction;
        for(const n of nodes)selected.add(g.operations[n]);
    }
    if(selected.size>32)throw new Error('局部匯出最多選取 32 個 layers。');
    const region=ir.byOp.get(func)?.op.regions?.[0],blocks=region?.blocks;
    if(!blocks?.length || func.regions.length!==1)throw new Error('局部匯出需要具有單一 body region 的 func.func。');
    const regionInfo=ir.byBlock.get(blocks[0]);
    const projection=slicePatternGraph(index,regionInfo);
    if([...selected].some(op=>ir.byOp.get(op)?.region!==regionInfo))throw new Error('局部控制流程匯出目前需圈選 function body 的 layers；巢狀 region 請選取其上層 operation，或改用完整 function。');
    if(blocks.length>4096)throw new Error('局部控制流程匯出最多處理 4096 個 blocks；請先縮小 function。');
    progress('檢查來源的 SSA、dominance 與控制流程…');
    assertValidMLIR(index,{graphIndex:selections[0].graph});
    let prefix='%ml_slice_';while(source.includes(prefix))prefix=`%_${prefix.slice(1)}`;
    const blockNumbers=new Map(blocks.map((b,i)=>[b,i]));
    const id=s=>`${prefix}${s}`,label=b=>`^${prefix.slice(1)}b${blockNumbers.get(b)}`;
    const type=v=>{
        const t=ir.definitions.get(v)?.type || v.type,range=info.types.get(t);
        if(!range)throw new Error('缺少原始 SSA 型別，無法建立局部匯出介面。');
        return source.slice(...range);
    };
    const name=v=>v.modelLensSSAName || (ir.definitions.get(v) ? `${ir.definitions.get(v).name}${ir.definitions.get(v).number ? `#${ir.definitions.get(v).number}`:''}` : v.name);
    const byLabel=new Map(blocks.map(b=>[b.name,b])),successors=new Map(),branches=new Map(),incoming=new Map(blocks.map(b=>[b,[]]));
    const exits=[];
    for(const b of blocks) {
        const op=b.operations.at(-1),sem=operationSemantics(op,dialects),uses=ir.byOp.get(op).uses;
        if(opName(op)==='func.return') {exits.push(b);successors.set(b,[]);continue;}
        if(!sem.branch || !op.successors?.length)throw new Error(`局部匯出無法重建 ${opName(op)}；請使用已支援的 branch／func.return，或改用完整 function。`);
        const targets=op.successors.map(s=>byLabel.get(s.label || s.name));
        const groups=sem.successorOperands({op,uses,typeOf:typeSpelling});
        const transferred=new Set(groups.flat()),conditions=uses.filter(u=>!transferred.has(u));
        if(!['cf.br','cf.cond_br','cf.switch'].includes(opName(op)) && typeof sem.exportBranch!=='function')throw new Error(`${opName(op)} 的 dialect adapter 尚未提供 exportBranch；無法安全重寫局部 CFG。可改用完整 function。`);
        branches.set(b,{op,sem,groups,conditions,targets});successors.set(b,targets);
        targets.forEach((target,i)=>incoming.get(target).push({block:b,uses:groups[i]}));
    }
    if(!exits.length)throw new Error('此 function 沒有可回傳的出口，無法建立局部匯出介面。');
    const dominance=buildDominance(blocks,successors),reachable=dominance.reachable;
    if([...selected].some(op=>!reachable.has(ir.byOp.get(op).block)))throw new Error('選取包含從 function entry 無法到達的 block，無法建立可執行的局部匯出。');
    let liveBlocks=blocks.filter(b=>reachable.has(b));
    const liveExits=exits.filter(b=>reachable.has(b));
    if(!liveExits.length)throw new Error('此 function 沒有從 entry 可到達的回傳出口；請改用完整 function。');
    const cyclic=cyclicBlocks(liveBlocks,successors),retained=new Set(),locals=new Set(),usesByOp=new Map(),neededArgs=new Set(),neededValues=new Set(),queue=[];
    const need=v=>{if(!neededValues.has(v)){neededValues.add(v);queue.push(v);}};
    const keep=op=>{
        if(retained.has(op))return;retained.add(op);
        const stack=[op],uses=[];
        while(stack.length) {
            const child=stack.pop();for(const v of child.results || [])locals.add(v);
            for(const use of ir.byOp.get(child).uses)uses.push(use);
            for(const r of child.regions || [])for(const b of r.blocks || []){for(const a of b.arguments || [])locals.add(a);for(const op of b.operations)stack.push(op);}
        }
        usesByOp.set(op,uses);uses.forEach(u=>need(u.value));
    };
    const selectedMembers=new Set(),walk=[...selected];
    while(walk.length){const op=walk.pop();selectedMembers.add(op);for(const r of op.regions || [])for(const b of r.blocks || [])for(const child of b.operations)walk.push(child);}
    const users=new Map();for(const row of ir.rows)for(const use of row.uses){if(!users.has(use.value))users.set(use.value,[]);users.get(use.value).push(row.op);}
    const originalReturns=new Map();
    for(const [i,n] of (projection?.nodes || []).entries())if(n.kind==='operator' && n.type==='func.return') {
        const b=blocks[projection.nodes[n.parent].block],op=b.operations[n.actualOp],uses=ir.byOp.get(op).uses;
        if(!selected.has(op))continue;
        let logical=n.returnOperands?.map(port=>uses[port]);
        if(!logical) {
            logical=Array.from({length:n.inputs});
            for(const e of projection.edges)if(e.to===i && e.kind==='ssa') {
                const from=projection.nodes[e.from],block=blocks[projection.nodes[from.parent].block],[port,input]=e.port.split(':').map(Number);
                const value=from.kind==='operator'?block.operations[from.actualOp].results[port]:from.actualSlot===null?null:block.arguments[from.actualSlot];
                const use=value && uses.find(u=>u.value===value);if(use)logical[input]=use;
            }
            if(logical.some(u=>!u)) {
                if(uses.length===n.inputs)logical=uses;
                else throw new Error('此舊版局部 MLIR 缺少原始 return 的輸出對照；請從原模型重新匯出，或使用完整 function。');
            }
        }
        originalReturns.set(op,logical);
    }
    const outputs=[];
    for(const b of blocks)for(const op of b.operations)if(selected.has(op)) {
        const sem=operationSemantics(op,dialects);
        if(!sem.terminator) {
            keep(op);
            for(const v of op.results || [])if(!users.get(v)?.length || users.get(v).some(user=>!selectedMembers.has(user)))outputs.push({value:v,block:b});
        } else if(opName(op)==='func.return')for(const [returnPort,use] of (originalReturns.get(op) || ir.byOp.get(op).uses).entries())outputs.push({value:use.value,block:b,returnOp:op,returnPort});
    }
    if(outputs.length>128)throw new Error('局部匯出最多保留 128 個輸出。');
    for(const output of outputs)need(output.value);
    for(const b of liveBlocks)for(const use of branches.get(b)?.conditions || [])need(use.value);
    // Worklist propagates only live block arguments. A cyclic definition cannot
    // be hoisted into a once-per-call input without freezing loop state.
    for(let i=0;i<queue.length;i++) {
        const v=queue[i];if(locals.has(v))continue;
        const def=ir.definitions.get(v);if(!def)throw new Error('SSA 輸入找不到來源定義。');
        if(def.region!==regionInfo)throw new Error('局部 CFG 使用了不同 region 的 SSA 值，請擴大到上層 operation。');
        if(def.order===-1) {
            neededArgs.add(v);
            const slot=def.block.arguments.indexOf(v);
            for(const edge of incoming.get(def.block))if(reachable.has(edge.block))need(edge.uses[slot].value);
        } else if(cyclic.has(def.block))keep(def.row.op);
    }
    // Rebuild the ABI once, rather than wrapping every previous ABI entry.
    // Only a checked source projection can identify exporter-added blocks.
    // Preserve all original blocks, selected helpers, computations and joins.
    const removedEntries=new Set();
    const originalBlocks=new Set(projection?.nodes.filter(n=>n.kind==='block').map(n=>blocks[n.block]));
    let entryBlock=blocks[0];
    if(projection)while(!originalBlocks.has(entryBlock)) {
        const branch=branches.get(entryBlock),ops=entryBlock.operations;
        if(!branch || opName(branch.op)!=='cf.br' || branch.targets.length!==1 || ops.some(op=>selected.has(op) || retained.has(op)) || ops.slice(0,-1).some(op=>opName(op)!=='arith.constant'))break;
        const next=branch.targets[0];
        if(next===entryBlock || removedEntries.has(next) || incoming.get(next).length!==1)break;
        removedEntries.add(entryBlock);entryBlock=next;
    }
    liveBlocks=liveBlocks.filter(b=>!removedEntries.has(b));
    const resolveRemoved=v=>{
        const seen=new Set();
        while(!seen.has(v)) {
            seen.add(v);const def=ir.definitions.get(v);
            if(def?.order!==-1 || !removedEntries.has(def.block) || def.block===blocks[0])break;
            v=incoming.get(def.block)[0].uses[def.block.arguments.indexOf(v)].value;
        }
        return v;
    };
    const ranges=[...retained,...liveBlocks.flatMap(b=>branches.has(b)?[branches.get(b).op]:[])].map(op=>info.operations.get(op));
    if(ranges.some(r=>!r))throw new Error('缺少選取 operation 的原文，無法安全匯出。');
    if(info.symbols.some(([a,b])=>ranges.some(([s,e])=>a>=s && b<=e)))throw new Error('局部匯出包含外部 symbol reference；請先內聯，或使用完整 function。');
    const external=[...neededValues].filter(v=>!locals.has(v) && (!neededArgs.has(v) || ir.definitions.get(v).block===blocks[0]));
    const names=new Map(external.map((v,i)=>[v,id(`input_${i}`)]));
    for(const v of neededArgs)if(removedEntries.has(ir.definitions.get(v).block)) {
        const resolved=resolveRemoved(v);if(names.has(resolved))names.set(v,names.get(resolved));
    }
    const ref=v=>removedEntries.has(ir.definitions.get(v)?.block)?names.get(resolveRemoved(v)) || name(v):neededArgs.has(v)?name(v):names.get(v) || name(v);
    const inputRef=v=>names.get(v) || ref(v);
    const inputs=external.map(v=>({name:name(v),argument:names.get(v),type:type(v),role:'boundary'}));
    outputs.forEach((o,i)=>{o.index=i;o.type=type(o.value);o.conditional=liveExits.some(exit=>!dominance.dominates(o.block,exit));});
    const conditional=outputs.filter(o=>o.conditional);
    if(conditional.length*liveBlocks.length>131072)throw new Error('條件輸出的 CFG 傳值數量過大，請縮小選取範圍。');
    for(const o of conditional)inputs.push({name:`${name(o.value)}（未執行路徑的備援值）`,argument:id(`seed_${o.index}`),type:o.type,role:'inactive-output',output:o.index});
    const slots=b=>conditional.flatMap(o=>[{name:id(`value_${o.index}_${blockNumbers.get(b)}`),type:o.type},{name:id(`valid_${o.index}_${blockNumbers.get(b)}`),type:'i1'}]);
    const slotValues=b=>conditional.flatMap(o=>o.block===b ? [{name:ref(o.value),type:o.type},{name:id('true'),type:'i1'}] : [{name:id(`value_${o.index}_${blockNumbers.get(b)}`),type:o.type},{name:id(`valid_${o.index}_${blockNumbers.get(b)}`),type:'i1'}]);
    const argumentsOf=b=>(b.arguments || []).filter(v=>neededArgs.has(v));
    const attributes=(op,omit=[])=>[...op.getAttrDictionary()].filter(([key])=>!omit.includes(key)).map(([key,value])=>{
        const range=info.attributes.get(value);if(!range)throw new Error(`無法保留 ${opName(op)} 的 ${key} 屬性。`);return `${key} = ${source.slice(...range)}`;
    }).join(', ');
    const branch=(b)=>{
        const {op,sem,groups,conditions,targets}=branches.get(b);
        const routes=targets.map((target,s)=>({label:label(target),values:[...groups[s].filter((_,a)=>neededArgs.has(target.arguments[a])).map(u=>({name:ref(u.value),type:type(u.value)})),...slotValues(b)]}));
        const flags=conditions.map(u=>({name:ref(u.value),type:type(u.value)}));
        if(typeof sem.exportBranch==='function') {
            const text=sem.exportBranch({op,source,conditions:flags,successors:routes,attributes});
            if(typeof text!=='string' || !text.trim())throw new Error('Dialect exportBranch 必須同步回傳 generic operation 文字。');
            return text;
        }
        const values=[...flags,...routes.flatMap(r=>r.values)],args=values.map(v=>v.name).join(', '),types=values.map(v=>v.type).join(', '),labels=routes.map(r=>r.label).join(', ');
        const sizes=routes.map(r=>r.values.length);let properties='',omit=[];
        if(opName(op)==='cf.cond_br'){properties=` <{operandSegmentSizes = array<i32: 1, ${sizes.join(', ')}>}>`;omit=['operandSegmentSizes'];}
        if(opName(op)==='cf.switch') {
            omit=['operandSegmentSizes','case_operand_segments','case_values'];
            const cases=op.getAttr('case_values'),span=cases && info.attributes.get(cases);
            properties=` <{operandSegmentSizes = array<i32: 1, ${sizes[0]}, ${sizes.slice(1).reduce((a,b)=>a+b,0)}>, case_operand_segments = array<i32${sizes.length>1?': '+sizes.slice(1).join(', '):''}>${span?`, case_values = ${source.slice(...span)}`:''}}>`;
        }
        const extra=attributes(op,omit);
        return `"${opName(op)}"(${args})[${labels}]${properties}${extra?` {${extra}}`:''} : (${types}) -> ()`;
    };
    const snippets=op=>{
        const range=info.operations.get(op),parts=[];let at=range[0];
        for(const use of usesByOp.get(op).filter(u=>names.has(u.value) && (!neededArgs.has(u.value) || removedEntries.has(ir.definitions.get(u.value)?.block))).sort((a,b)=>a.range[0]-b.range[0])) {parts.push(source.slice(at,use.range[0]),names.get(use.value));at=use.range[1];}
        parts.push(source.slice(at,range[1]));return parts.join('');
    };
    const multiExit=liveExits.length>1;
    const resultTypes=[...(multiExit?['i32']:[]),...outputs.flatMap(o=>o.conditional?['i1',o.type]:[o.type])];
    let resultIndex=multiExit?1:0;
    for(const o of outputs){o.results=o.conditional?[resultIndex,resultIndex+1]:[resultIndex];resultIndex+=o.results.length;}
    const lines=[`^${prefix.slice(1)}entry(${inputs.map(v=>`${v.argument}: ${v.type}`).join(', ')}):`];
    if(conditional.length)lines.push(`  ${id('false')} = "arith.constant"() <{value = false}> : () -> i1`,`  ${id('true')} = "arith.constant"() <{value = true}> : () -> i1`);
    if(multiExit)liveExits.forEach((_,i)=>lines.push(`  ${id(`exit_${i}`)} = "arith.constant"() <{value = ${i} : i32}> : () -> i32`));
    const entryInput=v=>entryBlock===blocks[0]?v:incoming.get(entryBlock)[0].uses[entryBlock.arguments.indexOf(v)].value;
    const entryValues=[...argumentsOf(entryBlock).map(v=>({name:inputRef(resolveRemoved(entryInput(v))),type:type(v)})),...conditional.flatMap(o=>[{name:id(`seed_${o.index}`),type:o.type},{name:id('false'),type:'i1'}])];
    lines.push(`  "cf.br"(${entryValues.map(v=>v.name).join(', ')})[${label(entryBlock)}] : (${entryValues.map(v=>v.type).join(', ')}) -> ()`);
    const bindings={selected,blocks:new Map(liveBlocks.map((b,i)=>[b,i+1])),operators:new Map(),arguments:new Map(),returnOperands:new Map()};
    for(const b of liveBlocks) {
        lines.push(`${label(b)}(${[...argumentsOf(b).map(v=>({name:name(v),type:type(v)})),...slots(b)].map(v=>`${v.name}: ${v.type}`).join(', ')}):`);
        argumentsOf(b).forEach((v,i)=>bindings.arguments.set(v,i));let position=0;
        for(const op of b.operations)if(retained.has(op)){bindings.operators.set(op,position++);lines.push('  '+snippets(op));}
        if(branches.has(b)){bindings.operators.set(branches.get(b).op,position);lines.push('  '+branch(b));}
        else {
            if(selected.has(b.operations.at(-1))) {
                const op=b.operations.at(-1);bindings.operators.set(op,position);
                bindings.returnOperands.set(op,outputs.filter(o=>o.returnOp===op).sort((a,b)=>a.returnPort-b.returnPort).map(o=>o.results.at(-1)));
            }
            const values=[...(multiExit?[id(`exit_${liveExits.indexOf(b)}`)]:[]),...outputs.flatMap(o=>o.conditional ? (o.block===b?[id('true'),ref(o.value)]:[id(`valid_${o.index}_${blockNumbers.get(b)}`),id(`value_${o.index}_${blockNumbers.get(b)}`)]) : [ref(o.value)])];
            lines.push(`  "func.return"(${values.join(', ')}) : (${resultTypes.join(', ')}) -> ()`);
        }
    }
    const aliases=info.declarations.map(r=>source.slice(...r)).join('\n'),resources=info.resources.map(r=>source.slice(...r)).join('\n');
    const contract=[`// Model Lens CFG slice: selected operations and required cyclic/control producers.`,
        ...inputs.map((v,i)=>`// input ${i}: ${v.argument} = ${JSON.stringify(v.name)} : ${v.type.replace(/[\r\n]/g,' ')} (${v.role})`),
        ...(multiExit?['// result 0: original exit ordinal (0-based)']:[]),
        ...outputs.map(o=>`// output ${o.index}: results [${o.results.join(', ')}] = ${JSON.stringify(name(o.value))}${o.conditional?' = (valid: i1, value); false means the supplied seed is inactive.':''}`),
        ...liveBlocks.map(b=>`// block ${label(b)} = ${JSON.stringify(b.name || 'entry')}`)];
    const intro=`${contract.join('\n')}\n${aliases}\n"builtin.module"() ({\n"func.func"() <{sym_name = "extracted", function_type = (${inputs.map(v=>v.type).join(', ')}) -> (${resultTypes.join(', ')})}>`;
    const body=`${intro} ({\n${lines.join('\n')}\n})`;
    let text=`${body} : () -> ()\n}) : () -> ()\n${resources}\n`;
    const {attachSlicePattern}=await import('./mlir-pattern-projection.js?v=48cf132f532c0b5d');
    text=await attachSlicePattern(index,regionInfo,text,body.length,bindings);
    progress('重新驗證局部 MLIR 的語法、SSA、分支傳值與 dominance…');
    const validation=await validateMLIRText(text,{metadata,dialects});
    return {blob:new Blob([text],{type:'text/plain;charset=utf-8'}),layers:retained.size+liveBlocks.length+1+(conditional.length?2:0)+(multiExit?liveExits.length:0),inputs,outputs:outputs.map(o=>({name:name(o.value),type:o.type,conditional:o.conditional,results:o.results})),validation,slice:{selected:selected.size,retained:retained.size,added:[...retained].filter(op=>!selected.has(op)).map(op=>opName(op)),blocks:liveBlocks.length+1,routingBlocks:liveBlocks.length,conditionalOutputs:conditional.length,exitTag:multiExit}};
}

function cyclicBlocks(blocks,edges) {
    const visited=new Set(),order=[],reverse=new Map(blocks.map(b=>[b,[]]));
    for(const b of blocks)for(const to of edges.get(b))if(reverse.has(to))reverse.get(to).push(b);
    for(const start of blocks)if(!visited.has(start)) {
        visited.add(start);const stack=[[start,0]];
        while(stack.length){const frame=stack.at(-1),next=edges.get(frame[0]);if(frame[1]<next.length){const b=next[frame[1]++];if(!visited.has(b)){visited.add(b);stack.push([b,0]);}}else{order.push(frame[0]);stack.pop();}}
    }
    visited.clear();const cyclic=new Set();
    for(const start of order.reverse())if(!visited.has(start)) {
        const component=[],stack=[start];visited.add(start);
        while(stack.length){const b=stack.pop();component.push(b);for(const from of reverse.get(b))if(!visited.has(from)){visited.add(from);stack.push(from);}}
        if(component.length>1 || edges.get(start).includes(start))for(const b of component)cyclic.add(b);
    }
    return cyclic;
}
