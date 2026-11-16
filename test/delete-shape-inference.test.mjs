import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {deleteInferenceFixture} from './delete-inference-fixture.mjs';
import {parseModel} from '../src/model-engine.js';
import {editWorkspaceSnapshot,exportEditWorkspace} from '../src/model-edit-workspace.js';
import {modelEditDraft,editIssues} from '../src/model-edit-draft.js';
import {previewDeleteInference} from '../src/tflite-delete-inference.js';
import {validateTfliteConstants} from '../src/tflite-constant-checks.js';
import {createEditSession,restoreEditSession,exportEditSession,parseEditSession,editFileFingerprint} from '../src/model-edit-session.js';
const metadata=JSON.parse(await readFile(new URL('../vendor/netron/tflite-metadata.json',import.meta.url),'utf8')),parse=b=>parseModel((o,n)=>b.subarray(o,o+n),b.length,metadata);
async function setup(options={},targets=[0,1,2,3,4]){const f=await deleteInferenceFixture(options),index=await parse(f.bytes),snapshot=editWorkspaceSnapshot(index,{targets:targets.filter(n=>n<f.model.subgraphs[0].operators.length).map(node=>({graph:0,node})),includeNeighbours:false}),draft=modelEditDraft(snapshot);return {...f,index,snapshot,draft};}
const preview=f=>previewDeleteInference(f.index,f.snapshot,f.draft.commands,'op:0:0',(o,n)=>f.bytes.subarray(o,o+n));
async function output(f){const result=await exportEditWorkspace(f.index,f.file,f.snapshot,f.draft.commands),bytes=new Uint8Array(await result.blob.arrayBuffer()),index=await parse(bytes);validateTfliteConstants(index.raw,0,(o,n)=>bytes.subarray(o,o+n));return {result,index,bytes};}

test('automatic bypass propagates shape through branches and merge, then exports and reopens',async()=>{
    const f=await setup(),p=await preview(f);assert.equal(p.source.value,'t:0:0');assert.equal(p.summary.operators,4);assert.equal(p.summary.tensors,4);assert.ok(p.command.localShapes.length);
    f.draft.apply(p.command);assert.deepEqual(editIssues(f.draft.state),[]);const {index,result}=await output(f),g=index.raw.subgraphs[0];assert.equal(g.operators.length,4);assert.deepEqual([...g.operators[0].inputs],[0]);assert.deepEqual([...g.tensors[g.outputs[0]].shape],[2,3]);assert.equal(result.shapeInference.tensors,4);
    f.draft.undo();assert.deepEqual(JSON.parse(f.draft.state.values.get('t:0:3').signature).shape,[3,2]);f.draft.redo();assert.deepEqual(JSON.parse(f.draft.state.values.get('t:0:3').signature).shape,[2,3]);
});

test('global shape inference covers consumers outside the bounded editor scope',async()=>{
    const f=await setup({kind:'split'},[0]),p=await preview(f);assert.equal(p.summary.tensors,3);f.draft.apply(p.command);const {index}=await output(f),g=index.raw.subgraphs[0];assert.equal(g.operators.length,2);assert.deepEqual([...g.tensors[g.outputs[0]].shape],[1,4]);assert.deepEqual([...g.operators[0].inputs],[3,0]);
});

test('RESHAPE and TRANSPOSE read bounded real shape operands and preserve their bytes',async()=>{
    const f=await setup({kind:'reshape'}),p=await preview(f);assert.equal(p.summary.inspectedBytes,16);f.draft.apply(p.command);const {index,bytes}=await output(f),g=index.raw.subgraphs[0];assert.deepEqual([...g.tensors[g.operators[0].outputs[0]].shape],[6,1]);assert.deepEqual([...g.tensors[g.outputs[0]].shape],[3,2]);
    for(const id of g.operators.flatMap(op=>[...op.inputs].slice(1))){const t=g.tensors[id];if(t.type!==2)continue;const b=index.raw.buffers[t.buffer],actual=bytes.slice(Number(b.offset),Number(b.offset+b.size)),before=f.model.buffers[t.buffer].data;assert.deepEqual(actual,before);}
});

test('incompatible FC weights and unknown custom rules stop with the responsible OP without changing the draft',async()=>{
    for(const [kind,reason]of [['fc',/FULLY_CONNECTED.*weights input_size 2/],['custom',/company.opaque.*custom OP/]]){const f=await setup({kind});await assert.rejects(preview(f),reason);assert.equal(f.draft.commands.length,0);}
});

test('v5 draft restores inferred metadata and export rejects tampered shape hints',async()=>{
    const f=await setup();f.draft.apply((await preview(f)).command);const fingerprint=await editFileFingerprint(f.file),document=await createEditSession(f.file,f.snapshot,{history:f.draft.history,view:{selected:'op:0:0',zoom:.5,font:32,left:0,top:0},options:{updateSignatures:false}},fingerprint);assert.equal(document.version,5);
    const restored=await restoreEditSession(f.index,f.file,parseEditSession(exportEditSession(document)),fingerprint);assert.equal(restored.saved.version,5);
    const forged=f.draft.commands;forged[0].localShapes[0].shape=[6];await assert.rejects(exportEditWorkspace(f.index,f.file,f.snapshot,forged),/重新推導結果不符/);
    const stale={...document,version:4};assert.throws(()=>parseEditSession(JSON.stringify(stale)),/版本/);
});

test('composition preserves inferred dimensions in v5 draft and exported model',async()=>{
    const f=await setup();f.snapshot=editWorkspaceSnapshot(f.index,{targets:[0,1,2,3,4].map(node=>({graph:0,node})),composition:true});f.draft=modelEditDraft(f.snapshot);f.draft.apply({kind:'import',node:'op:0:0',nodes:[0,1,2,3,4].map(n=>`op:0:${n}`),label:'branch'});f.draft.apply((await preview(f)).command);
    const {index}=await output(f),g=index.raw.subgraphs[0];assert.equal(g.operators.length,4);assert.deepEqual([...g.tensors[g.outputs[0]].shape],[2,3]);
    const fingerprint=await editFileFingerprint(f.file),document=await createEditSession(f.file,f.snapshot,{history:f.draft.history,view:{selected:'op:0:0',zoom:.5,font:32,left:0,top:0},options:{updateSignatures:false}},fingerprint);assert.equal(document.version,5);assert.equal((await restoreEditSession(f.index,f.file,document,fingerprint)).saved.scope.composition,true);
});

test('21,000-OP propagation keeps the preview bounded and exports all inferred dimensions',async()=>{
    const f=await setup({tail:21000},[0]),p=await preview(f);assert.equal(p.summary.tensors,21004);assert.equal(p.summary.changes.length,100);assert.equal(p.summary.truncated,true);assert.equal(p.summary.inspectedBytes,0);
    f.draft.apply(p.command);f.file.arrayBuffer=()=>{throw Error('Whole model reads forbidden.');};const {index}=await output(f),g=index.raw.subgraphs[0];assert.equal(g.operators.length,21004);assert.deepEqual([...g.tensors[g.outputs[0]].shape],[2,3]);
});

test('repeated automatic deletions retain trusted inferred shapes through undo, redo and export',async()=>{
    const f=await setup();f.draft.apply((await preview(f)).command);
    const second=await previewDeleteInference(f.index,f.snapshot,f.draft.commands,'op:0:1',(o,n)=>f.bytes.subarray(o,o+n));f.draft.apply(second.command);
    const {index}=await output(f),g=index.raw.subgraphs[0];assert.equal(g.operators.length,3);assert.deepEqual([...g.tensors[g.outputs[0]].shape],[2,3]);
    f.draft.undo();assert.equal((await output(f)).index.raw.subgraphs[0].operators.length,4);f.draft.redo();assert.equal((await output(f)).index.raw.subgraphs[0].operators.length,3);
});

test('dynamic shape, per-axis channel mismatch and cancelled inference fail without modifying the draft',async()=>{
    const dynamic=await setup();dynamic.index.raw.subgraphs[0].tensors[3].shape_signature=Int32Array.of(-1,2);await assert.rejects(preview(dynamic),/動態|未知/);assert.equal(dynamic.draft.commands.length,0);
    const quant=await setup();quant.index.raw.subgraphs[0].tensors[3].quantization={scale:Float32Array.of(1,1),zero_point:BigInt64Array.of(0n,0n),quantized_dimension:1};await assert.rejects(preview(quant),/per-axis/);assert.equal(quant.draft.commands.length,0);
    const cancelled=await setup({tail:600},[0]);await assert.rejects(previewDeleteInference(cancelled.index,cancelled.snapshot,[], 'op:0:0',(o,n)=>cancelled.bytes.subarray(o,o+n),{cancelled:()=>true}),/取消/);assert.equal(cancelled.draft.commands.length,0);
});
