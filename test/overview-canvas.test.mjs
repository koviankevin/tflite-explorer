import {test} from 'node:test';
import assert from 'node:assert/strict';
import {overviewLayout} from '../src/overview-layout.js';
import {overviewCanvas} from '../src/overview-canvas.js';
import {updateLayerSelection} from '../src/pattern-selection.js';

// A DOM/animation adapter for the real renderer interface. It models focus
// loss on removal, so viewport redraw cannot accidentally swallow Enter.
function harness(){
    let next=0;const frames=new Map(),saved=new Map(['requestAnimationFrame','cancelAnimationFrame','ResizeObserver','devicePixelRatio'].map(k=>[k,globalThis[k]]));
    globalThis.requestAnimationFrame=callback=>{frames.set(++next,callback);return next;};globalThis.cancelAnimationFrame=id=>frames.delete(id);globalThis.ResizeObserver=class{observe(){}disconnect(){}};globalThis.devicePixelRatio=1;
    const doc={activeElement:null},ctx=new Proxy({},{get:(_,key)=>key==='measureText'?()=>({width:50}):()=>{}});
    class Element{
        constructor(tag){this.tagName=tag;this.children=[];this.parentElement=null;this.ownerDocument=doc;this.dataset={};this.style={};this.classList={add(){},remove(){}};this.listeners=new Map();this.width=0;this.height=0;this.clientWidth=1100;this.clientHeight=720;this.capture=new Set();}
        setAttribute(name,value){this[name]=value;}removeAttribute(name){delete this[name];}getContext(){return ctx;}getBoundingClientRect(){return this.rect || {left:0,top:0};}
        contains(node){return this===node || this.children.some(c=>c.contains(node));}
        replaceChildren(...children){if(this.children.some(c=>c.contains(doc.activeElement)))doc.activeElement=doc.body;this.children=children;for(const c of children)c.parentElement=this;}
        addEventListener(name,fn){this.listeners.set(name,fn);}removeEventListener(name){this.listeners.delete(name);}focus(){doc.activeElement=this;this.onfocus?.();}
        setPointerCapture(id){this.capture.add(id);}hasPointerCapture(id){return this.capture.has(id);}releasePointerCapture(id){this.capture.delete(id);}
        emit(name,event={}){this.listeners.get(name)?.({preventDefault(){},stopPropagation(){},stopImmediatePropagation(){},button:0,pointerId:1,pointerType:'mouse',...event});}
    }
    doc.createElement=tag=>new Element(tag);doc.body=new Element('body');doc.activeElement=doc.body;
    const events=new Element('document');doc.addEventListener=events.addEventListener.bind(events);doc.removeEventListener=events.removeEventListener.bind(events);doc.emit=events.emit.bind(events);doc.defaultView=new Element('window');
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

test('Canvas keyboard controls remain bounded, identify blocks, and update selection labels without replacing focused controls',()=>{
    const env=harness();try{
        const nodes=Array.from({length:2000},(_,i)=>({identifier:String(i),name:`OP ${i}`,type:{name:'company.custom'},diagramKind:'operator',sourceGraph:i%4,sourceNode:i,x:0,y:0,width:120,height:60,minX:0,minY:0,maxX:120,maxY:60})),captures=[];
        const controller=overviewCanvas(env.target,{nodes,edges:[],groups:[],font:32,width:200,height:100},{activate(){},capture:(hits,options)=>captures.push({ids:hits.map(n=>n.identifier),...options})});controller.focus(['0'],1);env.flush();
        const controls=env.target.children[2];assert.equal(controls.className,'overview-node-controls');assert.equal(controls.children.length,100);
        const button=controls.children[0];button.focus();env.flush();assert.match(button.textContent,/block\/subgraph 0/);assert.equal(env.target.children[0].dataset.focusedNode,'0');
        controller.setPicking(true,['0']);env.flush();assert.equal(env.doc.activeElement,button);assert.match(button.textContent,/選取 layer/);assert.equal(button['aria-pressed'],'true');button.onclick();assert.deepEqual(captures,[{ids:['0'],toggle:true}]);
        controller.setPicking(false);env.flush();assert.equal(env.doc.activeElement,button);assert.match(button.textContent,/查看節點/);assert.equal(button['aria-pressed'],undefined);controller.dispose();
    }finally{env.restore();}
});

test('Canvas and focused-node keys pan/zoom without changing captured OPs; native button activation is not handled twice',()=>{
    const env=harness();try{
        const node={identifier:'op',name:'op',diagramKind:'operator',sourceGraph:2,sourceNode:3,x:0,y:0,width:120,height:60,minX:0,minY:0,maxX:120,maxY:60},captures=[];
        const controller=overviewCanvas(env.target,{nodes:[node],edges:[],groups:[],font:32,width:200,height:100},{activate(){},capture:hits=>captures.push(hits.map(n=>n.identifier))}),canvas=env.target.children[0],controls=env.target.children[2];controller.focus(['op'],1);controller.setPicking(true,['op']);env.flush();
        const before=controller.snapshot();controls.emit('keydown',{key:'ArrowRight'});controls.emit('keydown',{key:'+'});env.flush();assert.notDeepEqual(controller.snapshot(),before);assert.equal(canvas.dataset.selectionCount,'1');
        controls.emit('keydown',{key:'Enter'});controls.emit('keydown',{key:' '});assert.deepEqual(captures,[],'native button activation must remain native');canvas.emit('keydown',{key:' '});assert.deepEqual(captures,[['op']]);
        const current=controller.snapshot();canvas.emit('keydown',{key:'ArrowRight',ctrlKey:true});assert.deepEqual(controller.snapshot(),current);controller.dispose();
    }finally{env.restore();}
});

test('async capsule expansion returns focus from the graph fallback but never steals a later toolbar focus',async()=>{
    for(const moved of [false,true]){
        const env=harness();try{
            const node={identifier:'capsule',name:'Named pattern',diagramKind:'pattern',x:0,y:0,width:120,height:60,minX:0,minY:0,maxX:120,maxY:60},next=env.doc.createElement('canvas'),toolbar=env.doc.createElement('button');next.isConnected=true;let controller,button;
            controller=overviewCanvas(env.target,{nodes:[node],edges:[],groups:[],font:32,width:200,height:100},{activate(){controller.dispose();button.isConnected=false;env.target.replaceChildren(next);env.doc.activeElement=moved?toolbar:env.target;return Promise.resolve(next);}});controller.focus(['capsule'],1);env.flush();button=env.target.children[2].children[0];button.isConnected=true;button.focus();env.flush();assert.match(button.textContent,/Named pattern/);button.onclick({detail:0});await Promise.resolve();assert.equal(env.doc.activeElement,moved?toolbar:next);
        }finally{env.restore();}
    }
});

test('Canvas box selection inverse-transforms zoom/pan with a DOM offset, preserves blocks and excludes scaffolding and offscreen OPs',()=>{
    const env=harness();try{
        const node=(identifier,x,y,diagramKind='operator',sourceGraph=1)=>({identifier,name:identifier,type:{name:'company.custom'},sourceGraph,sourceNode:0,diagramKind,x,y,width:120,height:60,minX:x,minY:y,maxX:x+120,maxY:y+60});
        const nodes=[node('a',100,100),node('b',320,100,'operator',2),node('c',100,300,'operator',3),node('header',230,100,'block'),node('capsule',240,110,'pattern'),node('far',10000,10000,'operator',99)];
        const selected=new Map(),commits=[];let controller;
        controller=overviewCanvas(env.target,{nodes,edges:[],groups:[],font:32,width:11000,height:11000},{activate:()=>assert.fail('selection must not open details'),capture:(hits,options)=>{
            commits.push({ids:hits.map(n=>n.identifier).sort(),toggle:options.toggle});updateLayerSelection(selected,hits.map(n=>({graph:n.sourceGraph,node:n.sourceNode})),options);
            controller.setPicking(true,nodes.filter(n=>selected.get(n.sourceGraph)?.has(n.sourceNode) && n.diagramKind==='operator').map(n=>n.identifier));
        }});
        const canvas=env.target.children[0];canvas.rect={left:120,top:90};controller.focus(nodes.slice(0,3).map(n=>n.identifier),1);controller.setPicking(true);env.flush();
        canvas.emit('pointerdown',{clientX:900,clientY:600,altKey:true});canvas.emit('pointermove',{clientX:820,clientY:650});canvas.emit('pointerup',{clientX:820,clientY:650});assert.equal(commits.length,0);
        canvas.emit('wheel',{clientX:670,clientY:450,deltaY:100});env.flush();assert.ok(Number(canvas.dataset.zoom)<1);
        const box=(start,end)=>{canvas.emit('pointerdown',{clientX:start[0],clientY:start[1]});canvas.emit('pointermove',{clientX:end[0],clientY:end[1]});env.flush();assert.equal(canvas.dataset.marqueeCount,'2');canvas.emit('pointerup',{clientX:end[0],clientY:end[1]});env.flush();};
        box([730,450],[520,395]);assert.deepEqual(commits.at(-1),{ids:['a','b'],toggle:true});assert.deepEqual([...selected.keys()].sort(),[1,2]);assert.equal(canvas.dataset.selectionCount,'2');
        box([520,395],[730,450]);assert.equal(canvas.dataset.selectionCount,'0','a repeated rectangle removes selected OPs exactly once');
        box([730,450],[520,395]);assert.equal(canvas.dataset.selectionCount,'2');
        canvas.emit('pointerdown',{clientX:566,clientY:532});canvas.emit('pointerup',{clientX:566,clientY:532});env.flush();assert.deepEqual(commits.at(-1),{ids:['c'],toggle:true});assert.equal(canvas.dataset.selectionCount,'3');
        canvas.emit('pointerdown',{clientX:566,clientY:532});canvas.emit('pointerup',{clientX:566,clientY:532});env.flush();assert.equal(canvas.dataset.selectionCount,'2');
        canvas.emit('pointerdown',{clientX:-10000,clientY:-10000});canvas.emit('pointermove',{clientX:20000,clientY:20000});canvas.emit('pointerup',{clientX:20000,clientY:20000});assert.deepEqual(commits.at(-1).ids,['a','b','c'],'the selection is clipped to the actual viewport, not its preload margin or the whole model');
        controller.dispose();
    }finally{env.restore();}
});

test('unfinished Canvas rectangles are cancelled on viewport changes, Escape, blur, scroll, lost capture and disposal',()=>{
    for(const action of ['pointercancel','lostpointercapture','escape','blur','scroll','resize','zoom','focus','mode','dispose']){
        const env=harness();try{
            const node={identifier:'op',name:'company.custom',diagramKind:'operator',sourceGraph:1,sourceNode:0,x:50,y:50,width:120,height:60,minX:50,minY:50,maxX:170,maxY:110};let count=0;
            const controller=overviewCanvas(env.target,{nodes:[node],edges:[],groups:[],font:18,width:300,height:300},{activate(){},capture(){count++;}}),canvas=env.target.children[0];controller.focus(['op'],1);controller.setPicking(true,['op']);env.flush();
            canvas.emit('pointerdown',{clientX:470,clientY:315});canvas.emit('pointermove',{clientX:630,clientY:405});env.flush();assert.equal(canvas.dataset.marqueeCount,'1',action);
            if(action==='escape')env.doc.emit('keydown',{key:'Escape'});else if(action==='blur' || action==='resize')env.doc.defaultView.emit(action);else if(action==='scroll')env.doc.emit('scroll');else if(action==='zoom')controller.zoom(1.3);else if(action==='focus')controller.focus(['op']);else if(action==='mode')controller.setPicking(false);else if(action==='dispose')controller.dispose();else canvas.emit(action);
            canvas.emit('pointerup',{clientX:630,clientY:405});env.flush();assert.equal(count,0,action);if(action!=='dispose')controller.dispose();
        }finally{env.restore();}
    }
});
