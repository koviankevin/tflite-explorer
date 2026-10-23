// Resolve display nodes back to original operators. Diagram-only headers,
// successor routes and block arguments never become captured operations.
export function layerLocation(entry,graph) {
    const node=entry.node;
    if(node.diagramKind!==undefined) {
        if(node.diagramKind!=='operator')return null;
        graph=node.sourceGraph;
    }
    const index=node.diagramKind==='operator'?node.sourceNode:entry.index;
    return Number.isInteger(graph) && graph>=0 && Number.isInteger(index) && index>=0?{graph,node:index}:null;
}

// Apply a multi-block selection atomically; a bulk add over the limit leaves
// every existing selection intact. Keep Set identities for block-local views.
export function updateLayerSelection(selections,locations,{toggle=false,limit=32}={}) {
    const changes=new Map();let count=[...selections.values()].reduce((n,s)=>n+s.size,0);
    for(const location of locations) {
        if(!location || !Number.isInteger(location.graph) || location.graph<0 || !Number.isInteger(location.node) || location.node<0)throw new Error('選取的 layer 位置無效。');
        changes.set(`${location.graph}:${location.node}`,location);
    }
    const updates=[...changes.values()].map(location=>{
        const selected=selections.get(location.graph)?.has(location.node) || false,next=toggle?!selected:true;
        count+=Number(next)-Number(selected);return {...location,selected:next};
    });
    if(count>limit)return false;
    for(const {graph,node,selected} of updates) {
        if(!selections.has(graph))selections.set(graph,new Set());
        if(selected)selections.get(graph).add(node);else selections.get(graph).delete(node);
    }
    return true;
}

export function selectionRectangle(start,end,bounds) {
    const x=p=>Math.max(bounds.left,Math.min(bounds.right,p.x)),y=p=>Math.max(bounds.top,Math.min(bounds.bottom,p.y));
    return {left:Math.min(x(start),x(end)),right:Math.max(x(start),x(end)),top:Math.min(y(start),y(end)),bottom:Math.max(y(start),y(end))};
}

export function layersInRectangle(candidates,rectangle) {
    if(rectangle.right<=rectangle.left || rectangle.bottom<=rectangle.top)return [];
    return candidates.filter(({rect})=>rect.right>rectangle.left && rect.left<rectangle.right && rect.bottom>rectangle.top && rect.top<rectangle.bottom);
}
