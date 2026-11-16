// Metadata-only deletion suggestions. A compatible bypass changes model
// semantics; callers must preview it and explicitly apply one transaction.
import {compositionInterface} from './model-composition-draft.js';
export function deletionTypeReason(before,after){
    if(typeof before?.signature==='string'&&before.signature===after?.signature)return '';
    let a,b;try{a=JSON.parse(before.signature);b=JSON.parse(after.signature);}catch{return '缺少可比較的 tensor 型別。';}
    const labels={type:'dtype',shape:'shape',shape_signature:'動態 shape',quantization:'量化參數',sparsity:'sparsity'};
    const differences=Object.keys(labels).filter(k=>JSON.stringify(a?.[k])!==JSON.stringify(b?.[k]));
    return differences.length?differences.map(k=>`${labels[k]} 不同${k==='shape'?`（${JSON.stringify(a[k])} → ${JSON.stringify(b[k])}）`:''}`).join('、'):'型別不同';
}
export function deletionPreview(state,nodeId,{position,wireReason}){
    const node=state.nodes.find(n=>n.id===nodeId);
    if(state.format!=='tflite'||!node?.removable||node.removed)throw Error('請選取可刪除的 TFLite OP。');
    const candidates=[...state.values.values()].filter(v=>!v.optional&&!v.missing&&v.producer!==node.id);
    const byValue=new Map(candidates.map(v=>[v.id,v])),preferredIds=new Set(node.inputs.map(p=>p.value)),preferred=[...preferredIds].map(id=>byValue.get(id)).filter(Boolean),types=new Map(),usesByValue=new Map(node.outputs.map(p=>[p.value,[]]));
    for(const n of state.nodes)if(!n.removed&&n.id!==node.id)n.inputs.forEach((p,slot)=>usesByValue.get(p.value)?.push({node:n.id,name:n.name,slot}));
    const sourceReason=(original,v,details)=>{
        if(v.graph!==node.source.graph)return '不能跨 subgraph 重接。';
        if(v.kind==='變數')return '變數 tensor 不提供自動旁路。';
        const producer=state.nodes.find(n=>n.id===v.producer);
        if(producer?.removed&&!(producer.boundary&&!producer.fresh))return '來源 OP 已刪除。';
        if(node.ordered&&(producer?position(state,producer):v.order)>=position(state,node))return '替代來源必須先於被刪 OP 產生。';
        // Signatures are bounded by the existing 4 MiB snapshot budget. Cache
        // differences, and never materialize outputs × all values up front.
        if(original.signature===v.signature)return '';
        if(!details)return '型別不相容。';
        if(!types.has(original.signature)){if(types.size>=16)types.delete(types.keys().next().value);types.set(original.signature,new Map());}const reasons=types.get(original.signature);
        if(!reasons.has(v.signature)){if(reasons.size>=64)reasons.delete(reasons.keys().next().value);reasons.set(v.signature,deletionTypeReason(original,v));}return reasons.get(v.signature);
    };
    return {node:node.id,name:node.name,outputs:node.outputs.map(port=>{
        const original=state.values.get(port.value),uses=usesByValue.get(port.value);
        const choice=(id,details=true)=>{const v=byValue.get(id);if(!v)return null;let reason=sourceReason(original,v,details);if(!reason)for(const use of uses){reason=wireReason(state,use.node,use.slot,v.id);if(reason)break;}return {value:v.id,name:v.name,type:v.type,reason,preferred:preferredIds.has(v.id)};};
        return {value:port.value,name:original.name,type:original.type,uses,modelOutput:!!original.modelOutput||!!node.exposed,choice,
            get choices(){return candidates.map(v=>choice(v.id));},
            get suggested(){const options=preferred.map(v=>choice(v.id,false)).filter(v=>!v.reason);return options.length===1?options[0].value:'';}};
    })};
}

// Resolve previously removed outputs before applying a new deletion. Retained
// tensor IDs, custom options and weight ranges are never rewritten or guessed.
export function deletionReplacements(state){
    const mapping=new Map(state.nodes.filter(n=>n.removed).flatMap(n=>n.reconnect||[]).map(r=>[r.from,r.value]));
    return id=>{const seen=new Set();while(mapping.has(id)){if(seen.has(id))throw Error('刪除重接形成循環。');seen.add(id);id=mapping.get(id);}return id;};
}

export function deletionImpact(index,state,nodeId){
    if(!index.raw||state.format!=='tflite')throw Error('刪除預覽僅支援 TFLite。');
    const node=state.nodes.find(n=>n.id===nodeId);if(!node||node.removed)throw Error('找不到可刪除的 OP。');
    const graph=node.source.graph,g=index.raw.subgraphs[graph],resolve=deletionReplacements(state),ids=new Map(node.outputs.map(p=>[p.value,{value:p.value,uses:0,consumers:[],modelOutputs:[],signatures:0,signaturesOutsideOutputs:0,customUses:0}]));
    const add=(value,consumer)=>{const row=ids.get(resolve(value));if(!row)return;row.uses++;if(row.consumers.length<12)row.consumers.push(consumer);if(consumer.custom)row.customUses++;};
    const scope=new Map(state.nodes.filter(n=>!n.fresh&&n.source.graph===graph).map(n=>[n.source.node,n]));
    const consume=n=>{if(n.removed||n.id===nodeId)return;const op=g.operators[n.source.node],custom=!n.builtin&&!!index.raw.operator_codes[op.opcode_index].custom_code;for(const [slot,p]of n.inputs.entries())add(p.value,{node:n.id,name:n.name,slot,inWorkspace:true,custom});};
    if(!state.composition)g.operators.forEach((op,i)=>{
        const n=scope.get(i);if(n){consume(n);return;}
        const code=index.raw.operator_codes[op.opcode_index];
        for(const [slot,tensor]of op.inputs.entries())add(`t:${graph}:${tensor}`,{node:`op:${graph}:${i}`,name:String(code.custom_code||index.graphs[graph].graph.nodes[i].type.name).slice(0,256),slot,inWorkspace:false,custom:!!code.custom_code});
    });
    for(const n of state.nodes)if(n.source.graph===graph&&(state.composition||n.fresh))consume(n);
    const outputs=state.composition?null:[...g.outputs];
    if(outputs)outputs.forEach((tensor,slot)=>ids.get(resolve(`t:${graph}:${tensor}`))?.modelOutputs.push(slot));
    if(state.composition)compositionInterface(state).outputs.forEach((value,slot)=>ids.get(resolve(value))?.modelOutputs.push(slot));
    if(!state.composition)for(const n of state.nodes)if(!n.removed&&n.exposed)for(const p of n.outputs)ids.get(resolve(p.value))?.modelOutputs.push('新增');
    if(!state.composition)for(const s of index.raw.signature_defs||[])if(s.subgraph_index===graph)for(const p of s.outputs||[]){const row=ids.get(resolve(`t:${graph}:${p.tensor_index}`));if(row){row.signatures++;if(!g.outputs.includes(p.tensor_index))row.signaturesOutsideOutputs++;}}
    return [...ids.values()];
}
