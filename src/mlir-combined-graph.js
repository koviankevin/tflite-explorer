import {serialize} from './model-engine.js?v=6e7883d91ddec2ad';

// Display projection only. The source AST, block-local indexes and export
// selections remain unchanged. SSA identity comes from the validated region,
// never from a printed name (which may be reused in other scopes).
export function combinedMLIRSnapshot(index,item,entry,{full=false}={}) {
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
            values.set(raw,{...serialize(template || {}),identifier:id,name:`${owner?`b${owner.graph}`:'外部'}:${name}`,initializer:null});
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
    if([...chosen.values()].reduce((n,s)=>n+s.size,0)>1500)throw new Error('相關 blocks 超過 1,500 個 operators；請使用局部圖或縮小 pattern。');
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
            const node={...serialize(original),identifier:`b${g}:n${n}`,group:group(g),sourceGraph:g,sourceNode:n,diagramKind:'operator',inputs:[],outputs:[]};
            for(const [i,use] of row.uses.entries())node.inputs.push(arg(original.inputs[i]?.name || 'operand',rawValue(use.value,original.inputs[i]?.value[0])));
            for(const [i,value] of (op.results || []).entries())node.outputs.push(arg(original.outputs[i]?.name || 'result',rawValue(value,original.outputs[i]?.value[0])));
            nodes.push(node);ops.set(entry.opIds.get(op),node);focus[g].push(node.identifier);
            if(op.successors?.length)connect(header,node,token(`enter:${g}`,`進入 block ${g}`),true);
        }
        if(!focus[g].length)focus[g].push(header.identifier);
    }
    const routes=new Map(),controls=entry.edges.filter(e=>e.kind==='control' && graphs.has(entry.nodes[e.from].graph) && graphs.has(entry.nodes[e.to].graph));
    if(controls.length>512)throw new Error('此匹配的控制出口超過 512 個；請縮小 pattern。');
    for(const edge of controls) {
        const from=entry.nodes[edge.from].graph,to=entry.nodes[edge.to].graph,s=Number(edge.port);
        const source=index.mlir.graphs[from],term=source.operations.find(op=>op.successors?.length),op=ops.get(entry.opIds.get(term));
        if(!op)throw new Error('找不到控制流程的來源 terminator。');
        const route=synthetic(`route:${from}:${s}`,`出口 ${s} → block ${to}`,from,'route');
        route.description='此節點表示實際 successor 邊及其 block argument 傳值，不是原始 MLIR operator。';
        nodes.push(route);routes.set(`${from}:${s}`,route);
        connect(op,route,token(`branch:${from}:${s}`,`block ${from} · 出口 ${s}`),true);
        connect(route,headers.get(to),token(`control:${from}:${s}`,`控制 ${from} → ${to} · 出口 ${s}`),true);
    }
    const rawValues=new Map([...entry.values].map(([raw,loc])=>[`${loc.id}:${loc.port}`,raw]));
    for(const edge of entry.edges)if(edge.kind==='argument') {
        const target=argumentsById.get(edge.to),[port,s]=edge.port.split(':').map(Number),source=entry.nodes[edge.from];
        if(!target)continue;
        {
            const from=edge.branch,raw=rawValues.get(`${edge.from}:${port}`),route=routes.get(`${from}:${s}`);
            if(!route)continue;
            const template=source.kind==='operator'?index.graphs[source.graph].graph.nodes[source.node].outputs[port]?.value[0]:index.graphs[source.graph].graph.inputs[source.slot]?.value[0];
            const input=rawValue(raw,template);
            if(!route.inputs.some(a=>a.value[0]===input))route.inputs.push(arg(input.name,input));
            const binding=token(`binding:${from}:${s}:${edge.to}`,`${input.name} → ${target.outputs[0].value[0].name} · 出口 ${s}`);
            binding.type=serialize(target.outputs[0].value[0].type);
            connect(route,target,binding);
        }
    }
    const produced=new Set(nodes.flatMap(n=>n.outputs.flatMap(a=>a.value))),inputs=new Map();
    for(const node of nodes)for(const a of node.inputs)for(const value of a.value)if(!produced.has(value))inputs.set(value.identifier,arg(`邊界輸入 · ${value.name}`,value));
    const selected=item.blocks.flatMap(b=>b.path.map(n=>`b${b.graph}:n${n}`));
    const graph={name:`跨 block 匹配 · ${graphs.size} blocks`,groups:true,nodes,inputs:[...inputs.values()],outputs:[],metadata:[]};
    return {graph:serialize(graph),graphIndex:item.graph,nodes:nodes.map(n=>n.identifier),selected,total,full,combined:true,focus,links,item:{...item,connections:[]}};
}
