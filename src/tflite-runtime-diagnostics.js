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
    for(const raw of diagnostics.slice(-12)){
        const line=String(raw).slice(0,512);
        for(const match of line.matchAll(/Node number (\d+) \(([A-Z][A-Z0-9_]*)\) failed to (?:prepare|invoke)/g)){
            const node=Number(match[1]),kernel=match[2],key='node:'+node+':'+kernel;if(!Number.isSafeInteger(node)||seen.has(key))continue;seen.add(key);
            const candidates=(context?.operators||[]).filter(o=>o.node===node&&o.kernel===kernel).slice(0,8).map(({graph,node,inputs,outputs,portsTruncated})=>({graph,node,inputs,outputs,portsTruncated}));
            result.push({node,kernel,candidates,unique:context?.complete===true&&candidates.length===1,contextComplete:context?.complete===true,scope:'依 runtime 日誌的 node 編號及 builtin 名稱對照來源；多 subgraph／delegate 或超過 metadata 預算時可能無法唯一定位。'});
        }
        for(const match of line.matchAll(/\bTensor\s+#?(\d+)\b(?=[^\r\n]*(?:invalid|failed|mismatch|out of|exceed))/gi)){
            const tensor=Number(match[1]),key='tensor:'+tensor;if(!Number.isSafeInteger(tensor)||seen.has(key))continue;seen.add(key);
            const related=(context?.operators||[]).filter(o=>o.inputs.includes(tensor)||o.outputs.includes(tensor));
            const candidates=related.slice(0,8).map(({graph,node,kernel,inputs,outputs,portsTruncated})=>({graph,node,kernel,inputs,outputs,portsTruncated,roles:[...(inputs.includes(tensor)?['input']:[]),...(outputs.includes(tensor)?['output']:[])]}));
            // References identify useful navigation targets, not the OP that
            // caused a tensor error. Native tensor IDs may also be graph-local
            // or rewritten by a delegate. Never claim a unique failing OP.
            result.push({kind:'tensor',tensor,candidates,unique:false,candidatesTruncated:related.length>8,
                contextComplete:context?.complete===true&&!context.operators.some(o=>o.portsTruncated),
                scope:'依 runtime 的 tensor 編號列出來源 metadata 中的定義與使用者；不代表該 OP 造成錯誤，多 subgraph／delegate 可能使用不同編號。'});
        }
    }
    return result;
}
export function runtimeLocationSummary(locations=[]){
    return locations.map(item=>{
        if(item.kind==='tensor'){
            const positions=item.candidates.map(c=>`${c.roles.map(r=>r==='output'?'定義來源':'使用者').join('／')}：Subgraph #${c.graph} · OP #${c.node} ${c.kernel||''}`).join('；');
            const limits=[item.candidatesTruncated?'候選僅列前 8 個 OP':'',!item.contextComplete?'metadata 僅包含預算內的 OP 與每側前 32 個 ports，可能缺少參照':''].filter(Boolean).join('；');
            return `runtime 回報 tensor #${item.tensor}；${positions||'尚無可確認的來源參照'}。這些是 tensor 參照，不代表 OP 是錯誤原因${limits?'；'+limits:''}。`;
        }
        const positions=item.candidates.map(c=>`Subgraph #${c.graph} · OP #${c.node} · inputs [${c.inputs.join(', ')}]／outputs [${c.outputs.join(', ')}]${c.portsTruncated?'（僅列前 32 個 ports）':''}`).join('；');
        return `runtime 回報 ${item.kernel} node #${item.node}；${item.unique?'來源候選':positions?'可能來源（尚未唯一定位）':'尚無可確認的來源對照'}${positions?'：'+positions:''}。`;
    }).join('\n');
}
