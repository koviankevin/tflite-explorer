import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile,writeFile,mkdir,mkdtemp} from 'node:fs/promises';
import path from 'node:path';
import {parseModel} from '../src/model-engine.js';
import {editWorkspaceSnapshot,exportEditWorkspace} from '../src/model-edit-workspace.js';
import {modelEditDraft} from '../src/model-edit-draft.js';
import {compositionInterface} from '../src/model-composition-draft.js';
import {compositionFixture} from './composition-fixture.mjs';
import {createEditSession,exportEditSession,parseEditSession,restoreEditSession,editFileFingerprint} from '../src/model-edit-session.js';
import {nextEditRecovery,readEditRecovery} from '../src/edit-recovery-store.js';
import {createModelEditReport} from '../src/model-edit-report.js';
import {verifyExportFiles} from '../scripts/verify-export.mjs';
import {controlFixture} from './tflite-control-fixture.mjs';
const metadata=JSON.parse(await readFile(new URL('../vendor/netron/tflite-metadata.json',import.meta.url),'utf8')),parse=b=>parseModel((o,n)=>b.subarray(o,o+n),b.length,metadata),pool=[0,1].map(node=>({graph:0,node}));
async function setup(options){const f=await compositionFixture(options),index=await parse(f.bytes),snapshot=editWorkspaceSnapshot(index,{targets:pool,composition:true}),draft=modelEditDraft(snapshot);return {...f,index,snapshot,draft};}
const add=(d,n,label)=>d.apply({kind:'import',node:`op:0:${n}`,nodes:[`op:0:${n}`],label});
test('composition adds A and B as replayable groups, deduplicates overlaps and undoes imports without losing prior wiring',async()=>{
 const {draft}=await setup();assert.equal(draft.state.nodes.length,0);add(draft,0,'A');draft.apply({kind:'clone',node:'op:0:0',side:'after'});const before=draft.commands;add(draft,1,'B');assert.equal(draft.state.nodes.length,3);draft.undo();assert.deepEqual(draft.commands,before);draft.redo();assert.equal(draft.state.nodes.length,3);add(draft,0,'overlap');assert.equal(draft.state.nodes.length,3);assert.deepEqual(draft.state.nodes.find(n=>n.id==='op:0:0').groups,[1,3]);
});
test('composition allows dependencies independent of original OP positions, but blocks cycles transactionally',async()=>{
 const {draft}=await setup();add(draft,0,'A');add(draft,1,'B');draft.apply({kind:'wire',node:'op:0:0',slot:0,value:'t:0:3'});assert.deepEqual(draft.state.nodes.map(n=>n.id),['op:0:1','op:0:0']);const before=draft.commands;assert.throws(()=>draft.apply({kind:'wire',node:'op:0:1',slot:0,value:'t:0:2'}),/循環/);assert.deepEqual(draft.commands,before);
});
test('composition exports only active fragments and new fusion OP, compacting unused builtin weights and preserving the source',async()=>{
 const {index,file,snapshot,draft,bytes}=await setup();add(draft,0,'A');add(draft,1,'B');draft.apply({kind:'clone',node:'op:0:0',side:'after'});for(const [slot,value]of [[0,'t:0:2'],[1,'t:0:3']])draft.apply({kind:'wire',node:'new:1',slot,value});
 assert.deepEqual(compositionInterface(draft.state).inputs,['t:0:0']);assert.deepEqual(compositionInterface(draft.state).outputs,['new:1:out:0']);
 file.arrayBuffer=()=>{throw Error('Whole model read');};const result=await exportEditWorkspace(index,file,snapshot,draft.commands),out=await parse(new Uint8Array(await result.blob.arrayBuffer())),g=out.raw.subgraphs[0];assert.equal(g.operators.length,3);assert.equal(out.raw.subgraphs.length,1);assert.equal(g.tensors.length,5);assert.equal(out.raw.buffers.length,2);assert.equal(g.inputs.length,1);assert.equal(g.outputs.length,1);assert.equal(index.raw.subgraphs[0].operators.length,4);assert.deepEqual([...index.raw.subgraphs[0].outputs],[4]);assert.equal(bytes.length,file.size);assert.ok(!g.tensors.some(t=>t.name==='old_final'||t.name==='unrelated_result'));
});
test('composition interface deselection reports missing required inputs rather than silently altering them',async()=>{
 const {index,file,snapshot,draft}=await setup();add(draft,0,'A');draft.apply({kind:'interface',node:'op:0:0',value:'t:0:0',side:'inputs',enabled:false});assert.deepEqual(compositionInterface(draft.state).missing,['t:0:0']);await assert.rejects(exportEditWorkspace(index,file,snapshot,draft.commands),/輸入/);
});
test('composition draft v2 restores groups, wiring, interface and redo after original-file verification',async()=>{
 const {index,file,snapshot,draft,bytes}=await setup();add(draft,0,'A');add(draft,1,'B');draft.apply({kind:'clone',node:'op:0:0',side:'after'});draft.apply({kind:'wire',node:'new:1',slot:0,value:'t:0:3'});draft.undo();
 const fp=await editFileFingerprint(file),view={selected:'op:0:0',zoom:1,font:32,left:0,top:0},options={updateSignatures:false},document=await createEditSession(file,snapshot,{history:draft.history,view,options},fp);assert.equal(document.version,2);assert.equal(document.scope.composition,true);
 const restored=await restoreEditSession(index,new File([bytes],'renamed.tflite'),parseEditSession(exportEditSession(document)),fp),replayed=modelEditDraft(restored.snapshot,restored.saved.history.commands,restored.saved.history.redo);assert.deepEqual(replayed.state.groups,draft.state.groups);replayed.redo();assert.equal(replayed.state.nodes.find(n=>n.id==='new:1').inputs[0].value,'t:0:3');
 const old={...document,version:1};assert.throws(()=>parseEditSession(JSON.stringify(old)));await assert.rejects(restoreEditSession(index,file,document,'0'.repeat(64)),/指紋/);
 const record=nextEditRecovery(null,{key:'a'.repeat(32),revision:0,owner:'b'.repeat(32),document});assert.equal(readEditRecovery(record).document.version,2);assert.equal(readEditRecovery(record).document.scope.composition,true);
});
test('custom composition keeps opaque options, weight bytes and original tensor/buffer IDs',async()=>{
 const {index,file,snapshot,draft}=await setup({custom:true});add(draft,0,'A');add(draft,1,'B');const result=await exportEditWorkspace(index,file,snapshot,draft.commands),bytes=new Uint8Array(await result.blob.arrayBuffer()),out=await parse(bytes),g=out.raw.subgraphs[0];assert.equal(result.preservedIds,true);assert.equal(g.tensors.length,index.raw.subgraphs[0].tensors.length);assert.equal(out.raw.buffers.length,index.raw.buffers.length);assert.deepEqual([...g.operators[1].inputs],[0,1]);assert.deepEqual([...g.operators[1].outputs],[3]);const options=g.operators[1].custom_options;assert.deepEqual([...options],[0,1,1,2,3,5,8]);const b=out.raw.buffers[1];assert.deepEqual([...bytes.subarray(Number(b.offset),Number(b.offset+b.size))],[...new Uint8Array(Float32Array.of(3,4).buffer)]);
});
test('composition report independently verifies exact original weight/options ranges after compact or custom export',async()=>{
 await mkdir('test-results',{recursive:true});const dir=await mkdtemp('test-results/composition-report-');
 for(const custom of [false,true]){const {index,file,snapshot,draft,bytes}=await setup({custom});add(draft,0,'A');add(draft,1,'B');const result=await exportEditWorkspace(index,file,snapshot,draft.commands),out=await parse(new Uint8Array(await result.blob.arrayBuffer())),receipt=createModelEditReport(index,file,result,out,{graph:0,node:0,mode:'workspace',workspaceTargets:pool},{outputName:'composed.tflite'}),stem=path.join(dir,custom?'custom':'builtin');await writeFile(stem+'.source',bytes);await writeFile(stem+'.out',new Uint8Array(await result.blob.arrayBuffer()));await writeFile(stem+'.json',await receipt.blob.text());assert.equal((await verifyExportFiles({report:JSON.parse(await receipt.blob.text()),source:stem+'.source',output:stem+'.out'})).byteComparison.status,'passed');}
});
test('composition refuses mixed subgraphs and control-flow/stateful selections before creating a draft',async()=>{
 const f=await controlFixture(),index=await parse(f.bytes);assert.throws(()=>editWorkspaceSnapshot(index,{targets:[{graph:0,node:0},{graph:1,node:0}],composition:true}),/同一個/);assert.throws(()=>editWorkspaceSnapshot(index,{targets:[{graph:0,node:0}],composition:true}),/控制流程|狀態/);
});
