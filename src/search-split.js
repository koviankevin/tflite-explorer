// The split belongs to the page, never to a model or its worker.
export function searchSplit(handle) {
    const doc=handle.ownerDocument,win=doc.defaultView,pane=handle.parentElement;
    const settings=doc.getElementById('search-controls'),key='model-lens.pattern-split.v1';
    let preferred=.5,active=false,drag=null,frame=0,pending=null,disposed=false;
    try {const value=win.localStorage.getItem(key);if(value!==null&&Number.isFinite(Number(value))&&Number(value)>0&&Number(value)<1)preferred=Number(value);} catch { /* The split still works without storage. */ }
    const bounds=()=>{const available=Math.max(0,pane.clientHeight-handle.offsetHeight),min=Math.min(64,available*.2);return {available,min,max:Math.max(min,available-200)};};
    const clamp=(value,b)=>Math.max(b.min,Math.min(b.max,value));
    const render=()=>{
        if(disposed||!active)return;
        const b=bounds(),height=Math.round(clamp(b.available*preferred,b));
        pane.style.setProperty('--pattern-settings-height',`${height}px`);
        handle.setAttribute('aria-valuemin',String(Math.round(b.min)));
        handle.setAttribute('aria-valuemax',String(Math.round(b.max)));
        handle.setAttribute('aria-valuenow',String(height));
        handle.setAttribute('aria-valuetext',`搜尋設定 ${height} 像素，搜尋結果 ${Math.max(0,Math.round(b.available-height))} 像素`);
    };
    const store=()=>{try{win.localStorage.setItem(key,String(preferred));}catch{/* Keep the current session preference. */}};
    const flush=()=>{
        if(frame)win.cancelAnimationFrame(frame);frame=0;
        if(pending!==null){const b=bounds();if(b.available>0)preferred=clamp(pending,b)/b.available;pending=null;}
        render();
    };
    const schedule=()=>{if(!frame&&!disposed)frame=win.requestAnimationFrame(()=>{frame=0;flush();});};
    const finish=()=>{
        if(!drag)return;
        const id=drag.id;drag=null;flush();doc.documentElement.classList.remove('resizing-search-split');
        if(handle.hasPointerCapture(id))handle.releasePointerCapture(id);store();
    };
    const start=event=>{
        if(!active||event.button!==0||drag)return;
        event.preventDefault();handle.focus({preventScroll:true});
        drag={id:event.pointerId,y:event.clientY,height:settings.getBoundingClientRect().height,preferred};
        handle.setPointerCapture(event.pointerId);doc.documentElement.classList.add('resizing-search-split');
    };
    const move=event=>{if(drag&&event.pointerId===drag.id){pending=drag.height+event.clientY-drag.y;schedule();}};
    const reset=()=>{finish();preferred=.5;render();store();};
    const keyboard=event=>{
        if(!active)return;
        if(event.key==='Escape'&&drag){preferred=drag.preferred;pending=null;finish();event.preventDefault();event.stopPropagation();return;}
        if(event.key==='Enter'){reset();event.preventDefault();event.stopPropagation();return;}
        const b=bounds(),current=clamp(b.available*preferred,b),step=event.shiftKey?40:10;
        const next=event.key==='ArrowUp'?current-step:event.key==='ArrowDown'?current+step:event.key==='Home'?b.min:event.key==='End'?b.max:null;
        if(next===null)return;event.preventDefault();event.stopPropagation();pending=next;flush();store();
    };
    handle.addEventListener('pointerdown',start);handle.addEventListener('pointermove',move);
    for(const type of ['pointerup','pointercancel','lostpointercapture'])handle.addEventListener(type,finish);
    handle.addEventListener('keydown',keyboard);handle.addEventListener('dblclick',reset);win.addEventListener('blur',finish);
    // Observe only the outer allocation; child scroll height never drives the split.
    const observer=new win.ResizeObserver(schedule);observer.observe(pane);
    return {setActive(value){finish();active=value;pane.classList.toggle('pattern-split',value);handle.hidden=!value;render();},dispose(){finish();disposed=true;observer.disconnect();win.cancelAnimationFrame(frame);win.removeEventListener('blur',finish);handle.removeEventListener('pointerdown',start);handle.removeEventListener('pointermove',move);for(const type of ['pointerup','pointercancel','lostpointercapture'])handle.removeEventListener(type,finish);handle.removeEventListener('keydown',keyboard);handle.removeEventListener('dblclick',reset);}};
}
