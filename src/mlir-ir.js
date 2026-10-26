import { operationSemantics } from './mlir-dialects.js?v=9b5c4d02768d6a08';
export const opName = op => op?.name.getStringRef();
export const ssaKey = (name,number=0) => `${name}#${number}`;

// Recover immutable declarations and lexical identity independently of Netron's
// mutable forward-reference placeholders. Also retain the containing CFG.
export function prepareMLIR(root,info,dialects=[]) {
    const rows=[],byOp=new Map(),byBlock=new Map(),regions=[],definitions=new Map();
    let nextContext=0;
    const collect=(blocks,owner=null,regionIndex=0)=> {
        const semantics=owner ? operationSemantics(owner.op,dialects) : {regionKind:'graph'};
        const kind=typeof semantics.regionKind==='function' ? semantics.regionKind(regionIndex) : semantics.regionKind;
        const region={blocks,owner,index:regionIndex,parent:owner?.region,kind:kind || 'ssacfg',isolated:semantics.isolated,scope:new Map()};
        regions.push(region);
        const add=(value,block,position,row=null)=> {
            const original=info.definitions.get(value);
            if(!original) return;
            value.type=original.type;
            const def={...original,value,block,order:position,row,region,key:ssaKey(original.name,original.number)};
            definitions.set(value,def);
            if(!region.scope.has(def.key)) region.scope.set(def.key,def);
        };
        for(const block of blocks) {
            byBlock.set(block,region);
            for(const arg of block.arguments || []) add(arg,block,-1);
            for(const [position,op] of (block.operations || []).entries()) {
                const row={op,position,block,region,parent:owner,range:info.operations.get(op),uses:[],context:opName(op)==='func.func' ? ++nextContext : owner?.context || 0};
                rows.push(row);byOp.set(op,row);
                for(const result of op.results || []) add(result,block,position,row);
                for(const [i,child] of (op.regions || []).entries()) collect(child.blocks || [],row,i);
            }
        }
        return region;
    };
    collect([root]);
    const lookup=(region,key)=> {
        if(region.scope.has(key)) return region.scope.get(key);
        return !region.isolated && region.parent ? lookup(region.parent,key) : undefined;
    };
    const sorted=rows.filter(row=>row.range).sort((a,b)=>a.range[0]-b.range[0]);
    for(const use of info.uses) {
        let lo=0,hi=sorted.length;
        while(lo<hi) {const mid=(lo+hi)>>>1;if(sorted[mid].range[0]<=use.range[0])lo=mid+1;else hi=mid;}
        let row=sorted[lo-1];
        while(row && use.range[1]>row.range[1]) row=row.parent;
        if(!row) continue;
        row.uses.push(use);
        const def=lookup(row.region,ssaKey(use.name,use.number));
        if(def) use.value=def.value;
    }
    for(const row of rows) {
        row.uses.sort((a,b)=>a.range[0]-b.range[0]);
        if(row.uses.length===(row.op.operands || []).length) row.op.operands=row.uses.map(use=>use.value);
    }
    return {rows,byOp,byBlock,regions,definitions,lookup};
}

// Reverse postorder immediate dominators (linear storage, no B×B sets). Handles
// backedges, diamonds and irreducible CFGs; unreachable blocks have no idom.
export function buildDominance(blocks,successors) {
    const seen=new Set(),post=[],pred=new Map(blocks.map(block=>[block,[]]));
    for(const block of blocks) for(const next of successors.get(block) || []) pred.get(next)?.push(block);
    if(blocks.length) {
        const stack=[[blocks[0],0]];seen.add(blocks[0]);
        while(stack.length) {
            const frame=stack.at(-1),next=(successors.get(frame[0]) || [])[frame[1]++];
            if(next) {if(!seen.has(next)){seen.add(next);stack.push([next,0]);}}
            else {post.push(frame[0]);stack.pop();}
        }
    }
    const order=post.reverse(),rank=new Map(order.map((b,i)=>[b,i])),idom=new Map();
    if(order.length) idom.set(order[0],order[0]);
    const intersect=(a,b)=> {while(a!==b){while(rank.get(a)>rank.get(b))a=idom.get(a);while(rank.get(b)>rank.get(a))b=idom.get(b);}return a;};
    let changed=true;
    while(changed) {
        changed=false;
        for(const block of order.slice(1)) {
            const incoming=pred.get(block).filter(p=>idom.has(p));
            if(!incoming.length) continue;
            const parent=incoming.slice(1).reduce(intersect,incoming[0]);
            if(idom.get(block)!==parent){idom.set(block,parent);changed=true;}
        }
    }
    // Stamp the dominator tree for O(1) use checks, rather than walking a long
    // chain for every SSA operand in a large function.
    const children=new Map(order.map(b=>[b,[]])),intervals=new Map();let tick=0;
    for(const block of order.slice(1)) children.get(idom.get(block)).push(block);
    if(order.length) {
        const stack=[[order[0],false]];
        while(stack.length) {const [b,done]=stack.pop();if(done)intervals.get(b)[1]=tick++;else{intervals.set(b,[tick++,0]);stack.push([b,true]);for(const c of children.get(b))stack.push([c,false]);}}
    }
    return {reachable:seen,dominates:(a,b)=> {
        if(a===b || !seen.has(b))return true;
        const x=intervals.get(a),y=intervals.get(b);return Boolean(x && y && x[0]<=y[0] && x[1]>=y[1]);
    }};
}
