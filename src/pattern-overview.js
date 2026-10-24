import {serialize} from './model-engine.js?v=b650d0c157721586';
import {overviewLayout} from './overview-layout.js?v=b650d0c157721586';

const MAX_VISIBLE_NODES=1500;
const outputs=node=>node.outputs.flatMap(a=>a.value);
const location=(g,n)=>`${g}:${n}`;

// Prepared once per completed search, kept in the Worker. Every contraction is
// O(nodes + value uses + matched operators), including cross-capsule wiring.
export async function preparePatternOverview(index,items,{name='Pattern',cancelled=()=>false}={}) {
    const total=index.graphs.reduce((n,g)=>n+g.graph.nodes.length,0);
    if(!items.length || items.some(item=>item.kind!=='patterns'))throw new Error('請先搜尋 pattern。');
    // Keep only a wiring projection here. Hidden OP attributes and initializers
    // must not be serialized before contraction has determined what is visible.
    const parts=index.mlir ? (await import('./mlir-pattern.js?v=b650d0c157721586')).mlirModelSnapshots(index,{lightweight:true}) : index.graphs.map((entry,g)=>({graph:entry.graph,graphIndex:g}));
    const graph={name:'全模型 pattern 總覽',groups:true,nodes:[],inputs:[],outputs:[],metadata:[]},locations=new Map();
    let lastYield=performance.now();
    const checkpoint=async()=>{if(performance.now()-lastYield>12){await new Promise(resolve=>setTimeout(resolve,0));lastYield=performance.now();}return cancelled();};
    for(const [p,dto] of parts.entries()) {
        const values=new Map();
        const visit=value=>{if(!values.has(value))values.set(value,{...value,identifier:`scope:${p}:${value.identifier}`,name:`scope ${p} · ${value.name}`});return values.get(value);};
        const argumentsCopy=args=>args.map(a=>({...a,value:a.value.map(visit)}));
        graph.inputs.push(...argumentsCopy(dto.graph.inputs));graph.outputs.push(...argumentsCopy(dto.graph.outputs));
        for(const [i,original] of dto.graph.nodes.entries()) {
            if(i%256===0 && await checkpoint())return null;
            const node={...original,inputs:argumentsCopy(original.inputs),outputs:argumentsCopy(original.outputs),controlDependencies:(original.controlDependencies || []).map(visit)};
            const g=index.mlir?node.sourceGraph:dto.graphIndex,n=index.mlir?node.sourceNode:i;
            node.identifier=`scope:${p}:${node.identifier}`;
            const scope=index.mlir?`region ${p} · ${index.graphs[g].graph.name.match(/@[^/]+/)?.[0] || 'region'}`:`subgraph ${g} · ${index.graphs[g].graph.name}`;
            node.group=index.mlir?`${scope}/${node.group}`:scope;
            if(!index.mlir)Object.assign(node,{diagramKind:'operator',sourceGraph:g,sourceNode:n});
            if(node.diagramKind==='operator')locations.set(location(g,n),node);
            graph.nodes.push(node);
        }
    }
    const claimed=new Map(),matches=[];
    for(const [i,item] of items.entries()) {
        if(i%256===0 && await checkpoint())return null;
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

export function patternOverviewSnapshot(prepared,{expanded=[],active=0,font=18,direction='vertical'}={}) {
    const {graph,matches,owners}=prepared,open=new Set(expanded),capsules=new Map();
    for(const match of matches)if(match.foldable && !open.has(match.index)) {
        const sourceGraphs=[...new Set(match.nodes.map(n=>n.sourceGraph))];
        capsules.set(match.index,{identifier:match.id,name:`${match.name} #${match.index+1} · ${match.nodes.length} OP · 點開`,type:{name:`Pattern #${match.index+1}`,identifier:'model_lens.pattern',category:'Control'},group:match.group,diagramKind:'pattern',matchIndex:match.index,sourceGraphs,inputs:[],outputs:[],controlDependencies:[],attributes:[{name:'匹配 OP',type:'string',value:String(match.nodes.length)},{name:'原始位置',type:'string',value:match.nodes.map(n=>`block/subgraph ${n.sourceGraph} #${n.sourceNode}`).join(', ')}],metadata:[],blocks:[],description:'點選或按 Enter 單獨展開；其他匹配保持收合。搜尋、匯出仍使用原始 OP。'});
    }
    const shown=node=>capsules.get(owners.get(node)) || node;
    const nodes=graph.nodes.filter(n=>shown(n)===n).concat([...capsules.values()]);
    const virtual=nodes.length>MAX_VISIBLE_NODES;
    const producer=new Map();
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
    const visibleOwner=new Map();for(const node of nodes)for(const value of outputs(node))visibleOwner.set(value,node.identifier);
    const links=[];for(const node of nodes)for(const [kind,values] of [['ssa',node.inputs.flatMap(a=>a.value)],['control',node.controlDependencies || []]])for(const value of values) {
        const from=visibleOwner.get(value);if(from!==undefined && from!==node.identifier)links.push({from,to:node.identifier,kind,value:value.identifier});
    }
    const list=matches.map(match=>({index:match.index,operatorCount:match.nodes.length,foldable:match.foldable,overlaps:match.overlaps,collapsed:capsules.has(match.index),nodes:[...new Set(match.nodes.map(n=>shown(n).identifier))]}));
    const current=matches[active] || matches[0],visible=list[current.index];
    let display,layout;
    if(virtual){
        const light=nodes.map(n=>({identifier:n.identifier,name:n.name,type:{name:n.type?.name,identifier:n.type?.identifier},group:n.group,diagramKind:n.diagramKind,matchIndex:n.matchIndex,sourceGraph:n.sourceGraph,sourceNode:n.sourceNode,sourceGraphs:n.sourceGraphs}));
        const consumers=new Map(),byId=new Map(nodes.map(n=>[n.identifier,n]));for(const n of nodes)for(const a of n.inputs)for(const v of a.value){if(!consumers.has(v))consumers.set(v,[]);consumers.get(v).push(n);}
        for(const [kind,args] of [['input',graph.inputs],['output',graph.outputs]])for(const a of args)for(const value of a.value){
            const adjacent=kind==='input'?consumers.get(value) || []:[byId.get(visibleOwner.get(value))].filter(Boolean);if(!adjacent.length)continue;
            const identifier=`boundary:${kind}:${value.identifier}`,first=adjacent[0];light.push({identifier,name:`${kind==='input'?'輸入':'輸出'} · ${value.name}`,type:{name:kind==='input'?'Input':'Output'},group:first.group,sourceGraph:first.sourceGraph,diagramKind:'boundary'});
            for(const n of adjacent)links.push({from:kind==='input'?identifier:n.identifier,to:kind==='input'?n.identifier:identifier,kind:'ssa',value:value.identifier});
        }
        display={name:graph.name,nodes:light,inputs:[],outputs:[],metadata:[]};layout=overviewLayout(light,links,{font:Number(font),direction});
    }else display=serialize({...graph,nodes});
    return {graph:display,layout,virtual,graphIndex:current.item.graph,nodes:display.nodes.map(n=>n.identifier),selected:visible.nodes,total:prepared.total,full:true,combined:prepared.combined,overview:true,folded:capsules.size>0,overviewMatches:list,collapsedCount:capsules.size,overlapCount:list.filter(m=>!m.foldable).length,links,item:{...current.item,connections:[]},activeIndex:current.index,focus:{}};
}
