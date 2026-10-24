import {operationSemantics} from './mlir-dialects.js?v=d408969f7e3cd305';
import {typeSpelling} from './mlir-engine.js?v=d408969f7e3cd305';

// Portable data, never hooks or source code. Bind a source pattern graph to
// real operators in the exported IR; synthetic ABI nodes stay in the real IR.
export const SLICE_PATTERN_ATTRIBUTE='model_lens.slice_pattern';
// Large cyclic slices retain their producers. Their checked source mapping can
// exceed 2 MiB around 20k OPs even when only a few OPs are displayed. Keep a
// finite mapping budget within the parser's separate 64 MiB file limit.
export const SLICE_PATTERN_LIMIT=8*1024*1024;
const integer=(n,max=200000)=>Number.isSafeInteger(n) && n>=0 && n<max;
const name=op=>op.name.getStringRef();

function actualGraph(index,region) {
    const {ir,dialects,graphs}=index.mlir,visible=new Set(graphs.flatMap(g=>g.operations));
    const nodes=[],edges=[],blockIds=new Map(),opIds=new Map(),values=new Map();
    const add=n=>{nodes.push(n);return nodes.length-1;};
    const edge=(from,to,kind,port,branch)=>{if(from!==undefined && to!==undefined)edges.push({from,to,kind,...(port===undefined?{}:{port:String(port)}),...(branch===undefined?{}:{branch})});};
    for(const [b,block] of region.blocks.entries()) {
        const parent=add({kind:'block',arity:(block.arguments || []).length,block:b});blockIds.set(block,parent);
        for(const [slot,v] of (block.arguments || []).entries()){const id=add({kind:'argument',slot,parent,actualSlot:slot});values.set(v,{id,port:0});edge(parent,id,'contains');}
        for(const [order,op] of block.operations.entries())if(visible.has(op)) {
            const id=add({kind:'operator',type:name(op),order,parent,actualOp:order,inputs:ir.byOp.get(op).uses.length,results:(op.results || []).length});opIds.set(op,id);edge(parent,id,'contains');
            for(const [port,v] of (op.results || []).entries())values.set(v,{id,port});
        }
    }
    const labels=new Map(region.blocks.map(b=>[b.name,b]));
    for(const block of region.blocks)for(const op of block.operations) {
        const id=opIds.get(op),row=ir.byOp.get(op);if(id===undefined)continue;
        for(const [i,use] of row.uses.entries()){const v=values.get(use.value);if(v)edge(v.id,id,'ssa',`${v.port}:${i}`);}
        if(op.successors?.length) {
            const groups=operationSemantics(op,dialects).successorOperands({op,uses:row.uses,typeOf:typeSpelling});
            for(const [s,successor] of op.successors.entries()) {
                const target=labels.get(successor.label || successor.name);edge(blockIds.get(block),blockIds.get(target),'control',s);
                for(const [a,use] of groups[s].entries()){const v=values.get(use.value),arg=values.get(target.arguments[a]);if(v && arg)edge(v.id,arg.id,'argument',`${v.port}:${s}`,blockIds.get(block));}
            }
        }
    }
    return {nodes,edges};
}

async function seal(actual,graph) {
    const bytes=new TextEncoder().encode(JSON.stringify({actual,graph}));
    return [...new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))].map(b=>b.toString(16).padStart(2,'0')).join('');
}

function validGraph(index,region,graph) {
    if(!graph || !Array.isArray(graph.nodes) || !Array.isArray(graph.edges) || graph.nodes.length>200000 || graph.edges.length>500000)return false;
    const {nodes,edges}=graph,blocks=new Set(),operators=new Set(),argumentsSeen=new Set(),slots=new Map(),orders=new Map(),actualValues=new Map();
    for(const [i,n] of nodes.entries()) {
        if(!n || !['block','argument','operator'].includes(n.kind))return false;
        if(n.kind==='block') {
            if(!integer(n.block,region.blocks.length) || !integer(n.arity,65536) || blocks.has(n.block))return false;
            blocks.add(n.block);slots.set(i,new Set());orders.set(i,[]);
        }
    }
    for(const [i,n] of nodes.entries())if(n.kind!=='block') {
        const parent=nodes[n.parent];if(!integer(n.parent,i) || parent?.kind!=='block')return false;
        const b=region.blocks[parent.block];
        if(n.kind==='argument') {
            if(!integer(n.slot,parent.arity) || slots.get(n.parent).has(n.slot) || !(n.actualSlot===null || integer(n.actualSlot,b.arguments.length)))return false;
            slots.get(n.parent).add(n.slot);
            if(n.actualSlot!==null){const key=`${parent.block}:${n.actualSlot}`;if(argumentsSeen.has(key))return false;argumentsSeen.add(key);actualValues.set(`${i}:0`,b.arguments[n.actualSlot]);}
        } else {
            if(n.selected!==undefined && typeof n.selected!=='boolean')return false;
            if(!integer(n.actualOp,b.operations.length) || !integer(n.order) || !integer(n.inputs,1000000) || !integer(n.results,1000000))return false;
            const op=b.operations[n.actualOp],key=`${parent.block}:${n.actualOp}`;
            if(n.returnOperands!==undefined && (n.type!=='func.return' || !Array.isArray(n.returnOperands) || n.returnOperands.length!==n.inputs || n.returnOperands.some(p=>!integer(p,index.mlir.ir.byOp.get(op).uses.length))))return false;
            if(typeof n.type!=='string' || n.type!==name(op) || operators.has(key) || n.results!==(op.results || []).length)return false;
            if(!op.successors?.length && name(op)!=='func.return' && n.inputs!==index.mlir.ir.byOp.get(op).uses.length)return false;
            operators.add(key);orders.get(n.parent).push(n);
            for(const [p,v] of (op.results || []).entries())actualValues.set(`${i}:${p}`,v);
        }
    }
    for(const [id,set] of slots)if(set.size!==nodes[id].arity)return false;
    for(const list of orders.values()) {list.sort((a,b)=>a.actualOp-b.actualOp);if(list.some((n,i)=>i && n.order<=list[i-1].order))return false;}
    const seen=new Set(),controls=new Set(),contains=new Set(),blockByLabel=new Map(nodes.filter(n=>n.kind==='block').map(n=>[region.blocks[n.block].name,n]));
    for(const e of edges) {
        if(!e || !integer(e.from,nodes.length) || !integer(e.to,nodes.length) || !['contains','ssa','argument','control'].includes(e.kind))return false;
        const a=nodes[e.from],b=nodes[e.to],key=JSON.stringify(e);if(seen.has(key))return false;seen.add(key);
        if(e.kind==='contains') {if(a.kind!=='block' || b.kind==='block' || b.parent!==e.from || e.port!==undefined)return false;contains.add(e.to);}
        else {
            if(typeof e.port!=='string' || !/^\d+(?::\d+)?$/.test(e.port))return false;
            const [p,q]=e.port.split(':').map(Number);
            if(e.kind==='control') {
                if(a.kind!=='block' || b.kind!=='block' || q!==undefined)return false;
                const source=region.blocks[a.block],target=region.blocks[b.block],successor=source.operations.at(-1)?.successors?.[p];
                if(!successor || (successor.label || successor.name)!==target.name)return false;
                controls.add(`${a.block}:${p}:${b.block}`);
            } else {
                if(a.kind==='block' || !integer(p,a.kind==='argument'?1:a.results) || !integer(q,1000000))return false;
                if(e.kind==='ssa') {
                    if(b.kind!=='operator' || q>=b.inputs)return false;
                    const parent=nodes[b.parent],op=region.blocks[parent.block].operations[b.actualOp];
                    if((name(op)!=='func.return' && !op.successors?.length || b.returnOperands && actualValues.has(`${e.from}:${p}`)) && index.mlir.ir.byOp.get(op).uses[b.returnOperands?.[q] ?? q]?.value!==actualValues.get(`${e.from}:${p}`))return false;
                } else {
                    if(b.kind!=='argument' || !integer(e.branch,nodes.length) || nodes[e.branch].kind!=='block')return false;
                    const from=region.blocks[nodes[e.branch].block],to=region.blocks[nodes[b.parent].block],successor=from.operations.at(-1)?.successors?.[q];
                    if(!successor || (successor.label || successor.name)!==to.name)return false;
                }
            }
        }
    }
    for(const [i,n] of nodes.entries())if(n.kind!=='block' && !contains.has(i))return false;
    for(const n of nodes)if(n.kind==='block')for(const [s,to] of (region.blocks[n.block].operations.at(-1)?.successors || []).entries()) {
        const target=blockByLabel.get(to.label || to.name);
        if(target && !controls.has(`${n.block}:${s}:${target.block}`))return false;
    }
    return true;
}

// Called once by the async parser. Invalid/edited annotations fall back to the
// actual graph; they never relax ordinary pattern matching or SSA validation.
export async function prepareSlicePatterns(index) {
    const projections=new Map();index.mlir.slicePatterns=projections;
    for(const region of index.mlir.ir.regions) {
        const raw=region.owner?.op.getAttr(SLICE_PATTERN_ATTRIBUTE)?.value;
        if(typeof raw!=='string' || raw.length>SLICE_PATTERN_LIMIT)continue;
        try {
            const data=JSON.parse(raw);
            if(data.version!==1 || !/^[a-f0-9]{64}$/.test(data.seal) || !validGraph(index,region,data.graph))continue;
            if(data.seal===await seal(actualGraph(index,region),data.graph))projections.set(region,data.graph);
        } catch { /* untrusted model annotations are optional data */ }
    }
}

export function slicePatternGraph(index,region) {return index.mlir.slicePatterns?.get(region);}

// bindings maps source AST identities to positions in the newly emitted body.
// Flatten an existing projection when re-exporting, so seeds/entry nodes never
// accumulate as part of the original pattern graph.
export async function attachSlicePattern(index,region,text,offset,bindings) {
    const {parseMLIR}=await import('./mlir-engine.js?v=d408969f7e3cd305');
    const candidate=await parseMLIR(new TextEncoder().encode(text),{metadata:index.mlir.metadata,dialects:index.mlir.dialects});
    const target=candidate.mlir.ir.regions.find(r=>r.owner && name(r.owner.op)==='func.func');
    const original=slicePatternGraph(index,region) || actualGraph(index,region),nodes=[],ids=new Map();
    for(const [i,n] of original.nodes.entries())if(n.kind==='block') {
        const block=region.blocks[n.block],mapped=bindings.blocks.get(block);if(mapped===undefined)continue;
        ids.set(i,nodes.length);nodes.push({...n,block:mapped});
    } else if(ids.has(n.parent)) {
        const b=region.blocks[original.nodes[n.parent].block];let mapped;
        if(n.kind==='operator'){mapped=bindings.operators.get(b.operations[n.actualOp]);if(mapped===undefined)continue;}
        else mapped=n.actualSlot===null?undefined:bindings.arguments.get(b.arguments[n.actualSlot]);
        const returns=n.kind==='operator' && bindings.returnOperands?.get(b.operations[n.actualOp]);
        ids.set(i,nodes.length);nodes.push({...n,parent:ids.get(n.parent),...(n.kind==='operator'?{actualOp:mapped,selected:bindings.selected.has(b.operations[n.actualOp]),...(returns?{returnOperands:returns}:{})}:{actualSlot:mapped ?? null})});
    }
    const edges=original.edges.filter(e=>ids.has(e.from) && ids.has(e.to) && (e.branch===undefined || ids.has(e.branch))).map(e=>({...e,from:ids.get(e.from),to:ids.get(e.to),...(e.branch===undefined?{}:{branch:ids.get(e.branch)})}));
    const graph={nodes,edges};
    if(!validGraph(candidate,target,graph))throw new Error('匯出結構對照無法對應實際 MLIR，已停止下載。');
    const value=JSON.stringify({version:1,graph,seal:await seal(actualGraph(candidate,target),graph)});
    if(value.length>SLICE_PATTERN_LIMIT)throw new Error('Pattern 結構對照超過 8 MiB；請縮小選取範圍，或改用完整 function 匯出。');
    return text.slice(0,offset)+` {${SLICE_PATTERN_ATTRIBUTE} = ${JSON.stringify(value)}}`+text.slice(offset);
}
