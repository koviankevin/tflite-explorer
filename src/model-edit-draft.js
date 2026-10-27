// The same bounded, metadata-only draft is replayed in the UI and Worker.
// Export never trusts client-supplied tensor descriptions or OP templates.
export const EDIT_LIMITS=Object.freeze({nodes:96,commands:128,originals:64,ports:4096});
const copy=value=>structuredClone(value);
export function editPosition(state,node){
    if(!node.fresh)return node.source.node*4+2;
    const peers=state.nodes.filter(n=>n.fresh&&!n.removed&&n.anchor.graph===node.anchor.graph&&n.anchor.node===node.anchor.node&&n.anchor.side===node.anchor.side),i=peers.indexOf(node);
    return node.anchor.node*4+(node.anchor.side==='after'?2:0)+2*(i+1)/(peers.length+1);
}
export function editWireReason(state,target,slot,valueId){
    const node=state.nodes.find(n=>n.id===target),value=state.values.get(valueId),old=node?.inputs[slot];
    if(!node||node.removed||!Number.isInteger(slot)||slot<0||!old||!value)return '找不到輸入端或來源輸出端。';
    const producer=state.nodes.find(n=>n.id===value.producer);
    if(producer?.removed&&!(state.format==='tflite'&&producer.boundary&&!producer.fresh))return '來源 OP 已刪除，請改選有效來源。';
    if(value.optional&&!old.optional)return '這個輸入端不能留空。';
    if(old.signature!==null&&value.signature!==old.signature)return 'dtype、shape、量化或型別不同，不能直接接線。';
    if(state.format==='tflite'&&value.graph!==node.source.graph)return 'TFLite 只能在同一個 subgraph 內接線。';
    if(state.format==='mlir'&&!node.visibleRegions.includes(value.region))return '此 SSA 值不在目標 OP 可見的 region／function。';
    const order=producer?editPosition(state,producer):value.order;
    if(node.ordered&&value.graph===node.source.graph&&Number.isFinite(order)&&order>=editPosition(state,node))return '來源必須先於目標 OP 產生，不能建立同一 block 內的回圈。';
    return '';
}
function mutate(state,command){
    if(!command||typeof command!=='object')throw Error('編輯草稿格式無效。');
    const node=state.nodes.find(n=>n.id===command.node);
    if(!node)throw Error('找不到要修改的 OP。');
    if(command.kind==='wire'){
        const reason=editWireReason(state,node.id,command.slot,command.value);if(reason)throw Error(reason);
        node.inputs[command.slot].value=command.value;
    }else if(command.kind==='clone'){
        if(node.removed||!node.cloneable||!['before','after'].includes(command.side))throw Error('此 OP 不能從基礎編輯器複製新增。');
        if(state.nodes.length>=EDIT_LIMITS.nodes)throw Error('編輯範圍最多 96 個 OP，請先匯出並重新開啟。');
        if(state.format==='tflite'&&state.nodes.filter(n=>n.fresh&&!n.removed).reduce((n,op)=>n+op.outputs.length,0)+node.outputs.length>1024)throw Error('單次最多新增 1024 個 output tensors。');
        if([...state.values.values()].length+node.outputs.length>EDIT_LIMITS.ports)throw Error('編輯範圍的 tensor／SSA 值過多。');
        const serial=++state.next,id=`new:${serial}`,fresh={...copy(node),id,fresh:true,serial,removed:false,exposed:false,boundary:false,
            anchor:node.fresh?copy(node.anchor):{...node.source,side:command.side}};
        fresh.outputs=node.outputs.map((port,i)=>{
            const original=state.values.get(port.value),key=`${id}:out:${i}`;
            const name=state.format==='mlir'?`${state.prefix}${serial}_${original.group}${original.grouped||original.number?`#${original.number}`:''}`:`${original.name||'result'}_edit_${serial}_${i}`.slice(0,256);
            const value={...copy(original),id:key,name,producer:id,fresh:true,externalUses:0,modelOutput:false};state.values.set(key,value);
            return {...copy(port),value:key};
        });
        state.nodes.splice(state.nodes.indexOf(node)+(command.side==='after'?1:0),0,fresh);
    }else if(command.kind==='remove'){
        if(!node.removable)throw Error('此 OP 擁有控制流程或 region；請使用進階 IR 表單調整。');
        node.removed=true;node.boundary=state.format==='tflite'&&!node.fresh&&command.boundary===true;
    }else if(command.kind==='restore'){node.removed=false;node.boundary=false;}
    else if(command.kind==='expose'){
        if(state.format!=='tflite'||!node.fresh||node.removed)throw Error('只有新增的 TFLite OP 可在此加入模型 outputs。');
        node.exposed=command.enabled===true;
    }else throw Error('不支援此編輯操作。');
}
export function replayEditDraft(snapshot,commands=[]){
    if(!snapshot||!['tflite','mlir'].includes(snapshot.format)||!Array.isArray(snapshot.nodes)||snapshot.nodes.length>EDIT_LIMITS.originals||!Array.isArray(snapshot.values)||snapshot.values.length>EDIT_LIMITS.ports)throw Error('編輯範圍無效或超過上限。');
    if(!Array.isArray(commands)||commands.length>EDIT_LIMITS.commands)throw Error('最多累積 128 個編輯操作，請先匯出並重新開啟。');
    const state={format:snapshot.format,prefix:snapshot.prefix,nodes:copy(snapshot.nodes),values:new Map(snapshot.values.map(v=>[v.id,copy(v)])),next:0};
    for(const command of commands)mutate(state,command);
    return state;
}
export function editChanges(snapshot,state){
    const originals=new Map(snapshot.nodes.map(n=>[n.id,n])),changes=[];
    for(const node of state.nodes){
        if(node.fresh){if(!node.removed)changes.push({kind:'add',node:node.id,name:node.name,inputs:node.inputs.map(p=>state.values.get(p.value).name),outputs:node.outputs.map(p=>state.values.get(p.value).name),exposed:node.exposed});continue;}
        const old=originals.get(node.id);
        if(node.removed){changes.push({kind:'remove',node:node.id,name:node.name,boundary:node.boundary});continue;}
        node.inputs.forEach((port,slot)=>{if(port.value!==old.inputs[slot].value)changes.push({kind:'wire',node:node.id,name:node.name,slot,before:state.values.get(old.inputs[slot].value)?.name,after:state.values.get(port.value)?.name});});
    }
    return changes;
}
export function editIssues(state){
    const issues=[];
    for(const node of state.nodes)if(!node.removed)node.inputs.forEach((port,slot)=>{const reason=editWireReason(state,node.id,slot,port.value);if(reason)issues.push({node:node.id,slot,message:reason});});
    return issues;
}
export function modelEditDraft(snapshot,initial=[]){
    let commands=copy(initial),redo=[],state=replayEditDraft(snapshot,initial);
    const replace=next=>{const candidate=replayEditDraft(snapshot,next);commands=next;state=candidate;};
    return {get state(){return state;},get commands(){return copy(commands);},get canUndo(){return !!commands.length;},get canRedo(){return !!redo.length;},
        apply(command){replace([...commands,copy(command)]);redo=[];return state;},
        undo(){if(commands.length){const last=commands.at(-1);replace(commands.slice(0,-1));redo.push(last);}return state;},
        redo(){if(redo.length){const last=redo.at(-1);replace([...commands,last]);redo.pop();}return state;},
        clear(){replace([]);redo=[];return state;}};
}
