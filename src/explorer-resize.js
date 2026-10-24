// One controller per page; model open/close does not add event listeners.
export function explorerResize(handle) {
    const doc=handle.ownerDocument,win=doc.defaultView,root=doc.documentElement;
    const bar=doc.querySelector('.graph-bar'),key='model-lens.explorer-width.v1';
    const minimum=280,maximum=720,desktop=()=>win.innerWidth>900;
    const fallback=()=>win.innerWidth<=1100?300:344;
    const limit=()=>Math.max(minimum,Math.min(maximum,win.innerWidth-(doc.body.classList.contains('details-open')?975:600),win.innerWidth<=1600?Math.floor(win.innerWidth*.35):maximum));
    const clamp=value=>Math.round(Math.max(minimum,Math.min(limit(),value)));
    let preferred=null,drag=null,moveFrame=0,barFrame=0,pending=null,lastHeight=0;
    try {const stored=win.localStorage.getItem(key);if(stored!==null&&Number.isFinite(Number(stored))&&Number(stored)>0)preferred=Number(stored);} catch { /* Storage can be unavailable. */ }
    const measureBar=()=>{
        if(barFrame)return;
        barFrame=win.requestAnimationFrame(()=>{barFrame=0;if(!desktop())return;const height=Math.ceil(bar.getBoundingClientRect().height);if(height>0&&height!==lastHeight){lastHeight=height;root.style.setProperty('--bar',`${height}px`);}});
    };
    const render=()=>{
        if(!desktop()){root.style.removeProperty('--aside');root.style.removeProperty('--bar');root.classList.remove('compact-graph-bar');lastHeight=0;return;}
        const width=clamp(preferred??fallback());
        root.style.setProperty('--aside',`${width}px`);
        root.classList.toggle('compact-graph-bar',win.innerWidth-width<1100);
        handle.setAttribute('aria-valuemin',String(minimum));handle.setAttribute('aria-valuemax',String(limit()));handle.setAttribute('aria-valuenow',String(width));handle.setAttribute('aria-valuetext',`${width} 像素`);
        measureBar();
    };
    const store=()=>{try{win.localStorage.setItem(key,String(preferred));}catch{/* Resizing remains available. */}};
    const flush=()=>{if(moveFrame)win.cancelAnimationFrame(moveFrame);moveFrame=0;if(pending!==null){preferred=clamp(pending);pending=null;render();}};
    const finish=()=>{
        if(!drag)return;const id=drag.id;drag=null;flush();root.classList.remove('resizing-explorer');
        if(handle.hasPointerCapture(id))handle.releasePointerCapture(id);store();
    };
    const start=event=>{
        if(!desktop()||event.button!==0||drag)return;
        event.preventDefault();handle.focus();const width=clamp(preferred??fallback());
        drag={id:event.pointerId,offset:event.clientX-width,start:width};
        root.classList.add('resizing-explorer');handle.setPointerCapture(event.pointerId);
    };
    const move=event=>{
        if(!drag||event.pointerId!==drag.id)return;pending=event.clientX-drag.offset;
        if(!moveFrame)moveFrame=win.requestAnimationFrame(()=>{moveFrame=0;flush();});
    };
    const reset=()=>{preferred=fallback();render();store();};
    const keyboard=event=>{
        if(!desktop())return;
        if(event.key==='Escape'&&drag){pending=drag.start;finish();event.preventDefault();return;}
        if(event.key==='Enter'){reset();event.preventDefault();return;}
        const step=event.shiftKey?40:10,current=clamp(preferred??fallback());
        const next=event.key==='ArrowLeft'?current-step:event.key==='ArrowRight'?current+step:event.key==='Home'?minimum:event.key==='End'?limit():null;
        if(next===null)return;event.preventDefault();event.stopPropagation();preferred=clamp(next);render();store();
    };
    const resize=()=>{finish();render();};
    handle.addEventListener('pointerdown',start);handle.addEventListener('pointermove',move);
    handle.addEventListener('pointerup',finish);handle.addEventListener('pointercancel',finish);handle.addEventListener('lostpointercapture',finish);
    handle.addEventListener('keydown',keyboard);handle.addEventListener('dblclick',reset);
    win.addEventListener('blur',finish);win.addEventListener('resize',resize);
    // Details consume the right column. Temporarily constrain the explorer;
    // retain the preferred width so closing details restores it.
    let detailsOpen=doc.body.classList.contains('details-open');
    const detailsObserver=new win.MutationObserver(()=>{const next=doc.body.classList.contains('details-open');if(next!==detailsOpen){detailsOpen=next;render();}});
    detailsObserver.observe(doc.body,{attributes:true,attributeFilter:['class']});
    const observer=new win.ResizeObserver(measureBar);observer.observe(bar);render();
    return {setWidth(value){finish();preferred=Math.max(minimum,Math.min(maximum,value));render();store();},dispose(){finish();observer.disconnect();detailsObserver.disconnect();win.cancelAnimationFrame(barFrame);win.removeEventListener('blur',finish);win.removeEventListener('resize',resize);handle.removeEventListener('pointerdown',start);handle.removeEventListener('pointermove',move);for(const type of ['pointerup','pointercancel','lostpointercapture'])handle.removeEventListener(type,finish);handle.removeEventListener('keydown',keyboard);handle.removeEventListener('dblclick',reset);}};
}
