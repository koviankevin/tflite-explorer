import {serialize,snapshot} from './model-engine.js';

const MAX_SOURCE_OPERATORS=20000,MAX_MATCHES=1500,MAX_VISIBLE_NODES=1500;
const operands=node=>[...node.inputs.flatMap(a=>a.value),...(node.controlDependencies || [])];
const outputs=node=>node.outputs.flatMap(a=>a.value);
const location=(g,n)=>`${g}:${n}`;

// Prepared once per completed search, kept in the Worker. Every contraction is
// O(nodes + value uses + matched operators), including cross-capsule wiring.
export async function preparePatternOverview(index,items,{name='Pattern'}={}) {
    const total=index.graphs.reduce((n,g)=>n+g.graph.nodes.length,0);
    if(total>MAX_SOURCE_OPERATORS)throw new Error('全模型總覽最多處理 20,000 個原始 OP；請使用目前匹配的局部圖。');
    if(!items.length || items.some(item=>item.kind!=='patterns'))throw new Error('請先搜尋 pattern。');
    if(items.length>MAX_MATCHES)throw new Error('全模型總覽最多處理 1,500 筆搜尋結果；請縮小搜尋範圍。');
    const parts=index.mlir ? (await import('./mlir-pattern.js')).mlirModelSnapshots(index) : index.graphs.map((_,g)=>snapshot(index,g,[],true));
    const graph={name:'全模型 pattern 總覽',groups:true,nodes:[],inputs:[],outputs:[],metadata:[]},locations=new Map();
    for(const [p,dto] of parts.entries()) {
        const copy=serialize(dto.graph),values=new Map();
        const visit=value=>{if(values.has(value))return;values.set(value,true);value.identifier=`scope:${p}:${value.identifier}`;value.name=`scope ${p} · ${value.name}`;};
        for(const a of [...copy.inputs,...copy.outputs])for(const value of a.value)visit(value);
        for(const [i,node] of copy.nodes.entries()) {
            const g=index.mlir?node.sourceGraph:dto.graphIndex,n=index.mlir?node.sourceNode:dto.nodes[i];
            node.identifier=`scope:${p}:${node.identifier}`;
            const scope=index.mlir?`region ${p} · ${index.graphs[g].graph.name.match(/@[^/]+/)?.[0] || 'region'}`:`subgraph ${g} · ${index.graphs[g].graph.name}`;
            node.group=index.mlir?`${scope}/${node.group}`:scope;
            if(!index.mlir)Object.assign(node,{diagramKind:'operator',sourceGraph:g,sourceNode:n});
            if(node.diagramKind==='operator')locations.set(location(g,n),node);
            for(const value of [...operands(node),...outputs(node)])visit(value);
        }
        graph.nodes.push(...copy.nodes);graph.inputs.push(...copy.inputs);graph.outputs.push(...copy.outputs);
    }
    const claimed=new Map(),matches=[];
    for(const [i,item] of items.entries()) {
        const blocks=item.blocks || [{graph:item.graph,path:item.path}],nodes=[...new Set(blocks.flatMap(b=>b.path.map(n=>locations.get(location(b.graph,n)))))];
        if(nodes.some(n=>!n) || !nodes.length)throw new Error('搜尋結果已失效，請重新搜尋。');
        const overlaps=[...new Set(nodes.map(n=>claimed.get(n)).filter(n=>n!==undefined))];
        const match={index:i,item,nodes,hidden:new Set(nodes),id:`pattern:match:${i}`,name,group:index.mlir?nodes[0].group.split('/')[0]:nodes[0].group,overlaps,foldable:!overlaps.length};
        if(match.foldable)for(const node of nodes)claimed.set(node,i);
        matches.push(match);
    }
    // Shared block scaffolding cannot belong to two independent occurrences.
    // Absorb it only when a block has exactly one match and no unrelated data OP.
    const blockNodes=new Map(),blockOwner=new Map();
    for(const node of graph.nodes)if(node.diagramKind==='operator') {
        if(!blockNodes.has(node.sourceGraph))blockNodes.set(node.sourceGraph,[]);
        blockNodes.get(node.sourceGraph).push(node);
    }
    if(index.mlir)for(const [g,nodes] of blockNodes) {
        const owners=new Set(nodes.map(n=>claimed.get(n)).filter(n=>n!==undefined));
        if(owners.size!==1)continue;const owner=[...owners][0];
        if(nodes.every(n=>claimed.get(n)===owner || n.controlTerminator)) {
            blockOwner.set(g,owner);
            for(const n of nodes)if(n.controlTerminator){matches[owner].hidden.add(n);claimed.set(n,owner);}
        }
    }
    if(index.mlir)for(const node of graph.nodes) {
        const owner=blockOwner.get(node.sourceGraph);if(owner===undefined)continue;
        if(node.diagramKind==='block' || (node.diagramKind==='argument' && node.inputs.length) || (node.diagramKind==='route' && blockOwner.get(node.targetGraph)===owner))matches[owner].hidden.add(node);
    }
    const owners=new Map();for(const match of matches)if(match.foldable)for(const node of match.hidden)owners.set(node,match.index);
    return {graph,matches,owners,total,combined:!!index.mlir};
}

export function patternOverviewSnapshot(prepared,{expanded=[],active=0}={}) {
    const {graph,matches,owners}=prepared,open=new Set(expanded),capsules=new Map();
    for(const match of matches)if(match.foldable && !open.has(match.index)) {
        const sourceGraphs=[...new Set(match.nodes.map(n=>n.sourceGraph))];
        capsules.set(match.index,{identifier:match.id,name:`${match.name} #${match.index+1} · ${match.nodes.length} OP · 點開`,type:{name:`Pattern #${match.index+1}`,identifier:'model_lens.pattern',category:'Control'},group:match.group,diagramKind:'pattern',matchIndex:match.index,sourceGraphs,inputs:[],outputs:[],controlDependencies:[],attributes:[{name:'匹配 OP',type:'string',value:String(match.nodes.length)},{name:'原始位置',type:'string',value:match.nodes.map(n=>`block/subgraph ${n.sourceGraph} #${n.sourceNode}`).join(', ')}],metadata:[],blocks:[],description:'點選或按 Enter 單獨展開；其他匹配保持收合。搜尋、匯出仍使用原始 OP。'});
    }
    const shown=node=>capsules.get(owners.get(node)) || node,producer=new Map();
    for(const node of graph.nodes)for(const value of outputs(node))producer.set(value,node);
    const inputKinds=new Map(),outputValues=new Map();
    const add=(map,node,value,kind)=>{if(!map.has(node))map.set(node,new Map());const values=map.get(node);values.set(value,(values.get(value)||0)|kind);};
    for(const node of graph.nodes)for(const [kind,values] of [[1,node.inputs.flatMap(a=>a.value)],[2,node.controlDependencies || []]])for(const value of values) {
        const from=producer.get(value),a=from && shown(from),b=shown(node);
        if(a===b)continue;
        if(b!==node)add(inputKinds,b,value,kind);
        if(from && a!==from)add(outputValues,a,value,1);
    }
    for(const a of graph.outputs)for(const value of a.value) {const from=producer.get(value);if(from && shown(from)!==from)add(outputValues,shown(from),value,1);}
    for(const capsule of capsules.values()) {
        for(const [value,kind] of inputKinds.get(capsule) || []) {
            if(kind&1)capsule.inputs.push({name:value.name,value:[value]});if(kind&2)capsule.controlDependencies.push(value);
        }
        for(const value of (outputValues.get(capsule) || new Map()).keys())capsule.outputs.push({name:value.name,value:[value]});
    }
    const nodes=graph.nodes.filter(n=>shown(n)===n).concat([...capsules.values()]);
    if(nodes.length>MAX_VISIBLE_NODES)throw new Error('展開後超過 1,500 個可見節點；請收合部分匹配，或返回局部圖。');
    const visibleOwner=new Map();for(const node of nodes)for(const value of outputs(node))visibleOwner.set(value,node.identifier);
    const links=[];for(const node of nodes)for(const [kind,values] of [['ssa',node.inputs.flatMap(a=>a.value)],['control',node.controlDependencies || []]])for(const value of values) {
        const from=visibleOwner.get(value);if(from!==undefined && from!==node.identifier)links.push({from,to:node.identifier,kind,value:value.identifier});
    }
    const list=matches.map(match=>({index:match.index,operatorCount:match.nodes.length,foldable:match.foldable,overlaps:match.overlaps,collapsed:capsules.has(match.index),nodes:[...new Set(match.nodes.map(n=>shown(n).identifier))]}));
    const current=matches[active] || matches[0],visible=list[current.index];
    return {graph:{...graph,nodes},graphIndex:current.item.graph,nodes:nodes.map(n=>n.identifier),selected:visible.nodes,total:prepared.total,full:true,combined:prepared.combined,overview:true,folded:capsules.size>0,overviewMatches:list,collapsedCount:capsules.size,overlapCount:list.filter(m=>!m.foldable).length,links,item:{...current.item,connections:[]},activeIndex:current.index,focus:{}};
}
