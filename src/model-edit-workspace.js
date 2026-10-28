import {tflite as schema} from '../vendor/netron/tflite-schema.js';
import {typeSpelling} from './mlir-types.js';
import {operationSemantics} from './mlir-dialects.js';
import {operationEditText} from './model-operation-edit.js';
import {EDIT_LIMITS,replayEditDraft,editChanges,editIssues,editPosition} from './model-edit-draft.js';
import {randomTensor,randomTensorInfo} from './tflite-new-ops.js';
const opId=(graph,node)=>`op:${graph}:${node}`;
const text=value=>String(value??'').slice(0,1024);
const normalized=(value,budget={count:0,depth:0})=>{if(++budget.count>65536||budget.depth>64)throw Error('Tensor metadata 過大，請使用進階表單。');budget.depth++;let result;try{result=typeof value==='bigint'?String(value):Array.isArray(value)||ArrayBuffer.isView(value)?Array.from(value,v=>normalized(v,budget)):value&&typeof value==='object'?Object.fromEntries(Object.keys(value).sort().map(k=>[k,normalized(value[k],budget)])):value;}finally{budget.depth--;}return result;};
const tfSignature=t=>{if([t.shape,t.shape_signature].some(v=>v?.length>128)||['min','max','scale','zero_point'].some(k=>t.quantization?.[k]?.length>16384))throw Error('Tensor 型別／量化 metadata 過大，請使用進階表單。');const s=JSON.stringify(normalized(Object.fromEntries(['type','shape','shape_signature','quantization','sparsity'].map(k=>[k,t[k]]))));if(s.length>128*1024)throw Error('Tensor metadata 過大，請縮小編輯範圍。');return s;};

// Select a bounded edit scope once. Payloads/IR text never enter this snapshot.
export function editWorkspaceSnapshot(index,{targets,graph=0,includeNeighbours=true}={}){
    const format=index.mlir?'mlir':'tflite',all=index.graphs;
    if(!targets?.length)targets=all[graph]?.graph.nodes.length?[{graph,node:0}]:[];
    if(!Array.isArray(targets)||!targets.length||targets.length>EDIT_LIMITS.originals)throw Error('編輯範圍最多容納 64 個原始 OP。');
    const selected=new Map();
    for(const target of targets){if(!Number.isInteger(target?.graph)||!Number.isInteger(target.node)||target.graph<0||target.node<0||!all[target.graph]?.graph.nodes[target.node])throw Error('找不到要編輯的原始 OP。');selected.set(opId(target.graph,target.node),{graph:target.graph,node:target.node});}
    const originals=[...selected.values()],nodes=[],values=new Map(),controls=[];let transferBytes=4096;
    const bounded=value=>{transferBytes+=JSON.stringify(value).length;if(transferBytes>4*1024**2)throw Error('編輯範圍 metadata 超過 4 MiB，請縮小選取範圍。');return value;};
    let prefix='%model_lens_workspace_';if(index.mlir)while(index.mlir.source.includes(prefix))prefix='%_'+prefix.slice(1);
    const graphByBlock=index.mlir?new Map(index.mlir.graphs.map((g,i)=>[g.block,i])):null;
    const regionIds=index.mlir?new Map(index.mlir.ir.regions.map((r,i)=>[r,i])):null;
    const nodeByOp=index.mlir?new Map(index.mlir.graphs.flatMap((g,graph)=>g.operations.map((op,node)=>[op,{graph,node}]))):null;
    const valueKey=value=>{
        const def=index.mlir.ir.definitions.get(value);if(!def)throw Error('SSA 值缺少定義，請先驗證 MLIR。');
        const source=def.row?nodeByOp.get(def.row.op):{graph:graphByBlock.get(def.block),argument:index.mlir.graphs[graphByBlock.get(def.block)]?.block.arguments.indexOf(value)};
        if(!source||!Number.isInteger(source.graph))throw Error('此 SSA 來源尚無可編輯的 block 對照。');
        return {def,source,key:def.row?`m:${source.graph}:${source.node}:${value.resultNumber}`:`a:${source.graph}:${source.argument}`};
    };
    const rawPorts=({graph,node},strict=false)=>{const op=index.mlir?index.mlir.graphs[graph].operations[node]:index.raw.subgraphs[graph].operators[node],uses=index.mlir?index.mlir.ir.byOp.get(op).uses:op.inputs,defs=index.mlir?op.results:op.outputs;if(uses.length+defs.length+(op.successors?.length||0)>1024){if(strict)throw Error('選取 OP 的 ports 超過 1024，請使用進階表單。');return null;}return index.mlir?{inputs:uses.map(u=>valueKey(u.value).key),outputs:defs.map(v=>valueKey(v).key)}:{inputs:Array.from(uses,id=>`t:${graph}:${id}`),outputs:Array.from(defs,id=>`t:${graph}:${id}`)};};
    // One direct neighbourhood pass; never expand recursively through a big model.
    const inputs=new Set(originals.flatMap(loc=>rawPorts(loc,true).inputs)),outputs=new Set(originals.flatMap(loc=>rawPorts(loc,true).outputs));
    const graphs=new Set(index.mlir?all.map((_,i)=>i):originals.map(t=>t.graph));
    if(includeNeighbours)for(const graph of graphs)for(let node=0;node<all[graph].graph.nodes.length&&selected.size<EDIT_LIMITS.originals;node++){
        const loc={graph,node},id=opId(graph,node);if(selected.has(id))continue;const p=rawPorts(loc);
        if(p&&(p.inputs.some(k=>outputs.has(k))||p.outputs.some(k=>inputs.has(k))))selected.set(id,loc);
    }
    const producers=index.raw?new Map([...graphs].map(graph=>{const map=new Map();index.raw.subgraphs[graph].operators.forEach((op,node)=>{for(const id of op.outputs)map.set(id,node);});return [graph,map];})):null;
    const addTF=(graph,id)=>{
        const key=`t:${graph}:${id}`;if(values.has(key))return key;if(values.size>=EDIT_LIMITS.ports)throw Error('編輯範圍的 ports 過多，請縮小選取。');const g=index.raw.subgraphs[graph],t=g.tensors[id],optional=id===-1;
        if(!t&&!optional)throw Error('Tensor 索引不存在。');
        const producer=optional||t.is_variable?-1:producers.get(graph).get(id)??-1,signature=optional?null:tfSignature(t);
        const type=optional?'optional':`${schema.TensorType[t.type]} [${Array.from(t.shape||[]).join(', ')}]`;
        values.set(key,bounded({id:key,name:optional?'未連接（optional）':text(t.name||`tensor_${id}`),type,signature,graph,tensor:id,optional,
            producer:producer<0?null:opId(graph,producer),order:producer<0?-1:producer*4+2,source:{graph,tensor:id},modelOutput:g.outputs.includes(id),
            kind:optional?'optional':t.is_variable?'變數':g.inputs.includes(id)?'模型輸入':producer<0?'權重／常數':'範圍外輸出'}));return key;
    };
    const addML=value=>{
        const {def,source,key}=valueKey(value);if(values.has(key))return key;if(values.size>=EDIT_LIMITS.ports)throw Error('編輯範圍的 ports 過多，請縮小選取。');
        const type=typeSpelling(def.type),name=def.name+(def.number||value.owner?.results?.length>1?`#${def.number}`:'');if(type.length>4096||name.length>512)throw Error('SSA 型別／名稱過長，請使用進階表單。');
        values.set(key,bounded({id:key,name,type,signature:type,graph:source.graph,source:{...source,...(def.row?{result:value.resultNumber}:{})},producer:def.row?opId(source.graph,source.node):null,
            order:def.row?source.node*4+2:-1,region:regionIds.get(def.region),kind:def.row?'範圍外輸出':'Block／function 輸入',number:def.number||0,grouped:value.owner?.results?.length>1}));return key;
    };
    for(const loc of [...selected.values()].sort((a,b)=>a.graph-b.graph||a.node-b.node)){
        const {graph,node}=loc,id=opId(graph,node),name=text(all[graph].graph.nodes[node].type.name);
        if(index.mlir){
            const data=index.mlir,op=data.graphs[graph].operations[node],row=data.ir.byOp.get(op),sem=operationSemantics(op,data.dialects),visible=[];
            for(let r=row.region;r;r=r.isolated?null:r.parent)visible.push(regionIds.get(r));
            const groups=new Map(),outputs=op.results.map(value=>{const key=addML(value),def=data.ir.definitions.get(value);if(!groups.has(def.name))groups.set(def.name,groups.size);values.get(key).group=groups.get(def.name);return {value:key,type:values.get(key).type};});
            nodes.push({id,source:loc,name,block:text(data.graphs[graph].block.label||data.graphs[graph].block.name||`block ${graph}`),visibleRegions:visible,ordered:row.region.kind!=='graph',
                cloneable:!sem.terminator&&!op.successors?.length&&!op.regions?.length,removable:!sem.terminator&&!op.successors?.length&&!op.regions?.length,
                inputs:row.uses.map(use=>{const key=addML(use.value);return bounded({value:key,type:values.get(key).type,signature:values.get(key).signature});}),outputs});
            for(const s of op.successors||[]){const target=row.region.blocks.find(b=>(b.label||b.name)===(s.label||s.name)),targetGraph=graphByBlock.get(target);if(Number.isInteger(targetGraph))controls.push(bounded({from:id,graph:targetGraph,label:text(s.label||s.name)}));}
        }else{
            const op=index.raw.subgraphs[graph].operators[node];
            nodes.push({id,source:loc,name,block:text(all[graph].graph.name||`subgraph ${graph}`),ordered:true,cloneable:true,removable:true,
                inputs:Array.from(op.inputs,(value,i)=>{const key=addTF(graph,value);return bounded({value:key,type:values.get(key).type,signature:values.get(key).signature,optional:value===-1||all[graph].graph.nodes[node].type.inputs?.[i]?.option==='optional'});}),
                outputs:Array.from(op.outputs,value=>({value:addTF(graph,value)}))});
        }
    }
    if(values.size>EDIT_LIMITS.ports||nodes.some(n=>n.inputs.length+n.outputs.length>1024))throw Error('選取範圍的介面過大，請縮小範圍或使用進階 OP 表單。');
    const snapshot={format,prefix,nodes,values:[...values.values()],controls,selected:originals.map(l=>opId(l.graph,l.node)),total:all.reduce((n,g)=>n+g.graph.nodes.length,0),hasSignatures:!!index.raw?.signature_defs.length};
    if(JSON.stringify(snapshot).length>4*1024**2)throw Error('編輯範圍 metadata 超過 4 MiB，請縮小選取範圍。');return snapshot;
}

export async function exportEditWorkspace(index,file,snapshot,commands,{updateSignatures=false,progress=()=>{}}={}){
    const state=replayEditDraft(snapshot,commands),changes=editChanges(snapshot,state),issues=editIssues(state);
    if(!changes.length)throw Error('草稿沒有變更。');if(issues.length)throw Error(issues.slice(0,8).map(i=>`${i.node} input ${i.slot}: ${i.message}`).join('\n'));
    const active=state.nodes.filter(n=>!n.removed),value=id=>{const v=state.values.get(id);if(!v)throw Error('找不到接線來源。');return v;};
    if(!index.mlir){
        const {editTfliteModel}=await import('./tflite-model-edit.js'),plans=[];
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
            const entries=[];for(let node=0;node<g.operators.length;node++){
                const append=side=>{for(const clone of clones.filter(c=>c.anchor.node===node&&c.anchor.side===side))entries.push({template:clone.source.node,inputs:clone.inputs.map(p=>tensor(p.value)),outputs:clone.outputs.map(p=>tensor(p.value)),...(clone.builtin?{builtin:clone.builtin}:{})});};
                append('before');const current=byOriginal.get(node);if(!current?.removed)entries.push(current?{template:node,inputs:current.inputs.map(p=>tensor(p.value))}:{template:node});append('after');
            }
            const boundary=scope.filter(n=>n.removed&&n.boundary&&!n.fresh).flatMap(n=>n.outputs.map(p=>tensor(p.value))).filter(id=>g.outputs.includes(id)||entries.some(e=>(e.inputs||g.operators[e.template].inputs).includes(id)));
            const exposed=clones.filter(n=>n.exposed).flatMap(n=>n.outputs.map(p=>tensor(p.value)));
            plans.push({graph,operators:entries,tensors,inputs:[...new Set([...g.inputs,...boundary])],outputs:[...new Set([...g.outputs,...exposed])],updateSignatures:updateSignatures===true});
        }
        const result=editTfliteModel(index,file,plans);return {...result,workspaceChanges:changes,workspaceScope:snapshot.selected};
    }
    const {editMLIRModel}=await import('./mlir-model-edit.js'),edits=[];
    for(const node of state.nodes){
        if(node.fresh){if(node.removed)continue;
            const fragment=operationEditText(index,{...node.source,mode:'add-after',operands:node.inputs.map(p=>value(p.value).name),resultPrefix:`${snapshot.prefix}${node.serial}_`});
            edits.push({kind:node.anchor.side==='after'?'insert-after':'insert-before',graph:node.anchor.graph,node:node.anchor.node,text:fragment});
        }else if(node.removed)edits.push({kind:'remove',...node.source});
        else {const original=snapshot.nodes.find(n=>n.id===node.id);node.inputs.forEach((port,operand)=>{if(port.value!==original.inputs[operand].value){const v=value(port.value);edits.push({kind:'rewire',...node.source,operand,value:v.fresh?{name:v.name}:v.source});}});}
    }
    const result=await editMLIRModel(index,edits,{progress});return {...result,workspaceChanges:changes,workspaceScope:snapshot.selected};
}
