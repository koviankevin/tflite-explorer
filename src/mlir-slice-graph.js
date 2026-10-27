import {serialize} from './model-engine.js?v=0f8361cc44fcd547';
import {connectionSliceView} from './mlir-connection-view.js?v=0f8361cc44fcd547';

// A display-only contraction of the checked source projection. Never follow a
// hidden computation as if it were a wire, and never rewrite the source IR.
export function compactSliceSnapshot(index,item,entry,{maxOperators=1500,...options}={}) {
    const wanted=new Set(item.blocks.flatMap(b=>b.path.map(n=>`${b.graph}:${n}`)));
    const chosen=new Map(),nodes=[],links=[],focus={},byBlock=new Map();
    for(const [id,n] of entry.nodes.entries())if(n.kind==='operator' && wanted.has(`${n.graph}:${n.node}`)) {
        const original=index.graphs[n.graph].graph.nodes[n.node];
        const node={...serialize(original),identifier:`b${n.graph}:n${n.node}`,sourceGraph:n.graph,sourceNode:n.node,diagramKind:'operator',group:`block ${n.graph}`,inputs:[],outputs:[]};
        chosen.set(id,node);nodes.push(node);
        if(!byBlock.has(n.graph)){byBlock.set(n.graph,[]);focus[n.graph]=[];}
        byBlock.get(n.graph).push({id,n,node});focus[n.graph].push(node.identifier);
    }
    if(nodes.length>maxOperators)throw new Error(`精簡圖超過 ${maxOperators.toLocaleString()} 個 operators；請縮小選取範圍。`);
    const seen=new Set(),arg=(name,value)=>({name,value:[value]});
    const connect=(from,to,kind,key,label,template)=>{
        const signature=`${from.identifier}>${to.identifier}:${kind}:${key}`;
        if(seen.has(signature))return;seen.add(signature);
        const value={type:{dataType:kind==='control'?'control':'?',shape:{dimensions:[]}},...serialize(template || {}),identifier:`compact:${signature}`,name:label,initializer:null};
        from.outputs.push(arg(label,value));
        if(kind==='control'){to.controlDependencies ||= [];to.controlDependencies.push(value);}
        else to.inputs.push(arg(label,value));
        links.push({from:from.identifier,to:to.identifier,kind,port:key,value:value.identifier});
    };
    const incoming=new Map(),controls=new Map();
    for(const e of entry.edges) {
        if(e.kind==='ssa' || e.kind==='argument'){if(!incoming.has(e.to))incoming.set(e.to,[]);incoming.get(e.to).push(e);}
        if(e.kind==='control') {const g=entry.nodes[e.from].graph;if(!controls.has(g))controls.set(g,[]);controls.get(g).push({to:entry.nodes[e.to].graph,port:e.port});}
    }
    // Trace phi/block arguments back to original selected producers, including
    // loop-carried values. A hidden operator terminates the walk.
    for(const [toId,to] of chosen)for(const edge of incoming.get(toId) || [])if(edge.kind==='ssa') {
        const stack=[{id:edge.from,port:edge.port.split(':')[0]}],visited=new Set();
        while(stack.length) {
            const {id,port}=stack.pop(),key=`${id}:${port}`;if(visited.has(key))continue;visited.add(key);
            if(chosen.has(id)) {
                const n=entry.nodes[id],template=index.graphs[n.graph].graph.nodes[n.node].outputs[Number(port)]?.value[0];
                connect(chosen.get(id),to,'ssa',`${port}:${edge.port.split(':')[1]}`,template?.name || 'SSA',template);
            } else if(entry.nodes[id].kind==='argument')for(const e of incoming.get(id) || [])if(e.kind==='argument')stack.push({id:e.from,port:e.port.split(':')[0]});
        }
    }
    for(const [g,rows] of byBlock) {
        rows.sort((a,b)=>a.n.order-b.n.order);
        // Preserve execution order inside a block without adding terminators.
        for(let i=1;i<rows.length;i++)connect(rows[i-1].node,rows[i].node,'control','order',`block ${g}`);
        for(const edge of controls.get(g) || []) {
            const stack=[edge.to],visited=new Set();
            while(stack.length) {
                const target=stack.pop();if(visited.has(target))continue;visited.add(target);
                const destination=byBlock.get(target);
                if(destination)connect(rows.at(-1).node,destination[0].node,'control',`${edge.port}:${target}`,`出口 ${edge.port} · ${g} → ${target}`);
                else for(const next of controls.get(target) || [])stack.push(next.to);
            }
        }
    }
    const graph={name:'局部 MLIR · 原始 OP',groups:true,nodes,inputs:[],outputs:[],metadata:[]};
    return connectionSliceView({graph:serialize(graph),graphIndex:item.graph,nodes:nodes.map(n=>n.identifier),selected:[...wanted].map(key=>{const [g,n]=key.split(':');return `b${g}:n${n}`;}).filter(id=>nodes.some(n=>n.identifier===id)),total:nodes.length,full:false,combined:true,sliceView:true,compactSlice:true,focus,links,item:{...item,connections:[]}},{...options});
}
