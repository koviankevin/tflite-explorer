// A reversible display contraction. The caller retains the original match for
// search, capture and export; no source operations or value identities change.
export function foldPatternSnapshot(dto,{name='Pattern'}={}) {
    if(dto.metadataOnly || dto.item?.kind!=='patterns' || !dto.selected.length)return dto;
    const graph=dto.graph,selected=new Set(dto.selected.map(String)),blocks=new Set(dto.item.blocks?.map(b=>b.graph));
    const hidden=new Set(),ids=new Map(graph.nodes.map((node,i)=>[node,String(dto.nodes[i])]));
    for(const node of graph.nodes) {
        if(selected.has(ids.get(node)) || (dto.combined && blocks.has(node.sourceGraph) && (
            node.diagramKind==='block' || (node.diagramKind==='argument' && node.inputs.length>0) ||
            (node.diagramKind==='route' && blocks.has(node.targetGraph)) ||
            (node.diagramKind==='operator' && node.controlTerminator)
        )))hidden.add(node);
    }
    if(!hidden.size)return dto;
    let id='pattern:collapsed';while(graph.nodes.some(n=>n.identifier===id))id+=':';
    const capsule={identifier:id,name:`${name} · ${dto.selected.length} OP · 點開`,type:{name:'Pattern',identifier:'model_lens.pattern',category:'Control'},diagramKind:'pattern',inputs:[],outputs:[],controlDependencies:[],attributes:[],metadata:[],blocks:[],description:'點選或按 Enter 展開原始 OP。保留每個對外 SSA／tensor 與 successor 傳值；收合不影響搜尋或子模型匯出。'};
    const produced=new Set(),outsideUses=new Set(graph.outputs.flatMap(a=>a.value)),insideUses=new Map();
    for(const node of graph.nodes) {
        if(hidden.has(node))for(const a of node.outputs)for(const v of a.value)produced.add(v);
        const uses=[...node.inputs.flatMap(a=>a.value),...(node.controlDependencies || [])];
        if(hidden.has(node)) {
            for(const a of node.inputs)for(const v of a.value)insideUses.set(v,(insideUses.get(v)||0)|1);
            for(const v of node.controlDependencies || [])insideUses.set(v,(insideUses.get(v)||0)|2);
        } else for(const v of uses)outsideUses.add(v);
    }
    for(const [value,kinds] of insideUses)if(!produced.has(value)) {
        if(kinds&1)capsule.inputs.push({name:value.name,value:[value]});
        if(kinds&2)capsule.controlDependencies.push(value);
    }
    for(const value of produced)if(outsideUses.has(value))capsule.outputs.push({name:value.name,value:[value]});
    const routes=[...hidden].filter(n=>n.diagramKind==='route');
    capsule.attributes.push({name:'匹配 OP',type:'string',value:String(dto.selected.length)},{name:'包含的 blocks',type:'string',value:[...blocks].join(', ') || String(dto.graphIndex)},{name:'內部控制路徑',type:'string',value:String(routes.length)});
    const nodes=graph.nodes.filter(n=>!hidden.has(n));nodes.push(capsule);
    const owner=new Map();for(const node of nodes)for(const a of node.outputs)for(const v of a.value)owner.set(v,node.identifier);
    const links=[];
    for(const node of nodes)for(const [kind,values] of [['ssa',node.inputs.flatMap(a=>a.value)],['control',node.controlDependencies || []]])for(const value of values) {
        const from=owner.get(value);if(from!==undefined && from!==node.identifier)links.push({from,to:node.identifier,kind,value:value.identifier});
    }
    const mapped=new Map([...hidden].map(n=>[n.identifier,id]));
    const focus=dto.focus && Object.fromEntries(Object.entries(dto.focus).map(([g,values])=>[g,[...new Set(values.map(v=>mapped.get(v) || v))]]));
    return {...dto,graph:{...graph,name:`${graph.name} · 收合 pattern`,nodes},nodes:nodes.map(n=>n===capsule?id:ids.get(n)),selected:[id],focus,links,detail:null,folded:true,matchedOperatorCount:dto.selected.length,item:{...dto.item,connections:[]}};
}
