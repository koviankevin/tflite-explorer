import {test} from 'node:test';
import assert from 'node:assert/strict';
import {captureViewport,restoreViewport} from '../src/svg-viewport.js';

function scene({width=936,height=510,zoom=.6,left=500,top=320}={}) {
    const box={left:344,top:176},container={clientWidth:width,clientHeight:height,scrollLeft:left,scrollTop:top,getBoundingClientRect:()=>box,
        scrollTo({left,top,behavior}){assert.equal(behavior,'instant');this.scrollLeft=Math.max(0,left);this.scrollTop=Math.max(0,top);}};
    let padX=0,padY=0;
    const graph={_width:8000,_height:6000,_zoom:zoom,_scrollLeft:999,_scrollTop:999,set zoom(z){this._zoom=Math.max(.8,z);},get zoom(){return this._zoom;}};
    const canvas={style:{},setAttribute(name,value){assert.equal(name,'viewBox');const [x,y]=value.split(' ').map(Number);padX=-x;padY=-y;}};
    const node=(id,x,y)=>({id,element:{getBoundingClientRect:()=>({left:box.left+(x+padX)*graph.zoom-container.scrollLeft,top:box.top+(y+padY)*graph.zoom-container.scrollTop,width:80*graph.zoom,height:40*graph.zoom})}});
    return {container,graph,canvas,node};
}
test('reflow retains exact zoom and the surviving clicked endpoint after arbitrary pan at desktop/mobile sizes',()=>{
    for(const width of [375,936])for(const zoom of [.15,.43,1.2]) {
        const s=scene({width,zoom}),{container,graph,canvas,node}=s;
        const old=[node('from',(container.scrollLeft+width/2)/zoom-40,(container.scrollTop+210)/zoom-20),node('to',8000,5000)];
        const before=old[0].element.getBoundingClientRect(),snapshot=captureViewport(container,zoom,old,{preferred:['from','to'],point:{x:before.left+20,y:before.top+10}});
        // Collapse a helper and change both layout axes. The replacement's
        // native minimum zoom is intentionally higher than the saved zoom.
        graph._width=1200;graph._height=900;
        const next=[node('from',30,90),node('to',900,700)];
        restoreViewport(container,graph,canvas,next,snapshot);
        assert.equal(graph.zoom,zoom);
        const after=next[0].element.getBoundingClientRect();
        assert.ok(Math.abs(after.left-before.left)<1e-8);assert.ok(Math.abs(after.top-before.top)<1e-8);
        assert.equal(graph._scrollLeft,undefined);assert.equal(graph._scrollTop,undefined);
        assert.equal(parseFloat(canvas.style.width),1200*zoom+2*width);
    }
});
test('a disappearing helper falls back to its connection endpoints, never an unrelated OP',()=>{
    const {container,graph,canvas,node}=scene(),entries=[node('helper',1500,900),node('from',1600,950),node('unrelated',1490,890)];
    const snapshot=captureViewport(container,graph.zoom,entries,{preferred:['helper','from']});
    assert.ok(snapshot.candidates.every(c=>c.id!=='unrelated'));
    const before=entries[1].element.getBoundingClientRect(),next=[node('from',800,800)];
    restoreViewport(container,graph,canvas,next,snapshot);
    const after=next[0].element.getBoundingClientRect();
    assert.ok(Math.abs(after.left-before.left)<1e-8);assert.ok(Math.abs(after.top-before.top)<1e-8);
});
test('sidebar collapse uses the nearest surviving visible OP and offscreen endpoints return near the viewport edge',()=>{
    const {container,graph,canvas,node}=scene(),snapshot=captureViewport(container,graph.zoom,[node('far',9000,9000),node('near',1500,900)]);
    assert.equal(snapshot.candidates[0].id,'near');
    const offscreen=captureViewport(container,graph.zoom,[node('far',9000,9000)],{preferred:['far']});
    const next=[node('far',100,100)];restoreViewport(container,graph,canvas,next,offscreen);
    const r=next[0].element.getBoundingClientRect(),b=container.getBoundingClientRect();
    assert.equal(r.left+r.width/2-b.left,container.clientWidth-48);
    assert.equal(r.top+r.height/2-b.top,container.clientHeight-48);
    assert.equal(captureViewport(container,NaN,[]),null);
});
test('mobile page scroll is restored before measuring the replacement graph landmark',()=>{
    const {container,graph,canvas,node}=scene({width:375});
    const page={scrollLeft:0,scrollTop:455,scrollTo({left,top,behavior}){assert.equal(behavior,'instant');this.scrollLeft=left;this.scrollTop=top;}};
    container.ownerDocument={scrollingElement:page};
    const snapshot=captureViewport(container,graph.zoom,[node('from',1500,900)]);
    page.scrollTop=397;
    restoreViewport(container,graph,canvas,[node('from',1200,500)],snapshot);
    assert.equal(page.scrollTop,455);
});
