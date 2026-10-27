import {spatialIndex,OverviewCamera} from './overview-layout.js?v=e67611582982ec3f';
import {selectionRectangle} from './pattern-selection.js?v=e67611582982ec3f';

// Only this adapter owns Canvas, pointer gestures, spatial queries and camera
// state. The model and export selections remain in the existing model Worker.
export function overviewCanvas(target,layout,{selected=[],activate,capture=()=>{},changed=()=>{}}) {
    const doc=target.ownerDocument,canvas=doc.createElement('canvas'),counter=doc.createElement('output'),accessible=doc.createElement('div');
    canvas.className='overview-canvas';canvas.tabIndex=0;canvas.setAttribute('role','img');canvas.setAttribute('aria-label','全模型虛擬總覽；拖曳平移，滾輪縮放，方向鍵移動，Home 顯示全圖，Enter 開啟選取節點');
    counter.className='overview-viewport-count';counter.setAttribute('aria-live','polite');accessible.className='sr-only';accessible.setAttribute('aria-label','視窗內節點');
    target.replaceChildren(canvas,counter,accessible);target.classList.add('virtual-overview');target.scrollLeft=0;target.scrollTop=0;
    const camera=new OverviewCamera(target.clientWidth,target.clientHeight),nodes=new Map(layout.nodes.map(n=>[n.identifier,n])),nodeIndex=spatialIndex(layout.nodes),edgeIndex=spatialIndex(layout.edges),ctx=canvas.getContext('2d');
    let picked=new Set(selected),captured=new Set(),picking=false,frame=0,destroyed=false,drag=null,lastButtons='',hover=null;
    camera.fit(layout);
    const schedule=()=>{if(!frame && !destroyed)frame=requestAnimationFrame(draw);};
    const rectangle=()=>selectionRectangle(drag.start,drag.last,{left:0,top:0,right:camera.width,bottom:camera.height});
    const inside=rect=>{const a=camera.world(rect.left,rect.top),b=camera.world(rect.right,rect.bottom);if(rect.right<=rect.left || rect.bottom<=rect.top)return[];
        return nodeIndex.query({minX:a.x,minY:a.y,maxX:b.x,maxY:b.y}).filter(n=>n.diagramKind==='operator' && n.maxX>a.x && n.minX<b.x && n.maxY>a.y && n.minY<b.y);};
    const cancel=()=>{const previous=drag;drag=null;if(previous && canvas.hasPointerCapture(previous.id))canvas.releasePointerCapture(previous.id);if(previous)schedule();};
    const choose=n=>{if(picking && n.diagramKind==='operator')capture([n],{toggle:true});else activate(n);};
    const draw=()=>{frame=0;if(destroyed)return;const ratio=Math.min(devicePixelRatio || 1,2),width=target.clientWidth,height=target.clientHeight;
        if(width!==camera.width || height!==camera.height){cancel();camera.pan((width-camera.width)/2,(height-camera.height)/2);camera.width=width;camera.height=height;}
        if(canvas.width!==Math.round(width*ratio) || canvas.height!==Math.round(height*ratio)){canvas.width=Math.round(width*ratio);canvas.height=Math.round(height*ratio);}
        ctx.setTransform(ratio,0,0,ratio,0,0);ctx.clearRect(0,0,width,height);ctx.translate(camera.x,camera.y);ctx.scale(camera.zoom,camera.zoom);
        const bounds=camera.bounds(80),visible=nodeIndex.query(bounds),edges=edgeIndex.query(bounds),detail=layout.font*camera.zoom>=7,box=drag?.mode==='box' && drag.moved?rectangle():null,preview=new Set((box?inside(box):[]).map(n=>n.identifier));
        for(const group of layout.groups){if(group.x>bounds.maxX || group.y>bounds.maxY || group.x+group.width<bounds.minX || group.y+group.height<bounds.minY)continue;ctx.fillStyle='#edf3ed55';ctx.fillRect(group.x,group.y,group.width,group.height);ctx.strokeStyle='#b9c9bd';ctx.lineWidth=1/camera.zoom;ctx.strokeRect(group.x,group.y,group.width,group.height);if(detail){ctx.fillStyle='#53695d';ctx.font=`${layout.font}px sans-serif`;ctx.fillText(group.name,group.x+10,group.y+layout.font+4);}}
        for(const e of edges){const p=e.points;ctx.beginPath();ctx.moveTo(p[0].x,p[0].y);if(detail)ctx.bezierCurveTo(p[1].x,p[1].y,p[2].x,p[2].y,p[3].x,p[3].y);else ctx.lineTo(p[3].x,p[3].y);
            ctx.strokeStyle=e.kind==='control'?'#377cac':'#80988b';ctx.lineWidth=(e.kind==='control'?1.8:1)/camera.zoom;ctx.setLineDash(e.kind==='control'&&detail?[6/camera.zoom,4/camera.zoom]:[]);ctx.stroke();ctx.setLineDash([]);
            if(detail){const end=p[3],before=p[2],angle=Math.atan2(end.y-before.y,end.x-before.x),length=6/camera.zoom;ctx.beginPath();ctx.moveTo(end.x,end.y);ctx.lineTo(end.x-length*Math.cos(angle-.45),end.y-length*Math.sin(angle-.45));ctx.lineTo(end.x-length*Math.cos(angle+.45),end.y-length*Math.sin(angle+.45));ctx.closePath();ctx.fillStyle=e.kind==='control'?'#377cac':'#80988b';ctx.fill();}
        }
        for(const n of visible){const match=picked.has(n.identifier),selected=picking && (captured.has(n.identifier) || preview.has(n.identifier));ctx.fillStyle=selected?'#c8f0dc':match?'#ffe08a':n.diagramKind==='pattern'?'#18745d':n.diagramKind==='operator'?'#f5faf4':'#e6edf3';ctx.fillRect(n.x,n.y,n.width,n.height);ctx.strokeStyle=selected?'#18745d':match?'#a44700':n.diagramKind==='pattern'?'#0b5341':'#7f9889';ctx.lineWidth=(selected?4:match?3:1)/camera.zoom;ctx.strokeRect(n.x,n.y,n.width,n.height);
            if(detail){ctx.save();ctx.beginPath();ctx.rect(n.x+6,n.y+4,n.width-12,n.height-8);ctx.clip();ctx.fillStyle=n.diagramKind==='pattern'&&!match?'#fff':'#193b2b';ctx.font=`600 ${layout.font}px sans-serif`;const label=n.type?.name || n.name || n.identifier;const text=label.length>60?label.slice(0,57)+'…':label;ctx.fillText(text,n.x+12,n.y+layout.font+10);ctx.font=`${Math.max(12,layout.font*.72)}px sans-serif`;const info=n.diagramKind==='pattern'?n.name:`${n.sourceGraph===undefined?'邊界':`block/subgraph ${n.sourceGraph}`} · ${n.sourceNode===undefined?n.name:`#${n.sourceNode} · ${n.name || ''}`}`;ctx.fillText(info,n.x+12,n.y+n.height-12);ctx.restore();}
        }
        // A screen reader gets a bounded set of real controls, not a 20k-node
        // DOM. Search can always focus any off-screen occurrence by identifier.
        const buttons=(detail?visible.filter(n=>picked.has(n.identifier)).concat(visible.filter(n=>!picked.has(n.identifier))):visible.filter(n=>picked.has(n.identifier))).slice(0,100),signature=picking+'|'+buttons.map(n=>n.identifier).join('|');
        if(signature!==lastButtons && !accessible.contains(doc.activeElement)){lastButtons=signature;accessible.replaceChildren(...buttons.map(n=>{const button=doc.createElement('button');button.textContent=`${n.diagramKind==='pattern'?'展開 pattern':picking&&n.diagramKind==='operator'?'選取 layer':'查看節點'}：${n.name || n.type?.name} · ${n.identifier}`;button.dataset.overviewNode=n.identifier;button.onfocus=()=>controller.focus([n.identifier]);button.onclick=()=>choose(n);return button;}));}
        for(const button of accessible.children)if(picking)button.setAttribute('aria-pressed',String(captured.has(button.dataset.overviewNode)));else button.removeAttribute('aria-pressed');
        if(box){ctx.setTransform(ratio,0,0,ratio,0,0);ctx.fillStyle='#18745d22';ctx.fillRect(box.left,box.top,box.right-box.left,box.bottom-box.top);ctx.strokeStyle='#18745d';ctx.lineWidth=2;ctx.strokeRect(box.left,box.top,box.right-box.left,box.bottom-box.top);ctx.font='14px sans-serif';ctx.fillStyle='#103d30';ctx.fillText(`框選 ${preview.size} 個 layers`,box.left+6,box.top+18);}
        canvas.dataset.selectionCount=String(captured.size);canvas.dataset.marqueeCount=String(preview.size);
        canvas.dataset.renderedNodes=String(visible.length);canvas.dataset.totalNodes=String(layout.nodes.length);canvas.dataset.renderedEdges=String(edges.length);canvas.dataset.zoom=String(camera.zoom);
        const percent=camera.zoom*100;counter.textContent=`視窗繪製 ${visible.length.toLocaleString()} / ${layout.nodes.length.toLocaleString()} 節點 · ${edges.length.toLocaleString()} 連線 · ${percent<.1?percent.toPrecision(2):percent.toFixed(1)}%${detail?'':' · 縮放可看 OP 名稱'}`;changed({visible:visible.length,total:layout.nodes.length,zoom:camera.zoom});
    };
    const point=e=>{const r=canvas.getBoundingClientRect();return{x:e.clientX-r.left,y:e.clientY-r.top};};
    const hit=p=>{const v=camera.world(p.x,p.y);return nodeIndex.query({minX:v.x,maxX:v.x,minY:v.y,maxY:v.y}).at(-1);};
    canvas.addEventListener('wheel',e=>{e.preventDefault();cancel();const p=point(e);camera.zoomAt(Math.exp(-Math.max(-200,Math.min(200,e.deltaY))*.006),p.x,p.y);schedule();},{passive:false});
    canvas.addEventListener('pointerdown',e=>{if(e.button!==0 || drag)return;e.preventDefault();canvas.focus();const p=point(e);drag={id:e.pointerId,start:p,last:p,moved:false,mode:picking && e.pointerType!=='touch' && !e.altKey?'box':'pan'};canvas.setPointerCapture(e.pointerId);});
    canvas.addEventListener('pointermove',e=>{const p=point(e);if(drag && e.pointerId===drag.id){if(Math.hypot(p.x-drag.start.x,p.y-drag.start.y)>5)drag.moved=true;if(drag.moved && drag.mode==='pan')camera.pan(p.x-drag.last.x,p.y-drag.last.y);drag.last=p;if(drag.moved)schedule();}else{const n=hit(p);if(n?.identifier!==hover){hover=n?.identifier;canvas.title=n?`${n.name}\n${n.type?.name || ''}\n${n.identifier}`:picking?'拖曳框選，Alt＋拖曳平移；僅選取原始 OP':'拖曳平移，滾輪縮放，雙擊空白顯示全圖';canvas.style.cursor=picking?'crosshair':n?'pointer':'grab';}}});
    canvas.addEventListener('pointerup',e=>{if(!drag || drag.id!==e.pointerId)return;drag.last=point(e);const moved=drag.moved,mode=drag.mode,hits=moved&&mode==='box'?inside(rectangle()):null;cancel();if(hits){capture(hits,{toggle:false});return;}if(!moved){const n=hit(point(e));if(n){picked=new Set([n.identifier]);schedule();choose(n);}}});
    canvas.addEventListener('pointercancel',cancel);canvas.addEventListener('lostpointercapture',cancel);
    canvas.addEventListener('dblclick',e=>{if(!hit(point(e)))controller.fit();});
    canvas.addEventListener('keydown',e=>{const step=80;if(e.key==='Home'){controller.fit();}else if(e.key==='+' || e.key==='='){controller.zoom(1.4);}else if(e.key==='-'){controller.zoom(1/1.4);}else if(e.key==='Enter'){const n=nodes.get([...picked][0]);if(n)choose(n);}else if(['ArrowLeft','ArrowRight','ArrowUp','ArrowDown'].includes(e.key)){cancel();camera.pan(e.key==='ArrowLeft'?step:e.key==='ArrowRight'?-step:0,e.key==='ArrowUp'?step:e.key==='ArrowDown'?-step:0);schedule();}else return;e.preventDefault();e.stopPropagation();});
    const escape=e=>{if(e.key==='Escape' && drag){cancel();e.preventDefault();e.stopImmediatePropagation();}};
    doc.addEventListener('keydown',escape,true);doc.addEventListener('scroll',cancel,true);doc.defaultView.addEventListener('blur',cancel);doc.defaultView.addEventListener('resize',cancel);
    const observer=new ResizeObserver(schedule);observer.observe(target);
    accessible.addEventListener('focusout',schedule);
    const controller={
        get zoomValue(){return camera.zoom;},
        snapshot(){const center=camera.world(camera.width/2,camera.height/2);return {kind:'canvas',zoom:camera.zoom,x:center.x,y:center.y};},
        restore(state){cancel();camera.zoom=state.zoom;camera.x=camera.width/2-state.x*camera.zoom;camera.y=camera.height/2-state.y*camera.zoom;schedule();},
        select(ids){picked=new Set(ids || []);schedule();},
        focus(ids,zoom){cancel();const selected=ids.map(id=>nodes.get(id)).filter(Boolean);picked=new Set(ids);camera.focus(selected,zoom);schedule();},
        zoom(factor){cancel();camera.zoomAt(factor);schedule();},
        fit(){cancel();camera.fit(layout);schedule();},
        setPicking(enabled,ids=[]){cancel();picking=enabled;captured=new Set(ids);canvas.style.cursor=picking?'crosshair':'grab';canvas.setAttribute('aria-label',picking?'圈選 pattern；拖曳框選原始 OP，Alt＋拖曳平移，點選切換，Esc 取消選框':'全模型虛擬總覽；拖曳平移，滾輪縮放，方向鍵移動，Home 顯示全圖，Enter 開啟選取節點');schedule();},
        visibleLayers(){return inside({left:0,top:0,right:camera.width,bottom:camera.height});},
        dispose(){cancel();destroyed=true;observer.disconnect();cancelAnimationFrame(frame);doc.removeEventListener('keydown',escape,true);doc.removeEventListener('scroll',cancel,true);doc.defaultView.removeEventListener('blur',cancel);doc.defaultView.removeEventListener('resize',cancel);target.classList.remove('virtual-overview');target.replaceChildren();}
    };
    schedule();return controller;
}
