import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
const source=await readFile(new URL('../src/app.js',import.meta.url),'utf8'),start=source.indexOf("$('edit-advanced').onclick="),end=source.indexOf("$('edit-capture').onclick",start);assert.ok(start>0&&end>start);
function click({location={graph:4,node:2},format='tflite',busy=false}={}){
 const button={},calls=[],context={$:()=>button,model:{sourceFormat:format},exportBusy:busy,editWorkspace:{advancedLocation:()=>location},modelEditor:{open:async x=>calls.push(x)},report:e=>{throw e;},detailLocation:{graph:0,node:99}};
 vm.runInNewContext(source.slice(start,end),context);button.onclick();return JSON.parse(JSON.stringify(calls));
}
test('advanced OP parameters use the selected original OP in the workspace, never a stale explorer detail',()=>assert.deepEqual(click(),[[{graph:4,node:2}]]));
test('advanced form cannot open for a changed/new/absent selection or busy export',()=>{assert.deepEqual(click({location:null}),[]);assert.deepEqual(click({busy:true}),[]);});
test('MLIR cannot open actual OP editing through the advanced entry',()=>assert.deepEqual(click({format:'mlir'}),[]));
