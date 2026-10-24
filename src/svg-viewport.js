// Preserve a local landmark through a layout change. Prefer the clicked
// segment's surviving endpoints, then the original connection's endpoints.
export function captureViewport(container,zoom,entries,{preferred=[],point}={}) {
    if(!Number.isFinite(zoom) || zoom<=0)return null;
    const rect=container.getBoundingClientRect(),width=container.clientWidth,height=container.clientHeight;
    const focus=point?{x:point.x-rect.left,y:point.y-rect.top}:{x:width/2,y:height/2};
    const candidates=entries.filter(e=>e.element && (!preferred.length || preferred.includes(e.id))).map(e=>{
        const r=e.element.getBoundingClientRect(),x=r.left+r.width/2-rect.left,y=r.top+r.height/2-rect.top;
        return {id:e.id,x,y,distance:Math.hypot(x-focus.x,y-focus.y)};
    }).filter(e=>Number.isFinite(e.x+e.y)).sort((a,b)=>a.distance-b.distance);
    const page=container.ownerDocument?.scrollingElement;
    return {zoom,candidates,scrollLeft:container.scrollLeft,scrollTop:container.scrollTop,page:page?{left:page.scrollLeft,top:page.scrollTop}:null};
}

export function restoreViewport(container,graph,canvas,entries,snapshot) {
    if(!snapshot || !graph || !canvas)return;
    // A smaller replacement graph must still allow the old zoom and pan.
    // One viewport of SVG space on each side avoids scroll clamping at 0.
    // Each redraw starts from a fresh SVG, so these margins never accumulate.
    const zoom=snapshot.zoom,padX=container.clientWidth/zoom,padY=container.clientHeight/zoom;
    graph._width+=2*padX;graph._height+=2*padY;
    canvas.setAttribute('viewBox',`${-padX} ${-padY} ${graph._width} ${graph._height}`);
    graph.zoom=zoom;
    // Netron's minimum fit zoom varies with layout; retain the exact camera
    // scale even when the newly collapsed graph fits inside the viewport.
    graph._zoom=zoom;canvas.style.width=`${graph._width*zoom}px`;canvas.style.height=`${graph._height*zoom}px`;
    if(snapshot.page)container.ownerDocument.scrollingElement.scrollTo({...snapshot.page,behavior:'instant'});
    const nodes=new Map(entries.filter(e=>e.element).map(e=>[e.id,e.element]));
    const anchor=snapshot.candidates.find(e=>nodes.has(e.id)),bounds=container.getBoundingClientRect();
    let left=snapshot.scrollLeft,top=snapshot.scrollTop;
    if(anchor) {
        const r=nodes.get(anchor.id).getBoundingClientRect();
        const clamp=(v,size)=>Math.min(Math.max(v,Math.min(48,size/2)),Math.max(size-48,size/2));
        left=container.scrollLeft+r.left+r.width/2-bounds.left-clamp(anchor.x,container.clientWidth);
        top=container.scrollTop+r.top+r.height/2-bounds.top-clamp(anchor.y,container.clientHeight);
    }
    container.scrollTo({left,top,behavior:'instant'});
    delete graph._scrollLeft;delete graph._scrollTop;
}
