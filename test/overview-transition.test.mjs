import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
import {View,NodeSidebar} from '../vendor/netron/view.js';

const source=await readFile(new URL('../src/app.js',import.meta.url),'utf8');
const dispose=source.match(/^function disposeVirtualOverview\(\)\{[^\n]+\}/m)?.[0];
const enter=source.match(/if\(dto\.virtual\)\{\s*([\s\S]*?)\s*const graph=dto\.graph;/)?.[1];
assert.ok(dispose&&enter,'exercise the actual application transition, not a copied ordering');

function harness(canvas){
    const errors=[],events=[],view=Object.create(View.prototype),classes=new Set();classes.remove=(...names)=>names.forEach(n=>classes.delete(n));
    view._host={event(){},update(){},document:{body:{classList:classes}}};view._events={selectionchange(){}};view.exception=error=>errors.push(error.message);
    view.target={on(){},off(){},unregister(){},select(values){events.push('select');return values;},scrollTo(){events.push('scroll');},blur(){events.push('blur');},register(){events.push('register');}};
    // Use Netron's actual deactivate/emit path: closing a node sidebar emits
    // select(null), then blur. Those handlers need the outgoing graph alive.
    const sidebar=Object.create(NodeSidebar.prototype);sidebar._view=view;sidebar._focused=new Set(['tensor']);
    sidebar.error=error=>errors.push(error.message); // Observe reporting without constructing Netron's error DOM.
    sidebar.on('select',(_,value)=>view.target.scrollTo(view.target.select([value],'sidebar')));sidebar.on('blur',(_,value)=>view.target.blur([value]));
    let open=true;view._sidebar={close(){if(open){open=false;events.push('close-sidebar');sidebar.deactivate();}}};
    const context=vm.createContext({view,virtualOverview:canvas?{zoomValue:.5,dispose(){events.push('dispose-canvas');}}:null,layerMarquee:{cancel(){events.push('cancel-marquee');}}});
    return {context,errors,events,view};
}

for(const canvas of [false,true])test(`open node details can transition from ${canvas?'Canvas':'SVG'} to Canvas without a null target`,()=>{
    const h=harness(canvas);vm.runInContext(dispose+'\n'+enter,h.context);assert.deepEqual(h.errors,[]);assert.ok(h.events.includes('select')&&h.events.includes('scroll')&&h.events.includes('blur'));
    if(canvas)assert.ok(h.events.indexOf('blur')<h.events.indexOf('dispose-canvas'));assert.equal(h.view.target,null);assert.ok(h.events.includes('cancel-marquee'));
});

test('leaving Canvas for SVG or closing a model also deactivates details before disposing its target',()=>{
    const h=harness(true);vm.runInContext(dispose+'\ndisposeVirtualOverview();',h.context);assert.deepEqual(h.errors,[]);assert.ok(h.events.includes('blur'));assert.ok(h.events.indexOf('blur')<h.events.indexOf('dispose-canvas'));assert.equal(h.view.target,null);
});
