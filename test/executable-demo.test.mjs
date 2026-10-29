import {test} from 'node:test';
import assert from 'node:assert/strict';
import {executableDemoFixture} from './executable-demo-fixture.mjs';
import {fixture} from './fixture.mjs';
import {BinaryReader} from '../vendor/netron/flatbuffers.js';
import {tflite as schema} from '../vendor/netron/tflite-schema.js';
import {runtimePlan} from '../src/tflite-runtime-policy.js';
import {executeRuntime} from '../src/tflite-runtime-execute.js';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {createRequire} from 'node:module';
import vm from 'node:vm';
test('public search demo preserves 26 OPs and supplies executable reshape/permutation parameters',async()=>{
 const demo=await executableDemoFixture(),model=schema.Model.create(BinaryReader.open(demo.data));assert.equal(model.subgraphs.length,2);assert.equal(model.subgraphs.reduce((n,g)=>n+g.operators.length,0),26);
 for(const g of model.subgraphs)for(const op of g.operators){const code=model.operator_codes[op.opcode_index].builtin_code;if(code===22)assert.deepEqual([...op.builtin_options.new_shape],[1,2]);if(code===39){assert.equal(op.inputs.length,2);const t=g.tensors[op.inputs[1]];assert.equal(t.type,2);assert.deepEqual([...t.shape],[2]);assert.deepEqual([...model.buffers[t.buffer].data],[0,0,0,0,1,0,0,0]);}}
 assert.equal(runtimePlan(model,demo.totalBytes).eligible,true);
});
test('old structural-only demo gives the missing operator parameter before starting WASM',()=>{
 const f=fixture({graphCount:2,repeats:4}),bytes=new Uint8Array(f.totalBytes);bytes.set(f.data);const plan=runtimePlan(schema.Model.create(BinaryReader.open(bytes)),bytes.length);assert.equal(plan.eligible,false);assert.match(plan.reason,/subgraph 0.*OP #0.*RESHAPE.*shape/);
});
test('actual CPU executes original and graph-edited demo with zero and random input',async()=>{
 const f=await executableDemoFixture(),base=new URL('../vendor/litert/2.6.0/',import.meta.url),messages=[];
 globalThis.self=globalThis;globalThis.require=createRequire(import.meta.url);globalThis.__dirname=fileURLToPath(base);
 globalThis.importScripts=url=>vm.runInThisContext(readFileSync(new URL(url),'utf8'),{filename:fileURLToPath(url)});
 globalThis.Module={locateFile:name=>fileURLToPath(new URL(name,base)),printErr:s=>messages.push(String(s))};
 const rt=await import('../vendor/litert/2.6.0/core.js');await rt.loadLiteRt(new URL('litert_wasm_compat_internal.js',base).href);
 try{
  const {parseModel}=await import('../src/model-engine.js'),{editWorkspaceSnapshot,exportEditWorkspace}=await import('../src/model-edit-workspace.js'),{modelEditDraft}=await import('../src/model-edit-draft.js');
  const metadata=JSON.parse(readFileSync(new URL('../vendor/netron/tflite-metadata.json',import.meta.url),'utf8')),parse=bytes=>parseModel((o,n)=>bytes.subarray(o,o+n),bytes.length,metadata),index=await parse(f.data),file=new File([f.data],'demo.tflite');
  const snapshot=editWorkspaceSnapshot(index,{targets:[{graph:0,node:0},{graph:0,node:1}]}),draft=modelEditDraft(snapshot);draft.apply({kind:'clone',node:'op:0:0',side:'after'});draft.apply({kind:'wire',node:'op:0:1',slot:0,value:'new:1:out:0'});
  const edited=await exportEditWorkspace(index,file,snapshot,draft.commands),bytes=new Uint8Array(await edited.blob.arrayBuffer()),reopened=await parse(bytes);assert.equal(reopened.raw.subgraphs[0].operators.length,14);
  for(const [blob,model]of [[new Blob([f.data]),index.raw],[edited.blob,reopened.raw]])for(const mode of ['zero','random']){
   const plan=runtimePlan(model,blob.size),result=await executeRuntime({blob,plan,rt,specs:plan.inputs.map(()=>mode==='zero'?{mode}:{mode,seed:123,min:-1,max:1}),diagnostics:()=>messages});assert.equal(result.status,'passed',JSON.stringify(result));assert.equal(result.invoked,true);
  }
 }finally{rt.unloadLiteRt();}
});
