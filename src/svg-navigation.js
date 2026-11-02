// A fixed SVG viewport buffer permits camera movement even when the drawing
// fits the pane. Pan changes only viewBox origin, never a clamped scroll offset.
// The WeakMap belongs to each rendered SVG and cannot retain a closed model.
const states=new WeakMap();
const attachments=new WeakMap();
export function attachSVGNavigation(graph,canvas){
    if(!graph||!canvas||typeof graph.scrollTo!=='function')return;
    const previous=attachments.get(graph);if(previous?.canvas===canvas)return;
    const scroll=previous?.scroll || graph.scrollTo;
    graph.scrollTo=function(...args){resetSVGPan(this,canvas);return scroll.apply(this,args);};
    attachments.set(graph,{canvas,scroll});
}
const box=(canvas,graph)=>{
    const values=(canvas.getAttribute('viewBox') || '').trim().split(/[ ,]+/).map(Number);
    return values.length===4&&values.every(Number.isFinite)&&values[2]>0&&values[3]>0?values:[0,0,graph._width,graph._height];
};
export function panSVG(container,graph,canvas,x,y){
    const zoom=graph?.zoom;if(!canvas||!Number.isFinite(zoom)||zoom<=0)return false;
    let state=states.get(canvas);if(!state){state={base:box(canvas,graph),attribute:canvas.getAttribute('viewBox')};states.set(canvas,state);}
    let [left,top,width,height]=box(canvas,graph);
    const nextWidth=state.base[2]+2*container.clientWidth/zoom,nextHeight=state.base[3]+2*container.clientHeight/zoom;
    if(Math.abs(width-nextWidth)>.01||Math.abs(height-nextHeight)>.01){
        const previous=canvas.getBoundingClientRect(),padX=(nextWidth-width)/2,padY=(nextHeight-height)/2;
        left-=padX;top-=padY;width=nextWidth;height=nextHeight;graph._width=width;graph._height=height;
        canvas.setAttribute('viewBox',`${left} ${top} ${width} ${height}`);canvas.style.width=`${width*zoom}px`;canvas.style.height=`${height*zoom}px`;
        const current=canvas.getBoundingClientRect();container.scrollLeft+=current.left-previous.left+padX*zoom;container.scrollTop+=current.top-previous.top+padY*zoom;
    }
    canvas.setAttribute('viewBox',`${left+x/zoom} ${top+y/zoom} ${width} ${height}`);
    delete graph._scrollLeft;delete graph._scrollTop;return true;
}
export function resetSVGPan(graph,canvas){
    const state=canvas&&states.get(canvas);if(!state)return;
    const zoom=graph.zoom;graph._width=state.base[2];graph._height=state.base[3];
    if(state.attribute===null)canvas.removeAttribute('viewBox');else canvas.setAttribute('viewBox',state.attribute);
    canvas.style.width=`${graph._width*zoom}px`;canvas.style.height=`${graph._height*zoom}px`;
    delete graph._scrollLeft;delete graph._scrollTop;states.delete(canvas);
}
