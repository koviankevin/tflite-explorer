import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {customFixture} from './custom-fixture.mjs';
import {MLIR_CFG_LOOP} from './mlir-fixture.mjs';
import {parseModel} from '../src/model-engine.js';
import {parseMLIR} from '../src/mlir-engine.js';
import {validateMLIR} from '../src/mlir-validate.js';
import {modelEditDraft} from '../src/model-edit-draft.js';
import {editWorkspaceSnapshot,exportEditWorkspace} from '../src/model-edit-workspace.js';
import {editFileFingerprint,createEditSession,restoreEditSession,exportEditSession,parseEditSession} from '../src/model-edit-session.js';
import {builtinCatalog,randomTensor,randomTensorInfo,builtinSettings,checkBuiltinPorts} from '../src/tflite-new-ops.js';
import {editTfliteModel} from '../src/tflite-model-edit.js';
const metadata=JSON.parse(await readFile(new URL('../vendor/netron/tflite-metadata.json',import.meta.url))),mm=await readFile(new URL('../vendor/netron/mlir-metadata.json',import.meta.url),'utf8');
const tf=b=>parseModel((o,n)=>b.subarray(o,o+n),b.length,metadata),ml=t=>parseMLIR(new TextEncoder().encode(t),{metadata:mm});
const view={selected:'new:1',zoom:.64,font:32,left:123,top:456},options={updateSignatures:false};
async function fixture(){const f=await customFixture({external:true}),index=await tf(f.bytes),file=new File([f.bytes],'source.tflite');return {...f,index,file,snapshot:editWorkspaceSnapshot(index,{targets:[{graph:0,node:0},{graph:0,node:1},{graph:0,node:2}]})};}

test('portable TFLite draft restores wiring, redo and view using original bytes in a new File',async()=>{
 const f=await fixture(),d=modelEditDraft(f.snapshot);d.apply({kind:'clone',node:'op:0:0',side:'after'});d.apply({kind:'wire',node:'new:1',slot:0,value:'t:0:4'});d.apply({kind:'expose',node:'new:1',enabled:true});d.undo();
 const fingerprint=await editFileFingerprint(f.file),document=await createEditSession(f.file,f.snapshot,{history:d.history,view,options},fingerprint),json=exportEditSession(document);assert.deepEqual(parseEditSession(json),document);assert.ok(json.length<10000&&!json.includes('PRIVATE'));assert.equal(document.history.redo.length,1);
 const fresh=new File([f.bytes],'renamed.tflite'),restored=await restoreEditSession(await tf(f.bytes),fresh,parseEditSession(json),await editFileFingerprint(fresh)),next=modelEditDraft(restored.snapshot,restored.saved.history.commands,restored.saved.history.redo);assert.deepEqual(next.history,d.history);assert.deepEqual(restored.saved.view,view);next.redo();
 const candidate=await exportEditWorkspace(f.index,f.file,restored.snapshot,next.commands),after=await tf(new Uint8Array(await candidate.blob.arrayBuffer()));assert.equal(after.raw.subgraphs[0].operators.length,4);assert.deepEqual([...after.raw.subgraphs[0].outputs],[9,10]);
 const wrong=f.bytes.slice();wrong[wrong.length-1]^=1;const wrongFile=new File([wrong],f.file.name);await assert.rejects(restoreEditSession(f.index,wrongFile,document,await editFileFingerprint(wrongFile)),/指紋/);
 const changed=structuredClone(document);changed.scope.signature='0'.repeat(64);await assert.rejects(restoreEditSession(f.index,f.file,changed,fingerprint),/解析方式/);
 for(const mutate of [x=>x.version=9,x=>x.history.commands.push({kind:'constructor',node:'op:0:0'}),x=>x.source.weights=[1,2],x=>x.history.redo[0].enabled='yes']){const bad=structuredClone(document);mutate(bad);assert.throws(()=>parseEditSession(JSON.stringify(bad)),/格式/);}
});

test('MLIR loop draft restores fresh SSA without expanding its original scope',async()=>{
 const index=await ml(MLIR_CFG_LOOP),file=new File([MLIR_CFG_LOOP],'loop.mlir'),snapshot=editWorkspaceSnapshot(index,{targets:[{graph:1,node:0}]}),d=modelEditDraft(snapshot),base=snapshot.nodes.find(n=>n.cloneable);d.apply({kind:'clone',node:base.id,side:'after'});
 const doc=await createEditSession(file,snapshot,{history:d.history,view,options},await editFileFingerprint(file)),fresh=new File([MLIR_CFG_LOOP],'loop.mlir'),restored=await restoreEditSession(await ml(MLIR_CFG_LOOP),fresh,doc,await editFileFingerprint(fresh));assert.equal(restored.snapshot.nodes.length,snapshot.nodes.length);
 const result=await exportEditWorkspace(index,fresh,restored.snapshot,restored.saved.history.commands),after=await ml(await result.blob.text());assert.deepEqual(validateMLIR(after).diagnostics,[]);assert.equal(after.mlir.graphs.length,index.mlir.graphs.length);
});

test('full-file fingerprint covers every weight byte with bounded, cancellable reads',async()=>{
 const bytes=new Uint8Array(3*1024**2+17);bytes[bytes.length-1]=42;const file=new File([bytes],'large'),slice=file.slice.bind(file);let reads=0,max=0;
 file.arrayBuffer=()=>{throw Error('Whole file read');};file.slice=(a,b)=>{reads++;max=Math.max(max,b-a);return slice(a,b);};const actual=await editFileFingerprint(file),hash=b=>createHash('sha256').update(b).digest();let expected=hash(Buffer.from(`Model Lens file v1:${bytes.length}`));for(let o=0;o<bytes.length;o+=1024**2)expected=hash(Buffer.concat([expected,hash(bytes.subarray(o,o+1024**2))]));assert.equal(actual,expected.toString('hex'));assert.equal(reads,4);assert.ok(max<=1024**2);let cancelled=false;await assert.rejects(editFileFingerprint(file,{cancelled:()=>cancelled,progress:()=>{cancelled=true;}}),/取消/);
});

test('all builtin choices are available; switching ADD to MUL creates the correct code/options',async()=>{
 const list=builtinCatalog(metadata);assert.ok(list.length>=200);assert.ok(list.some(o=>o.name==='MUL'));assert.ok(!list.some(o=>o.name==='CUSTOM'));
 const f=await fixture(),d=modelEditDraft(f.snapshot);d.apply({kind:'clone',node:'op:0:0',side:'after'});d.apply({kind:'builtin',node:'new:1',code:18,version:1,inputCount:2,outputLike:['t:0:4'],settings:{fused_activation_function:0}});d.apply({kind:'random',node:'new:1',slot:1,like:'t:0:5',seed:123,min:-.05,max:.05});d.apply({kind:'expose',node:'new:1',enabled:true});
 const doc=await createEditSession(f.file,f.snapshot,{history:d.history,view,options},await editFileFingerprint(f.file)),restored=await restoreEditSession(f.index,f.file,parseEditSession(exportEditSession(doc)),await editFileFingerprint(f.file)),result=await exportEditWorkspace(f.index,f.file,restored.snapshot,restored.saved.history.commands),bytes=new Uint8Array(await result.blob.arrayBuffer()),after=await tf(bytes),g=after.raw.subgraphs[0],op=g.operators[1];
 assert.equal(after.raw.operator_codes[op.opcode_index].builtin_code,18);assert.equal(op.builtin_options.constructor.name,'MulOptions');assert.equal(op.custom_options.length,0);assert.equal(g.tensors[op.outputs[0]].buffer,0);const constant=g.tensors[op.inputs[1]],buffer=after.raw.buffers[constant.buffer];assert.deepEqual([...bytes.subarray(Number(buffer.offset),Number(buffer.offset+buffer.size))],[...randomTensor(f.index.raw.subgraphs[0].tensors[5],{seed:123,min:-.05,max:.05})]);
 const custom=g.operators[2];assert.deepEqual(bytes.subarray(Number(custom.large_custom_options_offset),Number(custom.large_custom_options_offset+custom.large_custom_options_size)),f.options);const w=after.raw.buffers[3];assert.deepEqual([...bytes.subarray(Number(w.offset),Number(w.offset+w.size))],[...f.weight]);
 const bad=modelEditDraft(f.snapshot);bad.apply({kind:'clone',node:'op:0:0',side:'after'});bad.apply({kind:'builtin',node:'new:1',code:18,version:1,inputCount:1,outputLike:['t:0:4'],settings:{}});await assert.rejects(exportEditWorkspace(f.index,f.file,f.snapshot,bad.commands),/數量|2 個輸入/);
});

test('random tensor validation rejects invalid shape, quantization, range, payload size and inconsistent bytes',async()=>{
 const t={type:0,shape:[2],sparsity:null},spec={seed:123,min:-.05,max:.05};assert.deepEqual(randomTensor(t,spec),randomTensor(t,spec));assert.notDeepEqual(randomTensor(t,spec),randomTensor(t,{...spec,seed:124}));
 for(const tensor of [{...t,shape:[-1]},{...t,shape_signature:[-1]},{...t,shape:[1e9]},{type:9,shape:[2],quantization:{scale:[0],zero_point:['0']}},{type:9,shape:[2],quantization:{scale:[1],zero_point:['999']}}])assert.throws(()=>randomTensorInfo(tensor,{seed:1,min:0,max:1}));
 assert.throws(()=>randomTensorInfo({type:9,shape:[2]},spec),/整數/);assert.throws(()=>builtinSettings(18,{nonsense:1}),/參數/);assert.throws(()=>checkBuiltinPorts(18,[t,{...t,type:9}],[t],{}),/dtype/);assert.throws(()=>checkBuiltinPorts(18,[t,{...t,shape:[3]}],[t],{}),/broadcast/);
 const f=await fixture();assert.throws(()=>editTfliteModel(f.index,f.file,[{graph:0,tensors:[{like:5,name:'bad',data:new Uint8Array(3)}]}]),/資料長度/);
});
