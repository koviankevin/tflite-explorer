import {serialize} from './model-engine.js?v=e67611582982ec3f';

const pair=(from,to)=>`${from}>${to}`;
const edgeKey=e=>`${e.from}>${e.to}:${e.kind}:${e.value.identifier}`;
const PAGE_SIZE=96,HELPER_LIMIT=512,WORK_LIMIT=50000;

// Resumable corridor discovery. Every adjacency visit consumes the work budget;
// no display nodes or complete path lists are constructed during traversal.
function* discover(actual,group,original,state) {
    const allowed=id=>!original.has(id) || id===group.from || id===group.to;
    function* reach(start,stop,kind,reverse) {
        const found=new Set(),stack=[start];
        while(stack.length) {
            const id=stack.pop();yield;
            if(found.has(id))continue;found.add(id);
            if(id===stop && id!==start)continue;
            for(const e of (reverse?actual.incoming(id,kind):actual.outgoing(id,kind))) {
                yield;const other=reverse?e.from:e.to;if(allowed(other) && !found.has(other))stack.push(other);
            }
        }
        return found;
    }
    for(const kind of new Set(group.links.map(e=>e.kind))) {
        const forward=yield* reach(group.from,group.to,kind,false),backward=yield* reach(group.to,group.from,kind,true);
        for(const id of forward)for(const e of actual.outgoing(id,kind)) {
            yield;
            if(allowed(e.to) && backward.has(e.to) && (e.from!==group.to || group.from===group.to) && (e.to!==group.from || group.from===group.to))state.edges.set(edgeKey(e),e);
        }
    }
    const routes=new Set();
    for(const e of state.edges.values()){yield;for(const id of [e.from,e.to])if(actual.kind(id)==='route')routes.add(id);}
    for(const id of routes) {
        for(const e of actual.outgoing(id,'ssa')){yield;state.edges.set(edgeKey(e),e);}
        for(const e of actual.incoming(id,'ssa')){yield;if(original.has(e.from) || actual.kind(e.from)==='argument')state.edges.set(edgeKey(e),e);}
    }
    const helpers=new Set();
    for(const e of state.edges.values()){yield;for(const id of [e.from,e.to])if(!original.has(id))helpers.add(id);}
    for(const id of helpers)if(actual.kind(id)==='argument')for(const e of actual.outgoing(id,'ssa')){yield;if(original.has(e.to) || helpers.has(e.to))state.edges.set(edgeKey(e),e);}
    const next=new Map();
    for(const e of state.edges.values()){yield;if(!next.has(e.from))next.set(e.from,[]);next.get(e.from).push(e.to);}
    const visited=new Set(),queue=[group.from],order=[];
    for(let i=0;i<queue.length;i++) {
        const id=queue[i];yield;if(visited.has(id))continue;visited.add(id);
        if(helpers.has(id))order.push(id);
        for(const to of next.get(id) || []){yield;if(!visited.has(to))queue.push(to);}
    }
    for(const id of helpers){yield;if(!visited.has(id))order.push(id);}
    state.helpers=order;state.done=true;
}
const planKey=(group,original)=>`${[...original.keys()].sort().join(',')}|${group.key}|${[...new Set(group.links.map(e=>e.kind))].sort().join(',')}`;
function pathPlan(actual,group,original,budget,activeKeys) {
    const key=planKey(group,original);
    let state=actual.plans.get(key);const hit=!!state;
    if(state)actual.plans.delete(key);
    else {state={edges:new Map(),helpers:[],done:false};state.iterator=discover(actual,group,original,state);}
    actual.plans.set(key,state);
    let work=0;
    while(!state.done && work<budget){state.iterator.next();work++;}
    if(state.done)delete state.iterator;
    let size=0;for(const plan of actual.plans.values())size+=plan.edges.size;
    // Do not evict an unfinished active plan: that would restart discovery on
    // every Continue click. Active plans share the same bounded open-path set.
    while(actual.plans.size>1 && (actual.plans.size>16 || size>100000)) {
        const oldest=[...actual.plans.keys()].find(k=>!activeKeys.has(k));if(oldest===undefined)break;
        size-=actual.plans.get(oldest).edges.size;actual.plans.delete(oldest);
    }
    return {state,hit,work};
}

// Contract each connected off-page component, retaining all boundary edges.
// The placeholders are display objects, excluded from capture and export.
function pagedEdges(plans,visible,original,maxPlaceholders) {
    const parents=new Map(),sizes=new Map(),all=new Map(),owners=new Map();
    const hidden=id=>!original.has(id) && !visible.has(id);
    const root=id=>{let r=id;while(parents.get(r)!==r)r=parents.get(r);while(id!==r){const p=parents.get(id);parents.set(id,r);id=p;}return r;};
    const add=id=>{if(hidden(id) && !parents.has(id)){parents.set(id,id);sizes.set(id,1);}};
    for(const [key,plan] of plans)for(const [id,e] of plan.edges) {
        all.set(id,e);if(!owners.has(id))owners.set(id,new Set());owners.get(id).add(key);add(e.from);add(e.to);
        if(hidden(e.from) && hidden(e.to)){let a=root(e.from),b=root(e.to);if(a!==b){if(sizes.get(a)<sizes.get(b))[a,b]=[b,a];parents.set(b,a);sizes.set(a,sizes.get(a)+sizes.get(b));}}
    }
    const components=new Map();
    for(const id of parents.keys()){const r=root(id);if(!components.has(r))components.set(r,[]);components.get(r).push(id);}
    const aliases=new Map(),nodes=new Map();let count=0;
    for(const ids of components.values()) {
        const id=count++<maxPlaceholders-1?`slice-page:${ids[0]}`:'slice-page:other';
        for(const n of ids)aliases.set(n,id);
        const n=nodes.get(id) || {identifier:id,hiddenCount:0,diagramKind:'slice-page',sliceHelper:true,inputs:[],outputs:[],attributes:[],metadata:[],blocks:[]};n.hiddenCount+=ids.length;nodes.set(id,n);
    }
    for(const n of nodes.values()){n.name=`已收起 ${n.hiddenCount} 個節點`;n.type={name:n.name,identifier:n.name,category:'Control'};n.description='在側欄切換上一段／下一段。此標記不屬於原始 OP、pattern 或匯出的 MLIR。';}
    const edges=[];
    for(const [id,e] of all) {
        const from=aliases.get(e.from) || e.from,to=aliases.get(e.to) || e.to;
        if(from===to && aliases.has(e.from))continue;
        const value=aliases.has(e.from)?{...e.value,identifier:`${from}:${e.value.identifier}`,name:`${from} · ${e.value.name}`}:e.value;
        edges.push({...e,from,to,value,keys:owners.get(id)});
    }
    return {nodes,edges};
}

export function connectionSliceView(compact,{expandedConnections=[],connectionPages={},connectionIndex,pageSize=PAGE_SIZE,maxHelpers=HELPER_LIMIT,maxPathWork=WORK_LIMIT}={}) {
    const original=new Map(compact.graph.nodes.map(n=>[n.identifier,n])),groups=new Map();
    for(const link of compact.links) {
        const key=pair(link.from,link.to);
        if(!groups.has(key))groups.set(key,{key,from:link.from,to:link.to,label:`${original.get(link.from).type.name} → ${original.get(link.to).type.name} · blocks ${original.get(link.from).sourceGraph} → ${original.get(link.to).sourceGraph}`,links:[],expanded:false,helpers:0,page:0,pages:1});
        groups.get(key).links.push(link);
    }
    const requested=new Set(Array.isArray(expandedConnections)?expandedConnections.slice(0,256):[]),active=[...groups.values()].filter(g=>requested.has(g.key)),plans=new Map(),visible=new Set();
    if(active.length>16)throw new Error('最多同時展開 16 段路徑；請先收起部分路徑。');
    const activeKeys=new Set(active.map(g=>planKey(g,original)));
    const actual=active.length?connectionIndex():null,reserve=Math.max(1,Math.floor(maxHelpers/4));
    const capacity=Math.max(1,Math.min(pageSize,Math.floor((maxHelpers-reserve)/Math.max(1,active.length))));
    let work=0,cacheHits=0;
    for(const group of active) {
        const plan=pathPlan(actual,group,original,Math.max(0,maxPathWork-work),activeKeys);work+=plan.work;cacheHits+=Number(plan.hit);
        group.pending=!plan.state.done;
        if(group.pending){group.expanded=true;continue;}
        const helpers=plan.state.helpers;group.helpers=helpers.length;
        if(!helpers.length)continue;
        group.expanded=true;group.pages=capacity===1?helpers.length:Math.max(1,Math.ceil((helpers.length-1)/(capacity-1)));
        const requestedPage=connectionPages?.[group.key];group.page=Math.max(0,Math.min(group.pages-1,Number.isInteger(requestedPage)?requestedPage:0));
        const start=group.page*Math.max(1,capacity-1),shown=helpers.slice(start,start+capacity);group.shown=shown.length;
        group.pageStart=shown[0];group.pageEnd=shown.at(-1);
        for(const id of shown)visible.add(id);plans.set(group.key,plan.state);
    }
    // Limit before any display node is cloned, rather than after full expansion.
    if(visible.size>=maxHelpers)throw new Error('請先收起部分路徑，再展開其他連線。');
    const projected=pagedEdges(plans,visible,original,maxHelpers-visible.size),nodes=new Map(),edges=new Map(),actions=new Map();
    const addNode=id=>{
        if(nodes.has(id))return;
        const template=original.get(id) || projected.nodes.get(id) || actual.getNode(id),node={...serialize(template),inputs:[],outputs:[]};delete node.controlDependencies;
        if(!original.has(id)){node.sliceHelper=true;if(node.diagramKind==='operator')node.diagramKind='slice-helper';}
        nodes.set(id,node);
    };
    for(const id of original.keys())addNode(id);
    const addEdge=(e,keys)=>{
        addNode(e.from);addNode(e.to);edges.set(edgeKey(e),e);
        const p=pair(e.from,e.to);if(!actions.has(p))actions.set(p,new Set());for(const key of keys)actions.get(p).add(key);
    };
    for(const e of projected.edges)addEdge(e,e.keys);
    for(const group of groups.values())if(!plans.has(group.key))for(const e of group.links) {
        const value=original.get(e.from).outputs.flatMap(a=>a.value).find(v=>v.identifier===e.value);addEdge({...e,value},[group.key]);
    }
    const values=new Map();
    for(const e of edges.values()) {
        const key=`${e.from}:${e.value.identifier}`;if(!values.has(key))values.set(key,serialize(e.value));const value=values.get(key),from=nodes.get(e.from),to=nodes.get(e.to);
        if(!from.outputs.some(a=>a.value.includes(value)))from.outputs.push({name:value.name,value:[value]});
        if(e.kind==='control'){to.controlDependencies ||= [];if(!to.controlDependencies.includes(value))to.controlDependencies.push(value);}
        else if(!to.inputs.some(a=>a.value.includes(value)))to.inputs.push({name:value.name,value:[value]});
    }
    return {...compact,graph:{...compact.graph,nodes:[...nodes.values()]},nodes:[...nodes.keys()],links:[...edges.values()].map(e=>({from:e.from,to:e.to,kind:e.kind})),sliceConnections:[...groups.values()].map(({links,...g})=>g),sliceDirectConnection:active.some(g=>!g.expanded),sliceEdgeActions:[...actions].map(([p,keys])=>{const [from,to]=p.split('>');return {from,to,keys:[...keys]};}),sliceHelperCount:nodes.size-original.size,slicePathStats:{work,cacheHits,cachedPlans:actual?.plans.size || 0,topologySize:actual?.size || 0,displayHelpers:nodes.size-original.size,helperLimit:maxHelpers}};
}
