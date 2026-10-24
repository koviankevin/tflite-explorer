import {selectionRectangle,layersInRectangle} from './pattern-selection.js?v=94d4e194395f65fd';

// Capture pointer gestures before Netron's panning listener. Geometry is read
// once on pointerdown in viewport coordinates, so SVG zoom/scroll and block
// groups require no inverse-transform guesses or per-frame layout reads.
export function rectangleSelection(target,{enabled,candidates,commit}) {
    const doc=target.ownerDocument;let drag=null,suppressClick=false;
    const cancel=()=>{
        if(!drag)return false;
        const previous=drag;drag=null;
        previous.box?.remove();previous.candidates.forEach(c=>c.element.classList.remove('marquee-hit'));
        doc.removeEventListener('pointermove',move,true);doc.removeEventListener('pointerup',up,true);doc.removeEventListener('pointercancel',cancelPointer,true);
        if(target.hasPointerCapture(previous.id))target.releasePointerCapture(previous.id);
        return true;
    };
    const update=event=>{
        const rect=selectionRectangle(drag.start,{x:event.clientX,y:event.clientY},drag.bounds);
        drag.rect=rect;drag.hits=layersInRectangle(drag.candidates,rect);
        const hits=new Set(drag.hits);
        drag.candidates.forEach(c=>c.element.classList.toggle('marquee-hit',hits.has(c)));
        Object.assign(drag.box.style,{left:`${rect.left}px`,top:`${rect.top}px`,width:`${rect.right-rect.left}px`,height:`${rect.bottom-rect.top}px`});
        drag.box.firstChild.textContent=`框選 ${drag.hits.length} 個 layers`;
    };
    const move=event=>{
        if(!drag || event.pointerId!==drag.id)return;
        if(!enabled()){cancel();return;}
        if(!drag.box && Math.hypot(event.clientX-drag.start.x,event.clientY-drag.start.y)<5)return;
        event.preventDefault();event.stopImmediatePropagation();
        if(!drag.box) {
            drag.box=doc.createElement('div');drag.box.className='layer-selection-box';drag.box.setAttribute('aria-hidden','true');drag.box.append(doc.createElement('span'));doc.body.append(drag.box);
            target.setPointerCapture(drag.id);
        }
        update(event);
    };
    const up=event=>{
        if(!drag || event.pointerId!==drag.id)return;
        if(!enabled()){cancel();return;}
        if(!drag.box){cancel();return;}
        event.preventDefault();event.stopImmediatePropagation();update(event);
        const hits=drag.hits;cancel();suppressClick=true;commit(hits.map(c=>c.location));
    };
    const cancelPointer=event=>{if(drag && event.pointerId===drag.id){suppressClick=!!drag.box;cancel();}};
    target.addEventListener('pointerdown',event=>{
        suppressClick=false;
        if(!enabled() || event.button!==0 || event.pointerType!=='mouse' || event.altKey)return;
        const rect=target.getBoundingClientRect(),bounds={left:rect.left+target.clientLeft,top:rect.top+target.clientTop};
        bounds.right=bounds.left+target.clientWidth;bounds.bottom=bounds.top+target.clientHeight;
        // Leave the native scrollbars usable while selecting.
        if(event.clientX<bounds.left || event.clientX>=bounds.right || event.clientY<bounds.top || event.clientY>=bounds.bottom)return;
        cancel();event.preventDefault();event.stopImmediatePropagation();
        drag={id:event.pointerId,start:{x:event.clientX,y:event.clientY},bounds,candidates:candidates().map(c=>({...c,rect:c.element.getBoundingClientRect()}))};
        doc.addEventListener('pointermove',move,true);doc.addEventListener('pointerup',up,true);doc.addEventListener('pointercancel',cancelPointer,true);
    },true);
    target.addEventListener('click',event=>{
        if(suppressClick && event.detail!==0){suppressClick=false;event.preventDefault();event.stopImmediatePropagation();}
    },true);
    target.addEventListener('lostpointercapture',cancelPointer);
    target.addEventListener('wheel',cancel,{capture:true,passive:true});
    target.addEventListener('scroll',cancel,{passive:true});
    doc.addEventListener('scroll',cancel,{capture:true,passive:true});
    doc.addEventListener('keydown',event=>{
        if(event.key==='Escape' && drag){suppressClick=!!drag.box;cancel();event.preventDefault();event.stopImmediatePropagation();}
    },true);
    doc.defaultView.addEventListener('blur',cancel);doc.defaultView.addEventListener('resize',cancel);
    return {cancel};
}
