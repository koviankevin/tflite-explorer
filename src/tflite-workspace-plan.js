import {randomTensor,randomTensorInfo} from './tflite-new-ops.js';
import {editPosition} from './model-edit-draft.js';
import {compositionOrder,compositionInterface} from './model-composition-draft.js';
import {deletionReplacements} from './model-edit-delete.js';
export function tfliteWorkspacePlans(index,state,changes,{updateSignatures=false,metadataOnly=false,shapePatches=[]}={}){
    const plans=[],active=state.nodes.filter(n=>!n.removed),resolve=deletionReplacements(state),hasReconnect=state.nodes.some(n=>n.removed&&n.reconnect?.length),value=id=>{const v=state.values.get(id);if(!v)throw Error('找不到接線來源。');return v;};
        const referenced=new Set([...active.flatMap(n=>n.inputs.map(p=>p.value)),...state.nodes.filter(n=>n.removed).flatMap(n=>(n.reconnect||[]).map(r=>resolve(r.value)))]);
        const generatedValues=[...referenced].map(value).filter(v=>v.generated);
        if(generatedValues.reduce((sum,v)=>sum+randomTensorInfo(index.raw.subgraphs[v.graph].tensors[v.tensor],v.generated).bytes,0)>32*1024**2)throw Error('整次匯出的亂數權重超過 32 MiB。');
        for(const graph of new Set(changes.map(c=>state.nodes.find(n=>n.id===c.node).source.graph))){
            const g=index.raw.subgraphs[graph],scope=state.nodes.filter(n=>n.source.graph===graph),byOriginal=new Map(scope.filter(n=>!n.fresh).map(n=>[n.source.node,n])),newIds=new Map(),tensors=[];
            const clones=active.filter(n=>n.fresh&&n.source.graph===graph).sort((a,b)=>editPosition(state,a)-editPosition(state,b));
            for(const clone of clones)for(const [slot,port] of clone.outputs.entries()){newIds.set(port.value,g.tensors.length+tensors.length);const v=value(port.value);tensors.push({like:clone.builtin?value(clone.builtin.outputLike[slot]).tensor:g.operators[clone.source.node].outputs[slot],name:v.name,...(!metadataOnly&&v.inferredShape?{shape:v.inferredShape}:{})});}
            const generated=generatedValues.filter(v=>v.graph===graph);
            if(generated.reduce((sum,v)=>sum+randomTensorInfo(g.tensors[v.tensor],v.generated).bytes,0)>32*1024**2)throw Error('單次產生的亂數權重超過 32 MiB，請沿用現有權重或分次編輯。');
            for(const v of generated){newIds.set(v.id,g.tensors.length+tensors.length);tensors.push({like:v.tensor,name:v.name,...(metadataOnly?{generated:true}:{data:randomTensor(g.tensors[v.tensor],v.generated)})});}
            const tensor=id=>{const v=value(id);if(v.graph!==graph)throw Error('不能跨 TFLite subgraph 接線。');return v.fresh||v.generated?newIds.get(id):v.tensor;};
            const resolveTensor=id=>{const key=resolve(`t:${graph}:${id}`);return key===`t:${graph}:${id}`?id:tensor(key);};
            const removed=new Set(scope.filter(n=>n.removed&&!n.fresh&&!n.boundary).flatMap(n=>n.outputs.map(p=>value(p.value).tensor)));
            if(index.raw.signature_defs.some(s=>s.subgraph_index===graph&&s.outputs.some(p=>removed.has(p.tensor_index)&&!g.outputs.includes(p.tensor_index)))&&scope.some(n=>n.removed&&n.reconnect))throw Error('Signature 使用了子圖 outputs 之外的被刪 tensor；目前無法安全自動重接這種介面，請先調整 signature。');
            const entries=[];if(state.composition){for(const node of compositionOrder(state))entries.push({template:node.source.node,inputs:node.inputs.map(p=>tensor(p.value)),outputs:node.outputs.map(p=>tensor(p.value)),...(node.builtin?{builtin:node.builtin}:{})});}
            else for(let node=0;node<g.operators.length;node++){
                const append=side=>{for(const clone of clones.filter(c=>c.anchor.node===node&&c.anchor.side===side))entries.push({template:clone.source.node,inputs:clone.inputs.map(p=>tensor(p.value)),outputs:clone.outputs.map(p=>tensor(p.value)),...(clone.builtin?{builtin:clone.builtin}:{})});};
                append('before');const current=byOriginal.get(node);if(!current?.removed){const inputs=current?current.inputs.map(p=>tensor(resolve(p.value))):hasReconnect?Array.from(g.operators[node].inputs,resolveTensor):g.operators[node].inputs;entries.push(current||hasReconnect&&inputs.some((v,i)=>v!==g.operators[node].inputs[i])?{template:node,inputs}:{template:node});}append('after');
            }
            const boundary=scope.filter(n=>n.removed&&n.boundary&&!n.fresh).flatMap(n=>n.outputs.map(p=>tensor(p.value))).filter(id=>g.outputs.includes(id)||entries.some(e=>(e.inputs||g.operators[e.template].inputs).includes(id)));
            const exposed=[...clones.filter(n=>n.exposed).flatMap(n=>n.outputs.map(p=>tensor(p.value))),...scope.filter(n=>n.removed&&n.exposed&&n.reconnect).flatMap(n=>n.outputs.map(p=>tensor(resolve(p.value))))];
            const iface=state.composition?compositionInterface(state):null;
            const originalOutputs=Array.from(g.outputs,resolveTensor),outputs=[...originalOutputs,...new Set(exposed.filter(id=>!originalOutputs.includes(id)))];
            const updates=shapePatches.filter(p=>p.graph===graph).map(({tensor,shape})=>({tensor,shape}));
            plans.push({graph,operators:entries,tensors,inputs:iface?iface.inputs.map(tensor):[...new Set([...g.inputs,...boundary])],outputs:iface?iface.outputs.map(tensor):outputs,updateSignatures:state.composition||updateSignatures===true,...(updates.length?{tensorShapes:updates}:{}),...(metadataOnly?{valueIds:[...state.values.values()].filter(v=>v.graph===graph&&!v.optional&&!v.missing).map(v=>[v.id,tensor(v.id)]),editNodes:entries.map(entry=>{const fresh=clones.find(n=>n.source.node===entry.template&&n.outputs.length&&entry.outputs?.length&&entry.outputs[0]===tensor(n.outputs[0].value));return fresh?.id||`op:${graph}:${entry.template}`;})}:{})});
        }
    return plans;
}
