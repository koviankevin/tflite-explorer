import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
// Exercise the real app event boundary; the dialog and renderer are separate.
const source=await readFile(new URL('../src/app.js',import.meta.url),'utf8');
const start=source.indexOf("$('open-model-editor').onclick="),end=source.indexOf("$('edit-capture').onclick",start);
const targetsStart=source.indexOf('function editTargets(){'),targetsEnd=source.indexOf("$('edit-advanced').onclick=",targetsStart);
assert.ok(start>=0&&end>start);
function click(overrides={}){
    const {clickId='open-model-editor',...state}=overrides;
    const button={},calls=[],notices=[],elements={'open-model-editor':button,'edit-capture-model':{},'capture-cfg':{checked:false}};
    const context={model:{sourceFormat:'tflite'},exportBusy:false,editWorkspace:{hasUnexported:false,open:()=>{}},detailLocation:null,pickingPattern:true,pickedNodes:new Set([2,3]),pickedGraph:0,selection:null,captureSelections:()=>[],report:reason=>{throw reason;},notice:t=>notices.push(t),$:id=>elements[id],modelEditor:{open:async x=>calls.push(x)},...state};
    vm.runInNewContext(source.slice(targetsStart,targetsEnd)+source.slice(start,end),context);context.$('open-model-editor').click=()=>context.$('open-model-editor').onclick();context.$(clickId).onclick();
    return {calls:JSON.parse(JSON.stringify(calls)),notices};
}
test('multiple selected OPs open the actual editor and never reuse a stale detail OP',()=>{
    for(const detailLocation of [null,{graph:0,node:9}])assert.deepEqual(click({detailLocation}).calls,[[{graph:0,node:2},{graph:0,node:3}]]);
});
test('cross-block selection preserves both source graph and source OP identity',()=>{
    const elements={'open-model-editor':{},'edit-capture-model':{},'capture-cfg':{checked:true}};
    const result=click({$:id=>elements[id],captureSelections:()=>[{graph:1,nodes:[2,3]},{graph:4,nodes:[2]}]});
    assert.deepEqual(result.calls,[[{graph:1,node:2},{graph:1,node:3},{graph:4,node:2}]]);
});
test('single selected OP still opens, absent selection reports why instead of exporting',()=>{
    assert.deepEqual(click({pickedNodes:new Set([4])}).calls,[[{graph:0,node:4}]]);
    const result=click({pickedNodes:new Set()});assert.equal(result.calls.length,0);assert.match(result.notices[0],/點選或框選/);
    assert.equal(click({pickedNodes:new Set(),detailLocation:{graph:0,node:9}}).calls.length,0);
    assert.deepEqual(click({pickingPattern:false,detailLocation:{graph:2,node:5}}).calls,[[{graph:2,node:5}]]);
});
test('contextual model edit button uses the same selected OPs',()=>assert.deepEqual(click({clickId:'edit-capture-model'}).calls,[[{graph:0,node:2},{graph:0,node:3}]]));
test('an unexported graph draft is kept instead of opening a competing form',()=>{let opened=0;const result=click({editWorkspace:{hasUnexported:true,open:()=>opened++}});assert.equal(opened,1);assert.deepEqual(result.calls,[]);});

test('MLIR selections cannot open the actual editor',()=>{const result=click({model:{sourceFormat:'mlir'}});assert.equal(result.calls.length,0);assert.match(result.notices[0],/僅支援 TFLite/);});
