// Measured card sizes and actual tensor dependencies determine the view only.
// This never changes execution order, draft commands or exported connections.
export function modelEditLayout(nodes,values,sizes,{width=310,left=450,top=54,gapX=140,gapY=64}={}){
    const positions=new Map(),blocks=[];let maxX=left+width,maxY=top,y=top;
    for(const graph of [...new Set(nodes.map(n=>n.source.graph))].sort((a,b)=>a-b)){
        const group=nodes.filter(n=>n.source.graph===graph),ids=new Set(group.map(n=>n.id)),parents=new Map(),children=new Map(group.map(n=>[n.id,[]]));
        for(const n of group){const deps=new Set(n.inputs.map(p=>values.get(p.value)?.producer).filter(id=>id!==n.id&&ids.has(id)));parents.set(n.id,deps);for(const id of deps)children.get(id).push(n.id);}
        const remaining=new Map([...parents].map(([id,p])=>[id,p.size])),ranks=new Map(group.map(n=>[n.id,0])),queue=group.filter(n=>!remaining.get(n.id)).map(n=>n.id);
        for(let i=0;i<queue.length;i++){const id=queue[i];for(const child of children.get(id)){ranks.set(child,Math.max(ranks.get(child),ranks.get(id)+1));remaining.set(child,remaining.get(child)-1);if(!remaining.get(child))queue.push(child);}}
        // Invalid/cyclic drafts must still have distinct, selectable cards while
        // the existing connection/export validator explains the underlying error.
        let tail=Math.max(0,...ranks.values());for(const n of group)if(remaining.get(n.id))ranks.set(n.id,++tail);
        const columns=new Map();for(const n of group){const rank=ranks.get(n.id);if(!columns.has(rank))columns.set(rank,[]);columns.get(rank).push(n);}
        blocks.push({graph,x:left,y:y-38});let bottom=y;
        for(const [rank,column]of columns){let row=y;for(const n of column){const height=sizes.get(n.id)||100,x=left+rank*(width+gapX);positions.set(n.id,{x,y:row,width,height});row+=height+gapY;maxX=Math.max(maxX,x+width);}bottom=Math.max(bottom,row);}
        y=bottom+72;maxY=Math.max(maxY,bottom);
    }
    return {positions,blocks,width:maxX+80,height:Math.max(400,maxY+40)};
}
