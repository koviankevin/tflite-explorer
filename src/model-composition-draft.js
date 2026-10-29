// A composition keeps source identities and immutable tensor metadata. Imports
// and interface choices are ordinary replayable commands, including Undo/Redo.
export function compositionCommand(state,command){
    if(!state.composition||!['import','interface'].includes(command.kind))return false;
    if(command.kind==='import'){
        if(!Array.isArray(command.nodes)||!command.nodes.length||command.nodes.length>32||typeof command.label!=='string'||command.label.length>80)throw Error('每次請加入 1～32 個 OP，片段名稱最多 80 字。');
        const ids=[...new Set(command.nodes)],templates=ids.map(id=>state.templates.find(n=>n.id===id));
        if(templates.some(n=>!n))throw Error('找不到組合片段的原始 OP。');
        if(state.nodes.length+templates.filter(n=>!state.nodes.some(x=>x.id===n.id)).length>96)throw Error('組合草稿最多 96 個 OP。');
        const group={id:state.groups.length+1,label:command.label,nodes:ids};
        for(const template of templates){let node=state.nodes.find(n=>n.id===template.id);if(!node){node={...structuredClone(template),ordered:false,groups:[]};state.nodes.push(node);}if(!node.groups.includes(group.id))node.groups.push(group.id);}
        state.groups.push(group);
    }else{
        const value=state.values.get(command.value);
        if(!['inputs','outputs'].includes(command.side)||typeof command.enabled!=='boolean'||!value||value.optional||value.missing)throw Error('組合模型介面選擇無效。');
        state.interface[command.side].set(command.value,command.enabled);
    }
    return true;
}
export function compositionOrder(state){
    const nodes=state.nodes.filter(n=>!n.removed),byId=new Map(nodes.map(n=>[n.id,n])),edges=new Map(nodes.map(n=>[n.id,new Set()])),degree=new Map(nodes.map(n=>[n.id,0]));
    for(const node of nodes)for(const port of node.inputs){const producer=state.values.get(port.value)?.producer;if(byId.has(producer)&&!edges.get(producer).has(node.id)){edges.get(producer).add(node.id);degree.set(node.id,degree.get(node.id)+1);}}
    const queue=nodes.filter(n=>!degree.get(n.id)),result=[];
    while(queue.length){const node=queue.shift();result.push(node);for(const id of edges.get(node.id)){degree.set(id,degree.get(id)-1);if(!degree.get(id))queue.push(byId.get(id));}}
    if(result.length!==nodes.length)throw Error('組合接線形成循環，無法建立 TFLite 執行順序。');return result;
}
export function compositionWireReason(state,target,valueId){
    const producer=state.values.get(valueId)?.producer;if(!producer||!state.nodes.some(n=>n.id===producer&&!n.removed))return '';
    const seen=new Set([target]),queue=[target];
    while(queue.length){const id=queue.shift();if(id===producer)return '此接線會形成循環，請改用其他輸出。';for(const n of state.nodes)if(!n.removed&&!seen.has(n.id)&&n.inputs.some(p=>state.values.get(p.value)?.producer===id)){seen.add(n.id);queue.push(n.id);}}
    return '';
}
export function compositionInterface(state){
    const active=state.nodes.filter(n=>!n.removed),producers=new Set(active.map(n=>n.id)),used=new Set(active.flatMap(n=>n.inputs.map(p=>p.value))),defined=new Set(active.flatMap(n=>n.outputs.map(p=>p.value)));
    const required=[...used].filter(id=>{const v=state.values.get(id);return v&&!v.optional&&!v.missing&&!v.generated&&!producers.has(v.producer)&&v.kind!=='權重／常數';});
    const available=[...new Set([...required,...state.interface.inputs.keys()])].filter(id=>{const v=state.values.get(id);return v&&!v.optional&&!v.missing&&!v.fresh&&!v.generated&&!producers.has(v.producer);});
    const inputs=available.filter(id=>state.interface.inputs.get(id)??required.includes(id));
    const outputs=[...defined].filter(id=>state.interface.outputs.get(id)??(!used.has(id)||state.values.get(id).modelOutput||active.some(n=>n.exposed&&n.outputs.some(p=>p.value===id))));
    return {inputs,outputs,availableInputs:available,availableOutputs:[...defined],required,missing:required.filter(id=>!inputs.includes(id))};
}
