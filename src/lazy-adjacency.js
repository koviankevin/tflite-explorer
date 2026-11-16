// Capture both directions at index time. Reading either property later yields
// the same ordinary, independently mutable Array<Set<number>> as before.
// No Proxy, background task, GC request or worker-lifetime change is involved.
class NeighborRow {
    constructor(storage,index){this.storage=storage;this.index=index;}
    get size(){const {rows,offsets}=this.storage,row=rows[this.index];return row===undefined?offsets[this.index+1]-offsets[this.index]:row.size;}
    has(value){
        const {rows,offsets,values,one}=this.storage,row=rows[this.index];
        if(row!==undefined)return row.has(value);
        const start=offsets[this.index],end=offsets[this.index+1];
        if(end-start>16)return one(this.index).has(value);
        for(let i=start;i<end;i++)if(values[i]===value)return true;
        return false;
    }
    *[Symbol.iterator](){
        const {rows,offsets,values}=this.storage,row=rows[this.index];
        if(row!==undefined)yield* row;
        else for(let i=offsets[this.index];i<offsets[this.index+1];i++)yield values[i];
    }
}

function setRows(offsets,values,present){
    let ready=false,rows=new Array(present.length),views=new Array(present.length);
    const storage={rows,offsets,values,one:null};
    const release=()=>{offsets=null;values=null;present=null;views=null;storage.offsets=null;storage.values=null;};
    const one=index=>{
        if(ready)return rows[index];
        if(!Number.isInteger(index)||index<0||index>=present.length||!present[index])return undefined;
        if(rows[index]===undefined){const valuesHere=new Set();for(let j=offsets[index];j<offsets[index+1];j++)valuesHere.add(values[j]);rows[index]=valuesHere;}
        return rows[index];
    };
    storage.one=one;
    // Search only needs iteration, membership and degree. Read the compact
    // rows directly; a complete pattern scan must not populate every Set.
    // Materialized public rows still win, including their later mutations.
    const read=index=>{
        if(ready)return rows[index];
        if(!Number.isInteger(index)||index<0||index>=present.length||!present[index])return undefined;
        if(rows[index]!==undefined)return rows[index];
        if(views[index]===undefined)views[index]=new NeighborRow(storage,index);
        return views[index];
    };
    return {one,read,descriptor:{enumerable:true,configurable:true,get(){
        if(!ready){for(let i=0;i<present.length;i++)if(present[i])one(i);ready=true;release();}return rows;
    },set(value){rows=value;storage.rows=value;ready=true;release();}}};
}

// These internal views support only iteration, size and has. The legacy
// properties remain the interface for callers that need mutable native Sets.
export const nextNodes=(entry,node)=>typeof entry.nextNodes==='function'?entry.nextNodes(node):entry.next[node];
export const previousNodes=(entry,node)=>typeof entry.previousNodes==='function'?entry.previousNodes(node):entry.previous[node];

export function lazyAdjacency(nodes,visitTargets){
    const length=nodes.length,present=new Uint8Array(length),offsets=new Uint32Array(length+1),targets=[];
    let first=-1,multiple=null;
    const add=to=>{
        if(!Number.isInteger(to)||to<0||to>=length||!(to in nodes))throw Error('Invalid adjacency target.');
        if(first===-1)first=to;
        else if(first!==to){if(!multiple)multiple=new Set([first]);multiple.add(to);}
    };
    for(let from=0;from<length;from++){
        if(from in nodes){
            present[from]=1;first=-1;multiple=null;visitTargets(nodes[from],add);
            const count=multiple?multiple.size:first===-1?0:1;
            if(targets.length+count>0xffffffff)throw Error('模型連線數超過可用的索引容量。');
            if(multiple){for(const to of multiple)targets.push(to);}else if(first!==-1)targets.push(first);
        }
        offsets[from+1]=targets.length;
    }
    const values=Uint32Array.from(targets),counts=new Uint32Array(length),reverseOffsets=new Uint32Array(length+1);
    for(const to of values)counts[to]++;
    for(let i=0;i<length;i++)reverseOffsets[i+1]=reverseOffsets[i]+counts[i];
    counts.set(reverseOffsets.subarray(0,length));
    const reverseValues=new Uint32Array(values.length);
    for(let from=0;from<length;from++)for(let i=offsets[from];i<offsets[from+1];i++)reverseValues[counts[values[i]]++]=from;
    const next=setRows(offsets,values,present),previous=setRows(reverseOffsets,reverseValues,present);
    return Object.defineProperties({}, {next:next.descriptor,previous:previous.descriptor,nextNodes:{value:next.read},previousNodes:{value:previous.read}});
}
