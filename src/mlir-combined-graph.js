import {serialize} from './model-engine.js?v=48cf132f532c0b5d';

// Display projection only. The source AST, block-local indexes and export
// selections remain unchanged. SSA identity comes from the validated region,
// never from a printed name (which may be reused in other scopes).
export function combinedMLIRSnapshot(index,item,entry,{full=false,boundaryContext=false,maxOperators=1500,maxControlRoutes=512,lightweight=false}={}) {
    const graphs=new Set(item.blocks.map(b=>b.graph)),chosen=new Map(),nodes=[],values=new Map(),focus={},links=[];
    const arg=(name,value)=>({name,value:[value]});
    const group=g=>`block ${g}`;
    const synthetic=(id,name,g,kind)=>({identifier:id,name,type:{name,identifier:name,category:'Control'},group:group(g),inputs:[],outputs:[],attributes:[],metadata:[],blocks:[],diagramKind:kind,sourceGraph:g});
    const token=(id,name)=>({identifier:id,name,type:{dataType:'control',shape:{dimensions:[]}},initializer:null});
    const connect=(from,to,value,control=false)=>{
        if(!from.outputs.some(a=>a.value.includes(value)))from.outputs.push(arg(value.name,value));
        if(control){to.controlDependencies ||= [];to.controlDependencies.push(value);}
        else to.inputs.push(arg(value.name,value));
        links.push({from:from.identifier,to:to.identifier,kind:control?'control':'ssa'});
    };
    const rawValue=(raw,template)=>{
        if(!values.has(raw)) {
            const loc=entry.values.get(raw),owner=loc && entry.nodes[loc.id];
            const id=loc?`ssa:${loc.id}:${loc.port}`:`external:${values.size}`;
            const name=template?.name || raw?.modelLensSSAName || raw?.name || '?';
            values.set(raw,{...(lightweight?template:serialize(template || {})),identifier:id,name:`${owner?`b${owner.graph}`:'外部'}:${name}`,initializer:null});
        }
        return values.get(raw);
    };
    let total=0;
    for(const block of item.blocks) {
        const source=index.mlir.graphs[block.graph],set=new Set(full?source.operations.map((_,i)=>i):block.path);
        // Include actual terminators so control routes start at their operator,
        // even when the captured pattern only contains data operations.
        for(const [n,op] of source.operations.entries())if(op.successors?.length)set.add(n);
        chosen.set(block.graph,set);total+=source.operations.length;
    }
    if([...chosen.values()].reduce((n,s)=>n+s.size,0)>maxOperators)throw new Error(`相關 blocks 超過 ${maxOperators.toLocaleString()} 個 operators；請使用局部圖或縮小 pattern。`);
    const headers=new Map(),argumentsById=new Map(),ops=new Map();
    for(const block of item.blocks) {
        const g=block.graph,source=index.mlir.graphs[g],display=index.graphs[g].graph;
        const header=synthetic(`b${g}`,`block ${g} · ${display.name.split('/').at(-1)}`,g,'block');
        header.description=`${block.path.length} 個匹配 operators；顯示 ${chosen.get(g).size} / ${source.operations.length} 個 operators。控制箭頭依實際 successor 繪製；未匹配的 blocks 不展開。`;
        headers.set(g,header);nodes.push(header);focus[g]=[];
        for(const [slot,raw] of (source.block.arguments || []).entries()) {
            const id=entry.values.get(raw)?.id,template=display.inputs[slot]?.value[0];
            const a=synthetic(`b${g}:a${slot}`,`${template?.name || raw.name} · block argument #${slot}`,g,'argument');
            a.outputs.push(arg('SSA',rawValue(raw,template)));nodes.push(a);argumentsById.set(id,a);
        }
        for(const n of [...chosen.get(g)].sort((a,b)=>a-b)) {
            const op=source.operations[n],original=display.nodes[n],row=index.mlir.ir.byOp.get(op);
            const node={...(lightweight?original:serialize(original)),identifier:`b${g}:n${n}`,group:group(g),sourceGraph:g,sourceNode:n,diagramKind:'operator',controlTerminator:!!op.successors?.length,inputs:[],outputs:[]};
            for(const [i,use] of row.uses.entries())node.inputs.push(arg(original.inputs[i]?.name || 'operand',rawValue(use.value,original.inputs[i]?.value[0])));
            for(const [i,value] of (op.results || []).entries())node.outputs.push(arg(original.outputs[i]?.name || 'result',rawValue(value,original.outputs[i]?.value[0])));
            nodes.push(node);ops.set(entry.opIds.get(op),node);focus[g].push(node.identifier);
            if(op.successors?.length)connect(header,node,token(`enter:${g}`,`進入 block ${g}`),true);
        }
        if(!focus[g].length)focus[g].push(header.identifier);
    }
    const routes=new Map(),controls=entry.edges.filter(e=>e.kind==='control' && (boundaryContext ? graphs.has(entry.nodes[e.from].graph) || graphs.has(entry.nodes[e.to].graph) : graphs.has(entry.nodes[e.from].graph) && graphs.has(entry.nodes[e.to].graph)));
    if(controls.length>maxControlRoutes)throw new Error(`此匹配的控制出口超過 ${maxControlRoutes.toLocaleString()} 個；請縮小 pattern。`);
    const boundary=g=>{
        if(!headers.has(g)) {
            const node=synthetic(`outside:b${g}`,`外部 block ${g} · ${index.graphs[g].graph.name.split('/').at(-1)}`,g,'boundary');
            node.description='未展開的外部 block；控制流程及各出口的 SSA 傳值依實際 IR 保留。';
            nodes.push(node);headers.set(g,node);
        }
        return headers.get(g);
    };
    for(const edge of controls) {
        const from=entry.nodes[edge.from].graph,to=entry.nodes[edge.to].graph,s=Number(edge.port);
        const source=index.mlir.graphs[from],term=source.operations.find(op=>op.successors?.length),op=graphs.has(from)?ops.get(entry.opIds.get(term)):boundary(from);
        if(!op)throw new Error('找不到控制流程的來源 terminator。');
        const route=synthetic(`route:${from}:${s}`,`出口 ${s} → block ${to}`,from,'route');
        route.targetGraph=to;
        route.description='此節點表示實際 successor 邊及其 block argument 傳值，不是原始 MLIR operator。';
        nodes.push(route);routes.set(`${from}:${s}`,route);
        connect(op,route,token(`branch:${from}:${s}`,`block ${from} · 出口 ${s}`),true);
        connect(route,boundary(to),token(`control:${from}:${s}`,`控制 ${from} → ${to} · 出口 ${s}`),true);
    }
    const rawValues=new Map([...entry.values].map(([raw,loc])=>[`${loc.id}:${loc.port}`,raw]));
    for(const edge of entry.edges)if(edge.kind==='argument') {
        const destination=entry.nodes[edge.to],target=argumentsById.get(edge.to) || (boundaryContext && !graphs.has(destination.graph) && headers.get(destination.graph)),[port,s]=edge.port.split(':').map(Number),source=entry.nodes[edge.from];
        if(!target)continue;
        {
            const from=edge.branch,raw=rawValues.get(`${edge.from}:${port}`),route=routes.get(`${from}:${s}`);
            if(!route)continue;
            const template=source.kind==='operator'?index.graphs[source.graph].graph.nodes[source.node].outputs[port]?.value[0]:index.graphs[source.graph].graph.inputs[source.slot]?.value[0];
            const input=rawValue(raw,template);
            if(!route.inputs.some(a=>a.value[0]===input))route.inputs.push(arg(input.name,input));
            const targetValue=target.diagramKind==='boundary'?index.graphs[destination.graph].graph.inputs[destination.slot].value[0]:target.outputs[0].value[0];
            const binding=token(`binding:${from}:${s}:${edge.to}`,`${input.name} → ${targetValue.name} · 出口 ${s}`);
            binding.type=serialize(targetValue.type);
            connect(route,target,binding);
        }
    }
    if(boundaryContext)for(const [raw,value] of values) {
        const location=entry.values.get(raw),source=location && entry.nodes[location.id],header=source && headers.get(source.graph);
        if(header?.diagramKind==='boundary' && !header.outputs.some(a=>a.value.includes(value)))header.outputs.push(arg(value.name,value));
    }
    const produced=new Set(nodes.flatMap(n=>n.outputs.flatMap(a=>a.value))),inputs=new Map();
    for(const node of nodes)for(const a of node.inputs)for(const value of a.value)if(!produced.has(value))inputs.set(value.identifier,arg(`邊界輸入 · ${value.name}`,value));
    const selected=item.blocks.flatMap(b=>b.path.map(n=>`b${b.graph}:n${n}`));
    const outputs=[],externalUses=new Set(entry.edges.filter(e=>e.kind==='ssa' && !ops.has(e.to)).map(e=>`${e.from}:${e.port.split(':')[0]}`));
    if(boundaryContext)for(const [raw,value] of values) {
        const location=entry.values.get(raw),owner=location && (ops.get(location.id) || argumentsById.get(location.id));
        if(owner && externalUses.has(`${location.id}:${location.port}`))outputs.push(arg(`邊界輸出 · ${value.name}`,value));
    }
    const graph={name:`跨 block 匹配 · ${graphs.size} blocks`,groups:true,nodes,inputs:[...inputs.values()],outputs,metadata:[]};
    return {graph:lightweight?graph:serialize(graph),graphIndex:item.graph,nodes:nodes.map(n=>n.identifier),selected,total,full,combined:true,focus,links,item:{...item,connections:[]}};
}
