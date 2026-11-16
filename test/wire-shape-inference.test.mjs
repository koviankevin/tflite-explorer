import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {deleteInferenceFixture} from './delete-inference-fixture.mjs';
import {parseModel} from '../src/model-engine.js';
import {editWorkspaceSnapshot,exportEditWorkspace} from '../src/model-edit-workspace.js';
import {modelEditDraft,editIssues,editWireReason} from '../src/model-edit-draft.js';
import {previewWireInference} from '../src/tflite-delete-inference.js';
import {createEditSession,restoreEditSession,editFileFingerprint,parseEditSession} from '../src/model-edit-session.js';
import {nextEditRecovery,readEditRecovery} from '../src/edit-recovery-store.js';
const metadata=JSON.parse(await readFile(new URL('../vendor/netron/tflite-metadata.json',import.meta.url),'utf8')),parse=b=>parseModel((o,n)=>b.subarray(o,o+n),b.length,metadata);
async function setup(kind='branch',targets=[0,1,2,3,4]){const f=await deleteInferenceFixture({kind}),index=await parse(f.bytes),snapshot=editWorkspaceSnapshot(index,{targets:targets.filter(n=>n<f.model.subgraphs[0].operators.length).map(node=>({graph:0,node})),includeNeighbours:false}),draft=modelEditDraft(snapshot);return {...f,index,snapshot,draft};}
const preview=(f,value='t:0:0')=>previewWireInference(f.index,f.snapshot,f.draft.commands,'op:0:1',0,value,(o,n)=>f.bytes.subarray(o,o+n));
async function output(f){const r=await exportEditWorkspace(f.index,f.file,f.snapshot,f.draft.commands),bytes=new Uint8Array(await r.blob.arrayBuffer());return parse(bytes);}
test('shape-mismatched wire previews without mutation, then atomically propagates branch and merge, undo/redo and export',async()=>{
    const f=await setup();assert.ok(editWireReason(f.draft.state,'op:0:1',0,'t:0:0'));const p=await preview(f);assert.equal(p.summary.tensors,4);assert.equal(f.draft.commands.length,0);
    f.draft.apply(p.command);assert.deepEqual(editIssues(f.draft.state),[]);let g=(await output(f)).raw.subgraphs[0];assert.equal(g.operators.length,5);assert.deepEqual([...g.operators[1].inputs],[0]);assert.deepEqual([...g.tensors[g.outputs[0]].shape],[2,3]);
    f.draft.undo();assert.equal(f.draft.state.nodes[1].inputs[0].value,'t:0:2');f.draft.redo();assert.equal(f.draft.state.nodes[1].inputs[0].value,'t:0:0');
    f.draft.apply((await preview(f,'t:0:2')).command);assert.deepEqual(JSON.parse(f.draft.state.values.get('t:0:6').signature).shape,[3,2]);await assert.rejects(output(f),/沒有變更/);
});
test('wire inference covers out-of-scope consumers and rejects weights, unknown custom, dtype and cycles',async()=>{
    const f=await setup('branch',[0,1]);f.draft.apply((await preview(f)).command);const g=(await output(f)).raw.subgraphs[0];assert.deepEqual([...g.tensors[g.outputs[0]].shape],[2,3]);
    for(const [kind,reason]of [['fc',/weights input_size/],['custom',/custom OP/]]){const f=await setup(kind);await assert.rejects(preview(f),reason);assert.equal(f.draft.commands.length,0);}
    const bad=await setup();await assert.rejects(preview(bad,'t:0:1'),/dtype/);await assert.rejects(preview(bad,'t:0:5'),/來源必須|回圈/);
});
test('v6 portable and local recovery preserve inferred wire, old schema and forged shapes fail closed',async()=>{
    const f=await setup();f.draft.apply((await preview(f)).command);const fingerprint=await editFileFingerprint(f.file),document=await createEditSession(f.file,f.snapshot,{history:f.draft.history,view:{selected:'op:0:1',zoom:.5,font:32,left:0,top:0},options:{updateSignatures:false}},fingerprint);assert.equal(document.version,6);
    assert.equal((await restoreEditSession(f.index,f.file,document,fingerprint)).saved.version,6);const record=nextEditRecovery(null,{key:'a'.repeat(32),owner:'b'.repeat(32),revision:0,document});assert.equal(readEditRecovery(record).document.version,6);
    assert.throws(()=>parseEditSession(JSON.stringify({...document,version:5})),/版本/);const forged=f.draft.commands;forged[0].localShapes[0].shape=[6];await assert.rejects(exportEditWorkspace(f.index,f.file,f.snapshot,forged),/重新推導結果不符/);
});
