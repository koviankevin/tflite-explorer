import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {inferTfliteOutputs} from '../src/tflite-shape-inference.js';
import {checkBuiltinPorts} from '../src/tflite-new-ops.js';
import {tflite as s} from '../vendor/netron/tflite-schema.js';
import {runtimeFixture} from './runtime-fixture.mjs';
import {parseModel} from '../src/model-engine.js';
import {editWorkspaceSnapshot,exportEditWorkspace} from '../src/model-edit-workspace.js';
import {modelEditDraft} from '../src/model-edit-draft.js';
import {createEditSession,restoreEditSession,editFileFingerprint,exportEditSession,parseEditSession} from '../src/model-edit-session.js';
const tensor=shape=>({shape,type:0}),infer=(name,inputs,settings={})=>inferTfliteOutputs(name,inputs.map(tensor),[tensor([99])],settings);
test('shape inference handles broadcasting, scalar/empty tensors, unary, squeeze and static reshape',()=>{
    assert.deepEqual(infer('ADD',[[2,1],[1,3]]).shapes,[[2,3]]);assert.deepEqual(infer('MUL',[[0,3],[1,3]]).shapes,[[0,3]]);assert.deepEqual(infer('ABS',[[]]).shapes,[[]]);
    assert.deepEqual(infer('SQUEEZE',[[1,2,1]],{squeeze_dims:[-1]}).shapes,[[1,2]]);assert.deepEqual(infer('RESHAPE',[[2,3]],{new_shape:[3,-1]}).shapes,[[3,2]]);
    assert.doesNotThrow(()=>checkBuiltinPorts(s.BuiltinOperator.ADD,[tensor([0,3]),tensor([1,3])],[tensor([0,3])],{}));
});
test('shape inference refuses unknown data, invalid axes, ambiguous reshape and per-axis quantization changes',()=>{
    for(const v of [infer('TRANSPOSE',[[2,3]]),infer('ADD',[[2,3],[2,4]]),infer('SQUEEZE',[[2,3]],{squeeze_dims:[0]}),infer('RESHAPE',[[0,3]],{new_shape:[0,-1]})])assert.equal(v.status,'manual');
    assert.equal(inferTfliteOutputs('RELU',[{...tensor([2]),shape_signature:[-1]}],[tensor([2])]).status,'manual');
    assert.equal(inferTfliteOutputs('RELU',[tensor([3])],[{...tensor([2]),quantization:{scale:[.1,.2],quantized_dimension:0}}]).status,'manual');
});
test('inferred tensors survive draft replay, rewiring, undo/redo and actual export/reopen',async()=>{
    const metadata=JSON.parse(await readFile(new URL('../vendor/netron/tflite-metadata.json',import.meta.url))),parse=b=>parseModel((o,n)=>b.subarray(o,o+n),b.length,metadata);
    const f=await runtimeFixture({inputShapes:[[2,1],[1,3]],outputShape:[2,3]}),index=await parse(f.bytes),snapshot=editWorkspaceSnapshot(index,{targets:[{graph:0,node:0}]}),draft=modelEditDraft(snapshot);
    draft.apply({kind:'clone',node:'op:0:0',side:'after'});draft.apply({kind:'builtin',node:'new:1',code:s.BuiltinOperator.ADD,version:1,inputCount:2,outputLike:['t:0:0'],settings:{},inferOutputs:true});
    assert.deepEqual(draft.state.values.get('new:1:out:0').inferredShape,[2,3]);draft.undo();draft.redo();assert.deepEqual(draft.state.values.get('new:1:out:0').inferredShape,[2,3]);
    draft.apply({kind:'wire',node:'new:1',slot:1,value:'t:0:0'});assert.deepEqual(draft.state.values.get('new:1:out:0').inferredShape,[2,1]);draft.undo();draft.apply({kind:'expose',node:'new:1',enabled:true});
    const result=await exportEditWorkspace(index,f.file,snapshot,draft.commands),reopened=await parse(new Uint8Array(await result.blob.arrayBuffer()));assert.deepEqual([...reopened.raw.subgraphs[0].tensors[3].shape],[2,3]);assert.deepEqual([...reopened.raw.subgraphs[0].outputs],[2,3]);assert.deepEqual([...index.raw.subgraphs[0].tensors[0].shape],[2,1]);
    const fingerprint=await editFileFingerprint(f.file),session=await createEditSession(f.file,snapshot,{history:draft.history,view:{selected:'new:1',zoom:1,font:32,left:0,top:0},options:{updateSignatures:false}},fingerprint),restored=await restoreEditSession(index,f.file,parseEditSession(exportEditSession(session)),fingerprint);assert.equal(restored.saved.history.commands.find(c=>c.kind==='builtin').inferOutputs,true);assert.deepEqual(modelEditDraft(restored.snapshot,restored.saved.history.commands).state.values.get('new:1:out:0').inferredShape,[2,3]);
});
