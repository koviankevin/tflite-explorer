import {test} from 'node:test';
import assert from 'node:assert/strict';
import {overviewLayout} from '../src/overview-layout.js';
import {overviewCanvas} from '../src/overview-canvas.js';

// A DOM/animation adapter for the real renderer interface. It models focus
// loss on removal, so viewport redraw cannot accidentally swallow Enter.
function harness(){
    let next=0;const frames=new Map(),saved=new Map(['requestAnimationFrame','cancelAnimationFrame','ResizeObserver','devicePixelRatio'].map(k=>[k,globalThis[k]]));
    globalThis.requestAnimationFrame=callback=>{frames.set(++next,callback);return next;};globalThis.cancelAnimationFrame=id=>frames.delete(id);globalThis.ResizeObserver=class{observe(){}disconnect(){}};globalThis.devicePixelRatio=1;
    const doc={activeElement:null},ctx=new Proxy({},{get:(_,key)=>key==='measureText'?()=>({width:50}):()=>{}});
    class Element{
        constructor(tag){this.tagName=tag;this.children=[];this.parentElement=null;this.ownerDocument=doc;this.dataset={};this.style={};this.classList={add(){},remove(){}};this.listeners=new Map();this.width=0;this.height=0;this.clientWidth=1100;this.clientHeight=720;this.capture=new Set();}
        setAttribute(){}getContext(){return ctx;}getBoundingClientRect(){return{left:0,top:0};}
        contains(node){return this===node || this.children.some(c=>c.contains(node));}
        replaceChildren(...children){if(this.children.some(c=>c.contains(doc.activeElement)))doc.activeElement=doc.body;this.children=children;for(const c of children)c.parentElement=this;}
        addEventListener(name,fn){this.listeners.set(name,fn);}focus(){doc.activeElement=this;this.onfocus?.();}
        setPointerCapture(id){this.capture.add(id);}hasPointerCapture(id){return this.capture.has(id);}releasePointerCapture(id){this.capture.delete(id);}
        emit(name,event={}){this.listeners.get(name)?.({preventDefault(){},stopPropagation(){},button:0,pointerId:1,...event});}
    }
    doc.createElement=tag=>new Element(tag);doc.body=new Element('body');doc.activeElement=doc.body;
    return{target:new Element('div'),doc,flush(){const pending=[...frames.values()];frames.clear();for(const f of pending)f();},restore(){for(const [k,v]of saved)if(v===undefined)delete globalThis[k];else globalThis[k]=v;}};
}
test('Canvas culls far nodes, updates after real pan/zoom handlers, and hit-tests transformed positions',()=>{
    const env=harness();try{
        const nodes=Array.from({length:3000},(_,i)=>({identifier:String(i),name:`company.op_${i}`,type:{name:'company.custom'},diagramKind:'operator',group:'region'})),edges=nodes.slice(1).map((n,i)=>({from:String(i),to:n.identifier,kind:'ssa'})),activated=[];
        const controller=overviewCanvas(env.target,overviewLayout(nodes,edges),{activate:n=>activated.push(n.identifier)}),canvas=env.target.children[0];env.flush();
        controller.focus(['1500'],1);env.flush();assert.ok(Number(canvas.dataset.renderedNodes)<10);assert.equal(canvas.dataset.totalNodes,'3000');
        canvas.emit('pointerdown',{clientX:550,clientY:360});canvas.emit('pointermove',{clientX:450,clientY:440});canvas.emit('pointerup',{clientX:450,clientY:440});env.flush();assert.deepEqual(activated,[],'a drag is not a node activation');
        canvas.emit('pointerdown',{clientX:450,clientY:440});canvas.emit('pointerup',{clientX:450,clientY:440});assert.deepEqual(activated,['1500']);
        canvas.emit('wheel',{clientX:450,clientY:440,deltaY:100});env.flush();assert.ok(Number(canvas.dataset.zoom)<1);
        canvas.emit('pointerdown',{clientX:450,clientY:440});canvas.emit('pointerup',{clientX:450,clientY:440});assert.deepEqual(activated,['1500','1500'],'wheel anchor stays on the same OP');
        controller.focus(['2990'],1);env.flush();assert.ok(env.target.children[2].children.some(b=>b.dataset.overviewNode==='2990'));assert.ok(env.target.children[2].children.every(b=>b.dataset.overviewNode!=='1500'));
        controller.dispose();env.flush();assert.equal(env.target.children.length,0);
    }finally{env.restore();}
});
test('focusing a viewport button preserves its DOM focus through the redraw until Enter activates it',()=>{
    const env=harness();try{
        const nodes=Array.from({length:2000},(_,i)=>({identifier:String(i),name:`OP ${i}`,group:'region'})),edges=nodes.slice(1).map((n,i)=>({from:String(i),to:n.identifier})),activated=[];
        const controller=overviewCanvas(env.target,overviewLayout(nodes,edges),{activate:n=>activated.push(n.identifier)});controller.focus(['1000'],1);env.flush();
        const accessible=env.target.children[2],button=accessible.children.find(b=>b.dataset.overviewNode==='1001');assert.ok(button);button.focus();env.flush();assert.equal(env.doc.activeElement,button);assert.ok(accessible.contains(button));button.onclick();assert.deepEqual(activated,['1001']);
        controller.dispose();
    }finally{env.restore();}
});
