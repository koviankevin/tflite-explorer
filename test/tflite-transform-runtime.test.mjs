import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {readFile} from 'node:fs/promises';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
import vm from 'node:vm';
import {transformFixture as fixture} from './transform-fixture.mjs';
import {editTfliteModel} from '../src/tflite-model-edit.js';
import {exportTflite} from '../src/tflite-export.js';
import {parseModel} from '../src/model-engine.js';
import {runtimePlan} from '../src/tflite-runtime-policy.js';
import {executeRuntime} from '../src/tflite-runtime-execute.js';
import {validateTfliteConstants} from '../src/tflite-constant-checks.js';
import {Archive} from '../vendor/netron/zip.js';
const t=(shape,type=0,extra={})=>({shape,type,...extra});
test('real CPU keeps transform negative axes, duplicate aliases, scalar and quantized edits/cuts valid',async()=>{
 const base=new URL('../vendor/litert/2.6.0/',import.meta.url),messages=[];
 globalThis.self=globalThis;globalThis.require=createRequire(import.meta.url);globalThis.__dirname=fileURLToPath(base);
 globalThis.importScripts=url=>vm.runInThisContext(readFileSync(new URL(url),'utf8'),{filename:fileURLToPath(url)});
 globalThis.Module={locateFile:name=>fileURLToPath(new URL(name,base)),printErr:s=>{messages.push(String(s));if(messages.length>16)messages.shift();}};
 const rt=await import('../vendor/litert/2.6.0/core.js');await rt.loadLiteRt(new URL('litert_wasm_compat_internal.js',base).href);
 const metadata=JSON.parse(await readFile(new URL('../vendor/netron/tflite-metadata.json',import.meta.url),'utf8')),q={scale:Float32Array.of(1),zero_point:BigInt64Array.of(0n),quantized_dimension:0};
 const cases=[
  {label:'concat-positive-axis',name:'CONCATENATION',input:[1,2],expected:[1,2,3,4]},
  {label:'concat-negative-axis-cut',name:'CONCATENATION',spec:{options:{axis:-1}},input:[1,2],expected:[1,2,3,4],cut:true},
  {label:'concat-variadic',name:'CONCATENATION',spec:{inputs:[t([1,2]),t([1,2],0,{values:[3,4]}),t([1,2],0,{values:[5,6]})],output:t([1,6])},input:[1,2],expected:[1,2,3,4,5,6]},
  {label:'concat-int8',name:'CONCATENATION',spec:{inputs:[t([1,2],9,{quantization:q}),t([1,2],9,{values:[3,4],quantization:q})],output:t([1,4],9,{quantization:q}),version:2},input:[1,2],expected:[1,2,3,4],Data:Int8Array},
  {label:'squeeze-implicit',name:'SQUEEZE',input:[1,2],expected:[1,2]},
  {label:'squeeze-negative-duplicates',name:'SQUEEZE',spec:{output:t([1,2]),options:{squeeze_dims:[-1,2,-1]}},input:[1,2],expected:[1,2]},
  {label:'squeeze-aliased-duplicates',name:'SQUEEZE',spec:{output:t([2,1]),options:{squeeze_dims:[0,-3,0]}},input:[1,2],expected:[1,2]},
  {label:'squeeze-scalar-result',name:'SQUEEZE',spec:{inputs:[t([1,1])],output:t([])},input:[7],expected:[7]},
  {label:'squeeze-int8',name:'SQUEEZE',spec:{inputs:[t([1,2,1],9,{quantization:q})],output:t([2],9,{quantization:q})},input:[1,2],expected:[1,2],Data:Int8Array},
  {label:'constant-scalar-concat',name:'CONCATENATION',spec:{inputs:[t([],0,{values:[1]}),t([],0,{values:[2]})],output:t([2]),options:{axis:0}},input:[],expected:[1,2],staticStatus:'not-run'}
 ];
 try{
  for(const c of cases){
   const f=await fixture(c.name,c.spec),op=f.model.subgraphs[0].operators[0],result=c.cut?exportTflite(f.index,0,[0],f.file):editTfliteModel(f.index,f.file,[{graph:0,operators:[{template:0,inputs:Array.from(op.inputs),outputs:Array.from(op.outputs)}]}]);
   const bytes=new Uint8Array(await result.blob.arrayBuffer()),candidate=await parseModel((o,n)=>bytes.subarray(o,o+n),bytes.length,metadata),graph=candidate.raw.subgraphs[0],edited=graph.operators[0];
   assert.deepEqual(edited.builtin_options,op.builtin_options,c.label);assert.equal(candidate.raw.operator_codes[edited.opcode_index].version,f.model.operator_codes[0].version,c.label);
   const proof=validateTfliteConstants(candidate.raw,0,()=>assert.fail('No transform payload reads.'),{budget:0});assert.equal(proof.operators[0].status,c.staticStatus||'passed',c.label);
   const plan=runtimePlan(candidate.raw,bytes.length);assert.equal(plan.eligible,true,c.label+': '+plan.reason);messages.length=0;
   const Data=c.Data||Float32Array,specs=plan.inputs.length?[{mode:'bin',file:new File([Data.from(c.input)],'input.bin')}]:[];
   const r=await executeRuntime({blob:result.blob,plan,rt,specs,diagnostics:()=>messages});assert.equal(r.status,'passed',c.label+': '+JSON.stringify(r));assert.equal(r.invoked,true,c.label);
   const io=r.io.archive instanceof Uint8Array?r.io.archive:new Uint8Array(await r.io.archive.arrayBuffer()),zip=Archive.open(io,'zip'),raw=zip.entries.get('outputs-0.bin').peek().slice();assert.deepEqual(Array.from(new Data(raw.buffer,raw.byteOffset,raw.byteLength/Data.BYTES_PER_ELEMENT)),c.expected,c.label);
  }
  for(const [label,name,spec]of [
   ['concat-axis','CONCATENATION',{options:{axis:2}}],
   ['squeeze-axis','SQUEEZE',{options:{squeeze_dims:[3]}}],
   ['squeeze-nonunit','SQUEEZE',{options:{squeeze_dims:[1]},output:t([1,2])}]
  ]){
   const f=await fixture(name,spec);messages.length=0;const plan=runtimePlan(f.model,f.bytes.length);assert.equal(plan.eligible,true,label);
   const r=await executeRuntime({blob:f.blob,plan,rt,diagnostics:()=>messages});assert.equal(r.status,'failed',label);assert.equal(r.invoked,false,label);assert.equal(r.failureKind,'tensor-allocation',label);assert.ok(messages.length,label);
  }
 }finally{await rt.unloadLiteRt();}
});
