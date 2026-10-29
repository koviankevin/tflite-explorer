import {randomTensor,randomTensorInfo} from './tflite-new-ops.js';
import {editPosition} from './model-edit-draft.js';
import {compositionOrder,compositionInterface} from './model-composition-draft.js';
export function tfliteWorkspacePlans(index,state,changes,{updateSignatures=false}={}){
    const plans=[],active=state.nodes.filter(n=>!n.removed),value=id=>{const v=state.values.get(id);if(!v)throw Error('找不到接線來源。');return v;};
        const generatedValues=[...new Set(active.flatMap(n=>n.inputs.map(p=>p.value)))].map(value).filter(v=>v.generated);
        if(generatedValues.reduce((sum,v)=>sum+randomTensorInfo(index.raw.subgraphs[v.graph].tensors[v.tensor],v.generated).bytes,0)>32*1024**2)throw Error('整次匯出的亂數權重超過 32 MiB。');
        for(const graph of new Set(changes.map(c=>state.nodes.find(n=>n.id===c.node).source.graph))){
            const g=index.raw.subgraphs[graph],scope=state.nodes.filter(n=>n.source.graph===graph),byOriginal=new Map(scope.filter(n=>!n.fresh).map(n=>[n.source.node,n])),newIds=new Map(),tensors=[];
            const clones=active.filter(n=>n.fresh&&n.source.graph===graph).sort((a,b)=>editPosition(state,a)-editPosition(state,b));
            for(const clone of clones)for(const [slot,port] of clone.outputs.entries()){newIds.set(port.value,g.tensors.length+tensors.length);const v=value(port.value);tensors.push({like:clone.builtin?value(clone.builtin.outputLike[slot]).tensor:g.operators[clone.source.node].outputs[slot],name:v.name,...(v.inferredShape?{shape:v.inferredShape}:{})});}
            const generated=[...new Set(active.filter(n=>n.source.graph===graph).flatMap(n=>n.inputs.map(p=>p.value)))].map(value).filter(v=>v.generated);
            if(generated.reduce((sum,v)=>sum+randomTensorInfo(g.tensors[v.tensor],v.generated).bytes,0)>32*1024**2)throw Error('單次產生的亂數權重超過 32 MiB，請沿用現有權重或分次編輯。');
            for(const v of generated){newIds.set(v.id,g.tensors.length+tensors.length);tensors.push({like:v.tensor,name:v.name,data:randomTensor(g.tensors[v.tensor],v.generated)});}
            const tensor=id=>{const v=value(id);if(v.graph!==graph)throw Error('不能跨 TFLite subgraph 接線。');return v.fresh||v.generated?newIds.get(id):v.tensor;};
            const entries=[];if(state.composition){for(const node of compositionOrder(state))entries.push({template:node.source.node,inputs:node.inputs.map(p=>tensor(p.value)),outputs:node.outputs.map(p=>tensor(p.value)),...(node.builtin?{builtin:node.builtin}:{})});}
            else for(let node=0;node<g.operators.length;node++){
                const append=side=>{for(const clone of clones.filter(c=>c.anchor.node===node&&c.anchor.side===side))entries.push({template:clone.source.node,inputs:clone.inputs.map(p=>tensor(p.value)),outputs:clone.outputs.map(p=>tensor(p.value)),...(clone.builtin?{builtin:clone.builtin}:{})});};
                append('before');const current=byOriginal.get(node);if(!current?.removed)entries.push(current?{template:node,inputs:current.inputs.map(p=>tensor(p.value))}:{template:node});append('after');
            }
            const boundary=scope.filter(n=>n.removed&&n.boundary&&!n.fresh).flatMap(n=>n.outputs.map(p=>tensor(p.value))).filter(id=>g.outputs.includes(id)||entries.some(e=>(e.inputs||g.operators[e.template].inputs).includes(id)));
            const exposed=clones.filter(n=>n.exposed).flatMap(n=>n.outputs.map(p=>tensor(p.value)));
            const iface=state.composition?compositionInterface(state):null;
            plans.push({graph,operators:entries,tensors,inputs:iface?iface.inputs.map(tensor):[...new Set([...g.inputs,...boundary])],outputs:iface?iface.outputs.map(tensor):[...new Set([...g.outputs,...exposed])],updateSignatures:state.composition||updateSignatures===true});
        }
    return plans;
}
