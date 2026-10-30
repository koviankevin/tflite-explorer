import {tflite as schema} from '../vendor/netron/tflite-schema.js';
// Bounded metadata travels with the already admitted runtime plan, never model
// weights. Node numbers in native logs may be local to any subgraph or delegate.
export function runtimeDiagnosticContext(model){
    const max=512,operators=[],total=model.subgraphs.reduce((n,g)=>n+g.operators.length,0);
    for(const [graph,g]of model.subgraphs.entries()){
        for(const [node,op]of g.operators.entries()){
            if(operators.length===max)return {complete:false,total,operators};
            const c=model.operator_codes[op.opcode_index],code=Math.max(c?.builtin_code??-1,c?.deprecated_builtin_code??-1),name=schema.BuiltinOperator[code];
            operators.push({graph,node,kernel:typeof name==='string'?name:null,inputs:Array.from(op.inputs?.slice(0,32)||[]),outputs:Array.from(op.outputs?.slice(0,32)||[]),portsTruncated:op.inputs?.length>32||op.outputs?.length>32});
        }
    }
    return {complete:true,total,operators};
}
export function runtimeFailureLocations(diagnostics,context){
    const result=[],seen=new Set();
    for(const line of diagnostics.slice(-12))for(const match of String(line).slice(0,512).matchAll(/Node number (\d+) \(([A-Z][A-Z0-9_]*)\) failed to (?:prepare|invoke)/g)){
        const node=Number(match[1]),kernel=match[2],key=node+':'+kernel;if(!Number.isSafeInteger(node)||seen.has(key))continue;seen.add(key);
        const candidates=(context?.operators||[]).filter(o=>o.node===node&&o.kernel===kernel).slice(0,8).map(({graph,node,inputs,outputs,portsTruncated})=>({graph,node,inputs,outputs,portsTruncated}));
        result.push({node,kernel,candidates,unique:context?.complete===true&&candidates.length===1,contextComplete:context?.complete===true,scope:'依 runtime 日誌的 node 編號及 builtin 名稱對照來源；多 subgraph／delegate 或超過 metadata 預算時可能無法唯一定位。'});
    }
    return result;
}
export function runtimeLocationSummary(locations=[]){
    return locations.map(item=>{
        const positions=item.candidates.map(c=>`Subgraph #${c.graph} · OP #${c.node} · inputs [${c.inputs.join(', ')}]／outputs [${c.outputs.join(', ')}]${c.portsTruncated?'（僅列前 32 個 ports）':''}`).join('；');
        return `runtime 回報 ${item.kernel} node #${item.node}；${item.unique?'來源候選':positions?'可能來源（尚未唯一定位）':'尚無可確認的來源對照'}${positions?'：'+positions:''}。`;
    }).join('\n');
}
