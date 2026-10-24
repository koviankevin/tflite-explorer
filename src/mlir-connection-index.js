// A region's display topology, without cloning every OP or its attributes.
// Only the current page is serialized by connectionSliceView.
export function createConnectionIndex(index,entry) {
    const descriptors=new Map(),edges=new Map(),next=new Map(),previous=new Map(),templates=new Map(),ids=new Map(),blocks=new Map(),terms=new Map();
    const token=(identifier,name)=>({identifier,name,type:{dataType:'control',shape:{dimensions:[]}},initializer:null});
    const raw=new Map([...entry.values].map(([v,loc])=>[`${loc.id}:${loc.port}`,v]));
    const value=(id,port)=>{
        const n=entry.nodes[id],display=index.graphs[n.graph].graph;
        const template=n.kind==='operator'?display.nodes[n.node].outputs[port]?.value[0]:display.inputs[n.slot]?.value[0];
        return {identifier:`ssa:${id}:${port}`,name:`b${n.graph}:${template?.name || raw.get(`${id}:${port}`)?.name || '?'}`,type:template?.type,initializer:null};
    };
    const add=(from,to,kind,v)=>{
        const key=`${from}>${to}:${kind}:${v.identifier}`;if(edges.has(key))return;
        const e={from,to,kind,value:v};edges.set(key,e);
        for(const [map,id] of [[next,from],[previous,to]]){if(!map.has(id))map.set(id,{ssa:[],control:[]});map.get(id)[kind].push(e);}
    };
    for(const [i,n] of entry.nodes.entries()) {
        const id=n.kind==='block'?`b${n.graph}`:n.kind==='argument'?`b${n.graph}:a${n.slot}`:`b${n.graph}:n${n.node}`;
        ids.set(i,id);descriptors.set(id,n);
        if(n.kind==='operator'){if(!blocks.has(n.graph))blocks.set(n.graph,[]);blocks.get(n.graph).push(n);if(index.mlir.graphs[n.graph].operations[n.node].successors?.length)terms.set(n.graph,id);}
    }
    for(const [g,ops] of blocks) {
        ops.sort((a,b)=>a.node-b.node);let from=`b${g}`,i=0;
        for(const n of ops){const to=`b${g}:n${n.node}`;add(from,to,'control',token(`sequence:${g}:${++i}`,`block ${g} · 順序 ${i}`));from=to;}
    }
    for(const e of entry.edges)if(e.kind==='control') {
        const from=entry.nodes[e.from].graph,to=entry.nodes[e.to].graph,s=Number(e.port),id=`route:${from}:${s}`;
        descriptors.set(id,{kind:'route',graph:from,targetGraph:to,successor:s});
        add(terms.get(from),id,'control',token(`branch:${from}:${s}`,`block ${from} · 出口 ${s}`));
        add(id,`b${to}`,'control',token(`control:${from}:${s}`,`控制 ${from} → ${to} · 出口 ${s}`));
    }
    for(const e of entry.edges) {
        if(e.kind==='ssa')add(ids.get(e.from),ids.get(e.to),'ssa',value(e.from,Number(e.port.split(':')[0])));
        if(e.kind==='argument') {
            const [port,s]=e.port.split(':').map(Number),n=entry.nodes[e.to],route=`route:${e.branch}:${s}`,binding=token(`binding:${e.branch}:${s}:${e.to}`,`b${e.branch}→b${n.graph} arg #${n.slot} /${s}`);
            binding.type=index.graphs[n.graph].graph.inputs[n.slot]?.value[0]?.type;
            add(ids.get(e.from),route,'ssa',value(e.from,port));add(route,ids.get(e.to),'ssa',binding);
        }
    }
    let materializations=0;
    return {
        size:descriptors.size+edges.size,plans:new Map(),kind:id=>descriptors.get(id)?.kind,
        outgoing:(id,kind)=>next.get(id)?.[kind] || [],incoming:(id,kind)=>previous.get(id)?.[kind] || [],
        get materializations(){return materializations;},
        getNode(id) {
            if(templates.has(id)){const n=templates.get(id);templates.delete(id);templates.set(id,n);return n;}
            const n=descriptors.get(id),display=index.graphs[n.graph].graph;
            const name=n.kind==='block'?`block ${n.graph} · ${display.name.split('/').at(-1)}`:n.kind==='argument'?`${display.inputs[n.slot]?.value[0]?.name} · block argument #${n.slot}`:`出口 ${n.successor} → block ${n.targetGraph}`;
            const node={...(n.kind==='operator'?display.nodes[n.node]:{name,type:{name,identifier:name,category:'Control'},attributes:[],metadata:[],blocks:[]}),identifier:id,sourceGraph:n.graph,sourceNode:n.node,diagramKind:n.kind,group:`block ${n.graph}`,inputs:[],outputs:[]};
            templates.set(id,node);materializations++;if(templates.size>1024)templates.delete(templates.keys().next().value);return node;
        }
    };
}
