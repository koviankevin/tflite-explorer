import {serialize} from './model-engine.js?v=48cf132f532c0b5d';

const pair=(from,to)=>`${from}>${to}`;
const edgeKey=e=>`${e.from}>${e.to}:${e.kind}:${e.value.identifier}`;

function wiring(detail) {
    const nodes=new Map(detail.graph.nodes.map(n=>[n.identifier,n])),owners=new Map(),edges=[];
    for(const n of nodes.values())for(const a of n.outputs)for(const v of a.value)owners.set(v.identifier,n.identifier);
    for(const n of nodes.values())for(const [kind,values] of [['ssa',n.inputs.flatMap(a=>a.value)],['control',n.controlDependencies || []]])for(const value of values) {
        const from=owners.get(value.identifier);
        // Labels are display aliases; source SSA names remain on argument OPs
        // and in the untouched IR. Keep aliases unique for Netron's value map.
        const route=/^route:(\d+):(\d+)$/.exec(from),argument=/^b(\d+):a(\d+)$/.exec(n.identifier);
        const shown=route && argument && kind==='ssa'?{...value,name:`b${route[1]}→b${argument[1]} arg #${argument[2]} /${route[2]}`}:value;
        if(from && !(kind==='control' && nodes.get(from).diagramKind==='block'))edges.push({from,to:n.identifier,kind,value:shown});
    }
    // Control flow enters the first OP and follows block order. The ordinary
    // full view connects headers directly to terminators for visual routing.
    const blocks=new Map();
    for(const n of nodes.values())if(n.diagramKind==='operator'){if(!blocks.has(n.sourceGraph))blocks.set(n.sourceGraph,[]);blocks.get(n.sourceGraph).push(n);}
    for(const [g,ops] of blocks) {
        ops.sort((a,b)=>a.sourceNode-b.sourceNode);
        const chain=[`b${g}`,...ops.map(n=>n.identifier)];
        for(let i=1;i<chain.length;i++)edges.push({from:chain[i-1],to:chain[i],kind:'control',value:{identifier:`sequence:${g}:${i}`,name:`block ${g} · 順序 ${i}`,type:{dataType:'control',shape:{dimensions:[]}},initializer:null}});
    }
    return {nodes,edges};
}

// Find the corridor between two displayed OPs, stopping at every other
// displayed OP. Forward/reverse reachability preserves loops and shared paths
// without enumerating exponentially many paths or crossing unrelated OPs.
function corridor(edges,from,to,original,kind) {
    const allowed=id=>!original.has(id) || id===from || id===to,filtered=edges.filter(e=>e.kind===kind && allowed(e.from) && allowed(e.to));
    const next=new Map(),previous=new Map();
    for(const e of filtered){if(!next.has(e.from))next.set(e.from,[]);next.get(e.from).push(e.to);if(!previous.has(e.to))previous.set(e.to,[]);previous.get(e.to).push(e.from);}
    const reach=(start,stop,map)=>{
        const found=new Set(),stack=[start];
        while(stack.length){const n=stack.pop();if(found.has(n))continue;found.add(n);if(n===stop && n!==start)continue;stack.push(...map.get(n) || []);}
        return found;
    };
    const forward=reach(from,to,next),backward=reach(to,from,previous);
    return filtered.filter(e=>forward.has(e.from) && backward.has(e.to) && (e.from!==to || from===to) && (e.to!==from || from===to));
}

export function connectionSliceView(compact,{expandedConnections=[],detail}={}) {
    const original=new Map(compact.graph.nodes.map(n=>[n.identifier,n])),groups=new Map();
    for(const link of compact.links) {
        const key=pair(link.from,link.to);
        if(!groups.has(key))groups.set(key,{key,from:link.from,to:link.to,label:`${original.get(link.from).type.name} → ${original.get(link.to).type.name} · blocks ${original.get(link.from).sourceGraph} → ${original.get(link.to).sourceGraph}`,links:[],expanded:false,helpers:0});
        groups.get(key).links.push(link);
    }
    const requested=new Set(Array.isArray(expandedConnections)?expandedConnections.slice(0,256):[]),plans=new Map();
    let actual;
    if([...requested].some(k=>groups.has(k)))actual=wiring(detail());
    for(const group of groups.values())if(requested.has(group.key)) {
        const planned=new Map();
        for(const kind of new Set(group.links.map(e=>e.kind)))for(const e of corridor(actual.edges,group.from,group.to,original,kind))planned.set(edgeKey(e),e);
        // A control exit also carries SSA values. Show only this exit's
        // arguments and their local consumers, keeping other exits collapsed.
        const routes=new Set([...planned.values()].flatMap(e=>[e.from,e.to]).filter(id=>actual.nodes.get(id)?.diagramKind==='route'));
        for(const e of actual.edges)if(e.kind==='ssa' && (routes.has(e.from) || routes.has(e.to) && (original.has(e.from) || actual.nodes.get(e.from)?.diagramKind==='argument')))planned.set(edgeKey(e),e);
        const helpers=new Set([...planned.values()].flatMap(e=>[e.from,e.to]).filter(id=>!original.has(id)));
        for(const e of actual.edges)if(e.kind==='ssa' && helpers.has(e.from) && actual.nodes.get(e.from)?.diagramKind==='argument' && (original.has(e.to) || helpers.has(e.to)))planned.set(edgeKey(e),e);
        if(helpers.size){group.expanded=true;group.helpers=helpers.size;plans.set(group.key,planned);}
    }
    const nodes=new Map(),edges=new Map(),actions=new Map();
    const addNode=id=>{
        if(nodes.has(id))return;
        const template=original.get(id) || actual.nodes.get(id),node={...serialize(template),inputs:[],outputs:[]};delete node.controlDependencies;
        if(!original.has(id)){node.sliceHelper=true;if(node.diagramKind==='operator')node.diagramKind='slice-helper';}
        nodes.set(id,node);
    };
    for(const id of original.keys())addNode(id);
    const addEdge=(e,key)=>{
        addNode(e.from);addNode(e.to);edges.set(edgeKey(e),e);
        const p=pair(e.from,e.to);if(!actions.has(p))actions.set(p,new Set());actions.get(p).add(key);
    };
    for(const group of groups.values()) {
        if(plans.has(group.key))for(const e of plans.get(group.key).values())addEdge(e,group.key);
        else for(const e of group.links) {
            const value=original.get(e.from).outputs.flatMap(a=>a.value).find(v=>v.identifier===e.value);
            addEdge({...e,value},group.key);
        }
    }
    if(nodes.size-original.size>512)throw new Error('局部路徑超過 512 個輔助節點；請先收起其他路徑，或使用完整輔助節點檢視。');
    const values=new Map();
    for(const e of edges.values()) {
        const key=`${e.from}:${e.value.identifier}`;if(!values.has(key))values.set(key,serialize(e.value));const value=values.get(key),from=nodes.get(e.from),to=nodes.get(e.to);
        if(!from.outputs.some(a=>a.value.includes(value)))from.outputs.push({name:value.name,value:[value]});
        if(e.kind==='control'){to.controlDependencies ||= [];if(!to.controlDependencies.includes(value))to.controlDependencies.push(value);}
        else if(!to.inputs.some(a=>a.value.includes(value)))to.inputs.push({name:value.name,value:[value]});
    }
    return {...compact,graph:{...compact.graph,nodes:[...nodes.values()]},nodes:[...nodes.keys()],links:[...edges.values()].map(e=>({from:e.from,to:e.to,kind:e.kind})),sliceConnections:[...groups.values()].map(({links,...g})=>g),sliceDirectConnection:[...groups.values()].some(g=>requested.has(g.key) && !g.expanded),sliceEdgeActions:[...actions].map(([p,keys])=>{const [from,to]=p.split('>');return {from,to,keys:[...keys]};}),sliceHelperCount:nodes.size-original.size};
}
