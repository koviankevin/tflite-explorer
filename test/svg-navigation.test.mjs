import {test} from 'node:test';
import assert from 'node:assert/strict';
import {attachSVGNavigation,panSVG,resetSVGPan} from '../src/svg-navigation.js';

function scene({width=300,height=200,zoom=1}={}){
    const graph={_width:width,_height:height,zoom,_scrollLeft:9,_scrollTop:8},attrs=new Map();let left=0,top=0;
    const container={clientWidth:900,clientHeight:500,get scrollLeft(){return left;},set scrollLeft(v){left=Math.max(0,Math.min(this.maxX,v));},get scrollTop(){return top;},set scrollTop(v){top=Math.max(0,Math.min(this.maxY,v));},get maxX(){return Math.max(0,parseFloat(canvas.style.width)-this.clientWidth);},get maxY(){return Math.max(0,parseFloat(canvas.style.height)-this.clientHeight);}};
    const canvas={style:{width:`${width*zoom}px`,height:`${height*zoom}px`},getAttribute:key=>attrs.get(key)??null,setAttribute:(key,value)=>attrs.set(key,value),removeAttribute:key=>attrs.delete(key),getBoundingClientRect(){const w=parseFloat(this.style.width),h=parseFloat(this.style.height);return {left:200+Math.max(0,(container.clientWidth-w)/2)-left,top:100-top,right:200+Math.max(0,(container.clientWidth-w)/2)-left+w,bottom:100-top+h};}};
    const point=()=>{const raw=canvas.getAttribute('viewBox'),[x,y]=raw?raw.split(' ').map(Number):[0,0],r=canvas.getBoundingClientRect();return {x:r.left+(150-x)*graph.zoom,y:r.top+(100-y)*graph.zoom};};
    return {container,canvas,graph,point};
}
test('a fitted SVG pans on both axes and beyond native scroll bounds without changing zoom',()=>{
    for(const zoom of [.25,1,1.4]){
        const s=scene({zoom}),start=s.point();assert.equal(s.container.maxX,0);assert.equal(s.container.maxY,0);
        for(const [x,y] of [[80,0],[0,80],[-240,0],[0,-240]]){const before=s.point();assert.equal(panSVG(s.container,s.graph,s.canvas,x,y),true);const after=s.point();assert.ok(Math.abs(after.x-before.x+x)<1e-8);assert.ok(Math.abs(after.y-before.y+y)<1e-8);assert.equal(s.graph.zoom,zoom);}
        assert.equal(s.graph._scrollLeft,undefined);assert.equal(s.graph._scrollTop,undefined);resetSVGPan(s.graph,s.canvas);assert.equal(s.graph._width,300);assert.equal(s.graph._height,200);assert.equal(s.canvas.getAttribute('viewBox'),null);assert.ok(Number.isFinite(start.x));
    }
});
test('repeated SVG pan never grows the buffer; resize and zoom rebuild a bounded buffer with no jump',()=>{
    const s=scene({width:2000,height:4000}),first=s.point();panSVG(s.container,s.graph,s.canvas,80,0);const width=s.graph._width,height=s.graph._height;
    for(let i=0;i<500;i++){panSVG(s.container,s.graph,s.canvas,240,-240);panSVG(s.container,s.graph,s.canvas,-240,240);}assert.equal(s.graph._width,width);assert.equal(s.graph._height,height);assert.ok(Math.abs(s.point().x-first.x+80)<1e-8);
    s.container.clientWidth=640;s.container.clientHeight=400;const before=s.point();panSVG(s.container,s.graph,s.canvas,0,0);assert.deepEqual(s.point(),before);assert.equal(s.graph._width,2000+1280);assert.equal(s.graph._height,4000+800);
    s.graph.zoom=.5;s.canvas.style.width=`${s.graph._width*.5}px`;s.canvas.style.height=`${s.graph._height*.5}px`;const afterZoom=s.point();panSVG(s.container,s.graph,s.canvas,-80,80);assert.ok(Math.abs(s.point().x-afterZoom.x-80)<1e-8);assert.ok(Math.abs(s.point().y-afterZoom.y+80)<1e-8);assert.equal(s.graph._width,2000+2*640/.5);
});
test('search location resets an unbounded pan before the original graph scrollTo measures its target',()=>{
    const s=scene(),calls=[];s.graph.scrollTo=function(...args){calls.push({args,width:this._width,viewBox:s.canvas.getAttribute('viewBox')});return 'located';};attachSVGNavigation(s.graph,s.canvas);panSVG(s.container,s.graph,s.canvas,80000,-80000);
    assert.equal(s.graph.scrollTo(['node'],'instant'),'located');assert.deepEqual(calls,[{args:[['node'],'instant'],width:300,viewBox:null}]);
});

for(const zoom of [.5,1,1.4])test(`visible OP focus keeps the WASD camera at zoom ${zoom}`,()=>{
    const s=scene({zoom});s.container.getBoundingClientRect=()=>({left:200,top:100,right:1100,bottom:600});
    s.canvas.ownerDocument={getElementById:id=>id==='target'?s.container:null};
    const calls=[];s.graph.scrollTo=selection=>{calls.push(selection);};attachSVGNavigation(s.graph,s.canvas);
    panSVG(s.container,s.graph,s.canvas,80,0);const before=s.point(),box=s.canvas.getAttribute('viewBox');
    const op={getBoundingClientRect:()=>({left:before.x,top:before.y,right:before.x+10,bottom:before.y+10})};
    s.graph.scrollTo([op]);assert.deepEqual(s.point(),before);assert.equal(s.canvas.getAttribute('viewBox'),box);assert.deepEqual(calls,[[op]]);
});

test('an empty or partially visible selection does not reset the keyboard camera',()=>{
    const s=scene();s.container.getBoundingClientRect=()=>({left:200,top:100,right:1100,bottom:600});s.canvas.ownerDocument={getElementById:()=>s.container};s.graph.scrollTo=()=>{};attachSVGNavigation(s.graph,s.canvas);panSVG(s.container,s.graph,s.canvas,80,0);
    const before=s.canvas.getAttribute('viewBox');for(const selection of [[],null,[{getBoundingClientRect:()=>({left:190,top:110,right:210,bottom:140})}]]){s.graph.scrollTo(selection);assert.equal(s.canvas.getAttribute('viewBox'),before);}
});

test('a focus group containing an offscreen OP still resets and locates beyond the native bounds',()=>{
    for(const elements of [[{left:-500,top:120,right:-400,bottom:140}],[{left:300,top:120,right:330,bottom:140},{left:2000,top:120,right:2030,bottom:140}]]){
        const s=scene(),calls=[];s.container.getBoundingClientRect=()=>({left:200,top:100});s.canvas.ownerDocument={getElementById:()=>s.container};s.graph.scrollTo=()=>calls.push(s.canvas.getAttribute('viewBox'));attachSVGNavigation(s.graph,s.canvas);panSVG(s.container,s.graph,s.canvas,80000,0);s.graph.scrollTo(elements.map(rect=>({getBoundingClientRect:()=>rect})));assert.deepEqual(calls,[null]);
    }
});
