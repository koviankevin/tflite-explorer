import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {spatialFixture} from './spatial-fixture.mjs';
import {FlatbufferWriter} from '../src/flatbuffer-writer.js';
import {parseModel} from '../src/model-engine.js';
import {prepareTfliteModelEdit,editTfliteModel} from '../src/tflite-model-edit.js';
import {validateTfliteConstants} from '../src/tflite-constant-checks.js';
import {createModelEditReport} from '../src/model-edit-report.js';
import {checkOperatorMetadata} from '../src/tflite-semantic-checks.js';
const metadata=JSON.parse(await readFile(new URL('../vendor/netron/tflite-metadata.json',import.meta.url),'utf8'));
const dynamic=g=>{g.tensors[0].shape_signature=Int32Array.of(-1,3,3,1);};
async function fixture(name,mutate=()=>{}){
 const f=spatialFixture(name);mutate(f.model.subgraphs[0]);
 const blob=new FlatbufferWriter().finish(f.model,new Blob()),bytes=new Uint8Array(await blob.arrayBuffer()),file=new File([blob],name+'.tflite');
 const index=await parseModel((o,n)=>bytes.subarray(o,o+n),bytes.length,metadata),op=index.raw.subgraphs[0].operators[0];
 return {index,file,bytes,plan:[{graph:0,operators:[{template:0,inputs:Array.from(op.inputs),outputs:Array.from(op.outputs)}]}]};
}
for(const [label,name,mutate,error]of [
 ['filter rank','CONV_2D',g=>{dynamic(g);g.tensors[1].shape=Int32Array.of(1,2,2);},/filter.*四維|filter.*rank/],
 ['input rank','CONV_2D',g=>{g.tensors[0].shape=Int32Array.of(3,3,1);g.tensors[0].shape_signature=Int32Array.of(-1,3,1);},/input.*四維|input.*rank/],
 ['bias dtype','DEPTHWISE_CONV_2D',g=>{dynamic(g);g.tensors[2].type=2;},/bias.*dtype/],
 ['output rank','AVERAGE_POOL_2D',g=>{dynamic(g);g.tensors[1].shape=Int32Array.of(2,2,1);g.tensors[1].shape_signature=Int32Array.of(-1,2,1);},/output.*四維|output.*rank/],
 ['bias element count','CONV_2D',g=>{dynamic(g);g.tensors[2].shape=Int32Array.of(2);},/bias.*元素數/],
 ['depthwise bias rank','DEPTHWISE_CONV_2D',g=>{dynamic(g);g.tensors[2].shape=Int32Array.of(1,1);},/bias.*rank/],
 ['depthwise filter leading dimension','DEPTHWISE_CONV_2D',g=>{dynamic(g);g.tensors[1].shape=Int32Array.of(2,1,2,1);},/filter.*\[1/],
 ['known filter zero','CONV_2D',g=>{dynamic(g);g.tensors[1].shape=Int32Array.of(1,0,2,1);},/filter.*大於 0/],
 ['padding enum','MAX_POOL_2D',g=>{dynamic(g);g.operators[0].builtin_options.padding=99;},/padding/]
]){
 test(`actual spatial edit rejects known ${label} despite dynamic extents`,async()=>{
  const f=await fixture(name,mutate);
  assert.throws(()=>prepareTfliteModelEdit(f.index,f.file,f.plan),e=>/Subgraph #0.*OP #0/.test(e.message)&&error.test(e.message));
 });
 test(`serialized spatial report rejects known ${label} without weight reads`,async()=>{
  const f=await fixture(name,mutate);
  assert.throws(()=>validateTfliteConstants(f.index.raw,0,()=>assert.fail('Metadata rules must not read weights.')),e=>/Subgraph #0.*OP #0/.test(e.message)&&error.test(e.message));
 });
}
test('legal dynamic spatial edits retain signatures and explicit unverified report status',async()=>{
 for(const name of ['CONV_2D','DEPTHWISE_CONV_2D','AVERAGE_POOL_2D','MAX_POOL_2D','L2_POOL_2D']){
  const f=await fixture(name,dynamic),edited=editTfliteModel(f.index,f.file,f.plan),bytes=new Uint8Array(await edited.blob.arrayBuffer()),reopened=await parseModel((o,n)=>bytes.subarray(o,o+n),bytes.length,metadata);
  assert.deepEqual(reopened.raw.subgraphs[0].tensors[0].shape_signature,Int32Array.of(-1,3,3,1));
  for(const [id,b]of f.index.raw.buffers.entries())if(b.size){const a=reopened.raw.buffers[id];assert.equal(a.size,b.size);assert.deepEqual(bytes.subarray(Number(a.offset),Number(a.offset+a.size)),f.bytes.subarray(Number(b.offset),Number(b.offset+b.size)));}
  const proof=validateTfliteConstants(reopened.raw,0,()=>assert.fail('No weight reads.'),{budget:0});
  assert.equal(proof.checked,0);assert.equal(proof.unchecked,1);assert.equal(proof.operators[0].status,'not-run');assert.match(proof.operators[0].reason,/動態|未知/);assert.equal(proof.bytesRead,0);assert.equal(proof.inspectedBytes,0);
 }
});
test('static spatial metadata reports its bounded checks without running interpreter',async()=>{
 for(const name of ['CONV_2D','DEPTHWISE_CONV_2D','AVERAGE_POOL_2D','MAX_POOL_2D','L2_POOL_2D']){
  const f=await fixture(name),proof=validateTfliteConstants(f.index.raw,0,()=>assert.fail('No weight reads.'),{budget:0});
  assert.equal(proof.checked,1);assert.equal(proof.unchecked,0);assert.equal(proof.operators[0].status,'passed');assert.match(proof.operators[0].reason,/未.*kernel/);assert.equal(proof.bytesRead,0);assert.equal(proof.inspectedBytes,0);
 }
});
test('spatial report preserves per-OP verdicts and leaves runtime checks not-run',async()=>{
 for(const dynamicShape of [false,true]){
  const f=await fixture('CONV_2D',dynamicShape?dynamic:()=>{}),result=editTfliteModel(f.index,f.file,f.plan),bytes=new Uint8Array(await result.blob.arrayBuffer()),candidate=await parseModel((o,n)=>bytes.subarray(o,o+n),bytes.length,metadata);
  result.semanticValidation=[validateTfliteConstants(candidate.raw,0,()=>assert.fail('No weights.'))];result.roundTrip=true;
  const built=createModelEditReport(f.index,f.file,result,candidate,{graph:0,node:0,mode:'replace'},{outputName:'conv-edited.tflite'}),report=JSON.parse(await built.blob.text());
  assert.equal(report.operatorSummary.checked,dynamicShape?0:1);assert.equal(report.operatorSummary.unchecked,dynamicShape?1:0);assert.equal(report.operatorValidation[0].status,dynamicShape?'not-run':'passed');assert.equal(report.operatorValidation[0].type,'CONV_2D');
  assert.ok(report.checks.filter(c=>c.id.startsWith('runtime')).every(c=>c.status==='not-run'));assert.ok(!JSON.stringify(report).includes('"values"'));
 }
});
test('unknown spatial encodings remain unverified and custom names never select builtin rules',async()=>{
 const f=await fixture('CONV_2D');
 for(const type of [1,17,19]){
  f.index.raw.subgraphs[0].tensors[1].type=type;
  const proof=validateTfliteConstants(f.index.raw,0,()=>assert.fail('No packing reads.'));
  assert.equal(proof.operators[0].status,'not-run');assert.match(proof.operators[0].reason,/dtype.*packing/);
 }
 Object.assign(f.index.raw.operator_codes[0],{builtin_code:32,deprecated_builtin_code:32,custom_code:'CONV_2D'});
 f.index.raw.subgraphs[0].tensors[1].shape=Int32Array.of(4);
 const proof=validateTfliteConstants(f.index.raw,0,()=>assert.fail('No custom reads.'));
 assert.equal(proof.operators[0].status,'not-run');assert.match(proof.operators[0].reason,/custom kernel/);
});
test('legacy known rank and hybrid filters remain valid; unknown rank is not invented',()=>{
 const t=(shape,extra={})=>({type:0,shape,has_rank:true,...extra}),options={padding:1,stride_h:1,stride_w:1,dilation_h_factor:1,dilation_w_factor:1};
 assert.throws(()=>checkOperatorMetadata('CONV_2D',[t([3,3,1],{has_rank:false,shape_signature:[-1,3,1]}),t([1,2,2,1]),t([1])],[t([1,2,2,1])],options),/input.*四維/);
 assert.doesNotThrow(()=>checkOperatorMetadata('CONV_2D',[t([],{has_rank:false}),t([1,2,2,1]),t([1])],[t([],{has_rank:false})],options));
 assert.doesNotThrow(()=>checkOperatorMetadata('CONV_2D',[t([1,3,3,1],{shape_signature:[-1,3,3,1]}),t([1,2,2,1],{type:9}),t([1])],[t([1,2,2,1])],options));
});
