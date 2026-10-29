import {test} from 'node:test';
import assert from 'node:assert/strict';
import {rectangleSelection} from '../src/rectangle-selection.js';
import {updateLayerSelection} from '../src/pattern-selection.js';

function fixture() {
    const doc=new EventTarget(),children=[],commits=[];let reads=0;
    doc.defaultView=new EventTarget();doc.body={append:node=>children.push(node)};
    const element=rect=>Object.assign(new EventTarget(),{ownerDocument:doc,style:{},classList:{toggle(){},remove(){}},clientLeft:0,clientTop:0,clientWidth:500,clientHeight:400,
        getBoundingClientRect(){reads++;return rect;},setPointerCapture(){},hasPointerCapture(){return false;},remove(){children.splice(children.indexOf(this),1);},setAttribute(){},append(node){this.firstChild=node;}});
    doc.createElement=()=>element({});
    const target=element({left:100,top:100,right:600,bottom:500}),node=element({left:150,top:150,right:200,bottom:200});
    const controller=rectangleSelection(target,{enabled:()=>true,candidates:()=>[{element:node,location:{graph:2,node:0}}],commit:locations=>commits.push(locations)});
    const fire=(on,type,options={})=>{
        const e=new Event(type,{cancelable:true});Object.assign(e,{pointerId:1,pointerType:'mouse',button:0,clientX:120,clientY:120,...options});on.dispatchEvent(e);return e;
    };
    const start=()=>{fire(target,'pointerdown');fire(doc,'pointermove',{clientX:250,clientY:250});};
    return {doc,target,children,commits,controller,fire,start,reads:()=>reads};
}

test('mouse drag commits original locations and swallows its generated click without breaking the next click',()=>{
    const f=fixture();let clicks=0;f.target.addEventListener('click',()=>clicks++);
    f.start();assert.equal(f.children.length,1);
    for(let n=0;n<10;n++)f.fire(f.doc,'pointermove',{clientX:260+n,clientY:260+n});
    assert.equal(f.reads(),2,'read viewport and node geometry once per gesture');
    f.fire(f.doc,'pointerup',{clientX:250,clientY:250});
    assert.deepEqual(f.commits,[[{graph:2,node:0}]]);assert.equal(f.children.length,0);
    f.fire(f.target,'click',{detail:1});assert.equal(clicks,0);
    f.fire(f.target,'pointerdown');f.fire(f.doc,'pointerup');f.fire(f.target,'click',{detail:1});assert.equal(clicks,1);
});

for(const action of ['Escape','pointercancel','scroll','blur','redraw'])test(`unfinished rectangle is removed without committing on ${action}`,()=>{
    const f=fixture();f.start();
    if(action==='Escape')assert.equal(f.fire(f.doc,'keydown',{key:'Escape'}).defaultPrevented,true);
    else if(action==='pointercancel')f.fire(f.doc,'pointercancel');
    else if(action==='scroll')f.fire(f.target,'scroll');
    else if(action==='blur')f.fire(f.doc.defaultView,'blur');
    else f.controller.cancel();
    f.fire(f.doc,'pointerup',{clientX:250,clientY:250});assert.equal(f.children.length,0);assert.deepEqual(f.commits,[]);
});

test('Alt-drag, touch and scrollbar gestures remain available to the existing graph handler',()=>{
    for(const options of [{altKey:true},{pointerType:'touch'},{clientX:600},{button:2}]) {
        const f=fixture();assert.equal(f.fire(f.target,'pointerdown',options).defaultPrevented,false);
        f.fire(f.doc,'pointermove',{clientX:250,clientY:250});f.fire(f.doc,'pointerup');assert.equal(f.children.length,0);assert.deepEqual(f.commits,[]);
    }
});

test('a rectangle toggles once at release; repeated moves, reversals and cancellation never flip the live selection',()=>{
    const f=fixture(),selection=new Map([[2,new Set([0,9])]]);
    const apply=()=>updateLayerSelection(selection,f.commits.at(-1),{toggle:true});
    f.start();for(let i=0;i<15;i++)f.fire(f.doc,'pointermove',{clientX:260,clientY:260});
    assert.deepEqual([...selection.get(2)],[0,9]);assert.equal(f.commits.length,0);
    f.fire(f.doc,'pointermove',{clientX:125,clientY:125});f.fire(f.doc,'pointermove',{clientX:250,clientY:250});
    f.fire(f.doc,'pointerup',{clientX:250,clientY:250});apply();assert.deepEqual([...selection.get(2)],[9]);
    f.start();f.fire(f.doc,'pointerup',{clientX:250,clientY:250});apply();assert.deepEqual([...selection.get(2)],[9,0]);
    f.start();f.controller.cancel();assert.equal(f.commits.length,2);assert.deepEqual([...selection.get(2)],[9,0]);
});
