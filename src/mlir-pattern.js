import {operationSemantics} from './mlir-dialects.js?v=48cf132f532c0b5d';
import {typeSpelling} from './mlir-engine.js?v=48cf132f532c0b5d';
import {validateMLIR} from './mlir-validate.js?v=48cf132f532c0b5d';
import {prepareMLIRPattern,nodeKey,edgeKey,CFG_PATTERN_MODE} from './mlir-pattern-spec.js?v=48cf132f532c0b5d';
import {selectionSnapshot} from './model-engine.js?v=48cf132f532c0b5d';
import {combinedMLIRSnapshot} from './mlir-combined-graph.js?v=48cf132f532c0b5d';
import {slicePatternGraph} from './mlir-pattern-projection.js?v=48cf132f532c0b5d';
import {compactSliceSnapshot} from './mlir-slice-graph.js?v=48cf132f532c0b5d';

function projects(index) {
    if(!index?.mlir)throw new Error('跨 block pattern 僅適用於文字 MLIR。');
    const data=index.mlir;
    if(data.patternProjects)return data.patternProjects;
    const graphs=new Map(data.graphs.map((g,i)=>[g.block,i]));
    const opLocations=new Map();
    for(const [graph,g] of data.graphs.entries())for(const [node,op] of g.operations.entries())opLocations.set(op,{graph,node});
    return data.patternProjects=data.ir.regions.map(region=>({region,graphs:region.blocks.map(b=>graphs.get(b)).filter(g=>g!==undefined),opLocations,graphsByBlock:graphs})).filter(p=>p.graphs.length);
}

function build(index,project) {
    if(project.entry)return project.entry;
    const {info,ir,dialects}=index.mlir,{region,opLocations,graphsByBlock}=project;
    const check=validateMLIR(index,{graphIndex:project.graphs[0]});
    if(check.diagnostics.length) {const d=check.diagnostics[0];throw new Error(`跨 block 搜尋無法可靠建立連線：第 ${d.line} 行 ${d.code}，${d.message}`);}
    const nodes=[],edges=[],blockIds=new Map(),values=new Map(),opIds=new Map();
    const add=node=>{nodes.push(node);return nodes.length-1;};
    const edge=(from,to,kind,port)=>{if(from!==undefined && to!==undefined)edges.push({from,to,kind,...(port!==undefined ? {port:String(port)} : {})});};
    for(const block of region.blocks) {
        const graph=graphsByBlock.get(block);
        if(graph===undefined)continue;
        const id=add({kind:'block',type:'block',arity:(block.arguments || []).length,graph,block});blockIds.set(block,id);
        for(const [slot,arg] of (block.arguments || []).entries()) {
            const a=add({kind:'argument',type:'argument',slot,graph,block});values.set(arg,{id:a,port:0});edge(id,a,'contains');
        }
        for(const [order,op] of (block.operations || []).entries()) {
            const loc=opLocations.get(op);if(!loc)continue;
            const n=add({kind:'operator',type:op.name.getStringRef(),order,block,...loc});opIds.set(op,n);edge(id,n,'contains');
            for(const [port,value] of (op.results || []).entries())values.set(value,{id:n,port});
        }
    }
    const labels=new Map(region.blocks.map(b=>[b.name,b]));
    for(const block of region.blocks)for(const op of block.operations || []) {
        const id=opIds.get(op),row=ir.byOp.get(op);if(id===undefined)continue;
        for(const [i,use] of row.uses.entries()) {const value=values.get(use.value);if(value)edge(value.id,id,'ssa',`${value.port}:${i}`);}
        if(op.successors?.length) {
            const sem=operationSemantics(op,dialects),groups=sem.successorOperands({op,uses:row.uses,typeOf:typeSpelling});
            for(const [s,successor] of op.successors.entries()) {
                const target=labels.get(successor.label || successor.name);edge(blockIds.get(block),blockIds.get(target),'control',s);
                for(const [a,use] of groups[s].entries()) {const value=values.get(use.value),argument=values.get(target.arguments[a]);if(value && argument){edge(value.id,argument.id,'argument',`${value.port}:${s}`);edges.at(-1).branch=graphsByBlock.get(block);}}
            }
        }
    }
    const outgoing=nodes.map(()=>new Map()),incoming=nodes.map(()=>new Map()),keys=nodes.map(nodeKey),byType=new Map();
    for(const [n,key] of keys.entries()){if(!byType.has(key))byType.set(key,[]);byType.get(key).push(n);}
    for(const e of edges)for(const [map,n,other] of [[outgoing,e.from,e.to],[incoming,e.to,e.from]]) {const key=edgeKey(e);if(!map[n].has(key))map[n].set(key,new Set());map[n].get(key).add(other);}
    return project.entry={nodes,edges,outgoing,incoming,keys,byType,blockIds,opIds,values};
}

function sourceEntry(index,project) {
    if(project.sourceEntry!==undefined)return project.sourceEntry;
    const graph=slicePatternGraph(index,project.region);if(!graph)return project.sourceEntry=null;
    const nodes=graph.nodes.map(n=>{
        const parent=n.kind==='block'?n:graph.nodes[n.parent],block=project.region.blocks[parent.block],location={graph:project.graphsByBlock.get(block),block};
        if(n.kind==='block')return {...n,type:'block',...location};
        if(n.kind==='argument')return {...n,type:'argument',...location};
        return {...n,...project.opLocations.get(block.operations[n.actualOp]),...location};
    });
    if(nodes.some(n=>n.graph===undefined || (n.kind==='operator' && n.node===undefined)))return project.sourceEntry=null;
    const edges=graph.edges.map(e=>({...e,...(e.branch===undefined?{}:{branch:nodes[e.branch].graph})}));
    const outgoing=nodes.map(()=>new Map()),incoming=nodes.map(()=>new Map()),keys=nodes.map(nodeKey),byType=new Map();
    for(const [n,key] of keys.entries()){if(!byType.has(key))byType.set(key,[]);byType.get(key).push(n);}
    for(const e of edges)for(const [map,n,other] of [[outgoing,e.from,e.to],[incoming,e.to,e.from]]){const key=edgeKey(e);if(!map[n].has(key))map[n].set(key,new Set());map[n].get(key).add(other);}
    return project.sourceEntry={nodes,edges,outgoing,incoming,keys,byType};
}

export function captureMLIRPattern(index,selections) {
    if(!Array.isArray(selections) || !selections.length)throw new Error('請選取至少一個 operator。');
    const requested=new Map();let count=0;
    for(const selected of selections) {
        if(!Number.isInteger(selected.graph) || !index.mlir?.graphs[selected.graph] || !Array.isArray(selected.nodes))throw new Error('選取的 block 無效。');
        const list=[...new Set(selected.nodes)];if(!list.length)continue;
        if(list.some(n=>!Number.isInteger(n) || !index.mlir.graphs[selected.graph].operations[n]))throw new Error('選取的 operator 無效。');
        if(requested.has(selected.graph))throw new Error('Block 選取不可重複。');requested.set(selected.graph,new Set(list));count+=list.length;
    }
    if(!count || count>32 || requested.size>32)throw new Error('跨 block pattern 最多選取 32 個 operators、32 個 blocks。');
    const project=projects(index).find(p=>[...requested.keys()].every(g=>p.graphs.includes(g)));
    if(!project)throw new Error('跨 block 圈選必須位於同一個 region；不能跨 function 或巢狀 region。');
    const actual=build(index,project),original=sourceEntry(index,project);
    const included=original && new Set(original.nodes.filter(n=>n.kind==='operator').map(n=>`${n.graph}:${n.node}`));
    if(original && ![...requested].every(([g,set])=>[...set].every(n=>included.has(`${g}:${n}`))))throw new Error('選取包含匯出器新增的介面節點；請只圈選原始 layers 建立 pattern。');
    const entry=original || actual,selected=[];
    for(const [i,n] of entry.nodes.entries())if(requested.has(n.graph) && (n.kind!=='operator' || requested.get(n.graph).has(n.node)))selected.push(i);
    const aliases=new Map(selected.map((id,i)=>[id,`N${i+1}`])),orders=new Map();
    const nodes=selected.map(id=> {
        const n=entry.nodes[id],base={alias:aliases.get(id),type:n.type,kind:n.kind};
        if(n.kind==='block')base.arity=n.arity;
        if(n.kind==='argument')base.slot=n.slot;
        if(n.kind==='operator'){base.order=orders.get(n.graph) || 0;orders.set(n.graph,base.order+1);}
        return base;
    });
    const edges=entry.edges.filter(e=>aliases.has(e.from) && aliases.has(e.to)).map(e=>({from:aliases.get(e.from),to:aliases.get(e.to),kind:e.kind,...(e.port!==undefined?{port:e.port}:{})}));
    const spec=prepareMLIRPattern({mode:CFG_PATTERN_MODE,nodes,edges,induced:true});
    return {mode:spec.mode,nodes:spec.nodes,edges:spec.edges,induced:spec.induced};
}

export async function findMLIRPatterns(index,structure,scope='all',cancelled=()=>false) {
    const spec=prepareMLIRPattern(structure),items=[];let checks=0,limited=false,yieldAt=0;
    const budget=async()=>{
        if(checks>2000000){limited=true;return false;}
        if(checks%1000===0){if(performance.now()>=yieldAt){await new Promise(r=>setTimeout(r,0));yieldAt=performance.now()+8;}if(cancelled())return false;}
        return true;
    };
    for(const project of projects(index)) {
        if(scope!=='all' && !project.graphs.includes(Number(scope)))continue;
        const actual=build(index,project),original=sourceEntry(index,project);
        const entry=original || actual;
        const mapping=new Map(),used=new Set(),seen=new Set();
        const has=(a,b,e)=>entry.outgoing[a].get(edgeKey(e))?.has(b) || false;
        const orderOK=(node,n)=> {
            if(node.kind!=='operator')return true;
            for(const other of spec.nodes)if(other.kind==='operator' && mapping.has(other.alias) && spec.parents.get(other.alias)===spec.parents.get(node.alias)) {
                const a=entry.nodes[mapping.get(other.alias)];if((a.order<entry.nodes[n].order)!==(other.order<node.order))return false;
            }
            return true;
        };
        const search=async()=> {
            if(cancelled() || limited)return;
            if(mapping.size===spec.nodes.length) {
                if(spec.induced)for(const [alias,n] of mapping)for(const [toAlias,to] of mapping)for(const [key,targets] of entry.outgoing[n]) {
                    checks++;if(checks%1000===0 || checks>2000000)if(!await budget())return;
                    if(targets.has(to) && !spec.outgoing.get(alias).some(e=>e.to===toAlias && edgeKey(e)===key))return;
                }
                const signature=JSON.stringify([[...used].sort((a,b)=>a-b),spec.edges.map(e=>`${mapping.get(e.from)}>${mapping.get(e.to)}:${edgeKey(e)}`).sort()]);if(seen.has(signature))return;seen.add(signature);
                const matched=spec.nodes.filter(n=>n.kind==='operator').map(n=>entry.nodes[mapping.get(n.alias)]),blocks=[];
                for(const graph of [...new Set(matched.map(n=>n.graph))].sort((a,b)=>a-b))blocks.push({graph,path:matched.filter(n=>n.graph===graph).map(n=>n.node).sort((a,b)=>a-b)});
                const first=blocks[0];
                const control=spec.edges.filter(e=>e.kind==='control').map(e=>({from:entry.nodes[mapping.get(e.from)].graph,to:entry.nodes[mapping.get(e.to)].graph,successor:Number(e.port)}));
                items.push({kind:'patterns',patternType:'graph',mode:spec.mode,graph:first.graph,path:first.path,blocks,control,operatorCount:matched.length,...(entry===original?{sourceProjection:true}:{}),label:`跨 block · ${blocks.length} blocks · ${matched.length} operators${entry===original?' · 原始結構':''}`,id:blocks.map(b=>`block ${b.graph}`).join(' · ')});
                if(items.length>=50000)limited=true;return;
            }
            let chosen,candidates;
            for(const node of spec.nodes) {
                if(mapping.has(node.alias))continue;
                const constraints=[];
                for(const e of spec.incoming.get(node.alias))if(mapping.has(e.from))constraints.push(entry.outgoing[mapping.get(e.from)].get(edgeKey(e)) || new Set());
                for(const e of spec.outgoing.get(node.alias))if(mapping.has(e.to))constraints.push(entry.incoming[mapping.get(e.to)].get(edgeKey(e)) || new Set());
                if(mapping.size && !constraints.length)continue;
                const typed=entry.byType.get(nodeKey(node)) || [],base=constraints.length ? constraints.reduce((a,b)=>a.size<=b.size ? a : b) : typed,possible=[];
                for(const n of base) {
                    checks++;if(checks%1000===0 || checks>2000000)if(!await budget())return;
                    if(!used.has(n) && entry.keys[n]===nodeKey(node) && constraints.every(s=>s.has(n)) && spec.outgoing.get(node.alias).filter(e=>e.to===node.alias).every(e=>has(n,n,e)) && orderOK(node,n))possible.push(n);
                }
                if(!possible.length)return;
                if(!candidates || possible.length<candidates.length){chosen=node;candidates=possible;}
            }
            for(const candidate of candidates || []) {mapping.set(chosen.alias,candidate);used.add(candidate);await search();used.delete(candidate);mapping.delete(chosen.alias);if(limited || cancelled())return;}
        };
        await search();if(cancelled())return null;if(limited)break;
    }
    return {items,truncated:limited,searchLimited:checks>2000000};
}

function sliceDetail(index,project) {
    if(!project.sliceDetail) {
        const blocks=project.graphs.map(graph=>({graph,path:index.mlir.graphs[graph].operations.map((_,n)=>n)}));
        const item={kind:'slice',graph:blocks[0].graph,path:blocks[0].path,blocks};
        project.sliceDetail=combinedMLIRSnapshot(index,item,build(index,project),{full:true,lightweight:true,maxOperators:Infinity,maxControlRoutes:Infinity});
    }
    return project.sliceDetail;
}

export function mlirMatchSnapshot(index,item,options={}) {
    const block=item.blocks.find(b=>b.graph===(options.blockGraph ?? item.graph));
    if(!block)throw new Error('此 block 不在匹配結果中。');
    if(!options.singleBlock) {
        const project=projects(index).find(p=>item.blocks.every(b=>p.graphs.includes(b.graph)));
        if(!project)throw new Error('匹配結果不屬於同一個 region。');
        const original=sourceEntry(index,project);
        if(original && !options.sliceDetails)return compactSliceSnapshot(index,item,original,{...options,detail:()=>sliceDetail(index,project)});
        if(original)return {...mlirSliceSnapshot(index,item.graph,{...options,sliceDetails:true}),item:{...item,connections:[]},selected:item.blocks.flatMap(b=>b.path.map(n=>`b${b.graph}:n${n}`))};
        return {...combinedMLIRSnapshot(index,item,build(index,project),options),sliceView:!!original};
    }
    const selected=new Set(block.path),entry=index.graphs[block.graph];
    const connections=block.path.flatMap(from=>[...entry.next[from]].filter(to=>selected.has(to)).map(to=>[from,to]));
    return selectionSnapshot(index,{...item,graph:block.graph,path:block.path,connections},options);
}

// Older slices lack explicit capture markers; show their checked source OPs.
// Once a saved pattern is selected, its exact selected OPs define the view.
export function mlirSliceSnapshot(index,graph,{sliceDetails=false,...options}={}) {
    if(!index?.mlir)return null;
    const project=projects(index).find(p=>p.graphs.includes(graph)),entry=project && sourceEntry(index,project);
    if(!entry)return null;
    const marked=entry.nodes.some(n=>n.kind==='operator' && n.selected!==undefined);
    const operators=entry.nodes.filter(n=>n.kind==='operator' && (!marked || n.selected));
    const blocks=[...new Set(operators.map(n=>n.graph))].map(graph=>({graph,path:operators.filter(n=>n.graph===graph).map(n=>n.node)}));
    if(!blocks.length)return null;
    const item={kind:'slice',graph:blocks[0].graph,path:blocks[0].path,blocks};
    if(!sliceDetails)return compactSliceSnapshot(index,item,entry,{...options,detail:()=>sliceDetail(index,project)});
    const all={...item,blocks:project.graphs.map(graph=>({graph,path:index.mlir.graphs[graph].operations.map((_,n)=>n)}))};
    const dto=combinedMLIRSnapshot(index,all,build(index,project),{...options,full:true});
    return {...dto,sliceView:true,selected:operators.map(n=>`b${n.graph}:n${n.node}`)};
}

export function mlirModelSnapshots(index,{lightweight=false}={}) {
    return projects(index).map(project=>{
        const blocks=project.graphs.map(graph=>({graph,path:index.mlir.graphs[graph].operations.map((_,i)=>i)}));
        const item={kind:'patterns',mode:CFG_PATTERN_MODE,graph:blocks[0].graph,path:blocks[0].path,blocks};
        return combinedMLIRSnapshot(index,item,build(index,project),{full:true,maxOperators:Infinity,maxControlRoutes:Infinity,lightweight});
    });
}
