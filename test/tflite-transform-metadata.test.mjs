import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {transformFixture as fixture} from './transform-fixture.mjs';
import {prepareTfliteModelEdit,editTfliteModel} from '../src/tflite-model-edit.js';
import {validateTfliteConstants} from '../src/tflite-constant-checks.js';
import {parseModel} from '../src/model-engine.js';
import {createModelEditReport} from '../src/model-edit-report.js';
import {inferStaticTransform} from '../src/tflite-static-transform.js';
import {checkOperatorMetadata} from '../src/tflite-semantic-checks.js';
const metadata=JSON.parse(await readFile(new URL('../vendor/netron/tflite-metadata.json',import.meta.url),'utf8'));
const t=(shape,extra={})=>({shape,type:0,...extra}),dynamic=t([1,2],{shape_signature:[-1,2]});
const plan=f=>{const op=f.model.subgraphs[0].operators[0];return [{graph:0,operators:[{template:0,inputs:Array.from(op.inputs),outputs:Array.from(op.outputs)}]}];};
for(const [label,name,spec,error]of [
 ['concat axis','CONCATENATION',{inputs:[dynamic,t([1,2])],output:t([1,4],{shape_signature:[-1,4]}),options:{axis:2}},/axis.*rank/],
 ['concat input rank','CONCATENATION',{inputs:[dynamic,t([2])],output:t([1,4],{shape_signature:[-1,4]})},/輸入 rank/],
 ['concat output rank','CONCATENATION',{inputs:[dynamic,t([1,2])],output:t([4],{shape_signature:[-1]})},/output rank|輸出 rank/],
 ['squeeze axis','SQUEEZE',{inputs:[t([1,2,1],{shape_signature:[-1,2,1]})],output:t([2],{shape_signature:[-1]}),options:{squeeze_dims:[3]}},/squeeze_dims|axis/],
 ['squeeze known nonunit','SQUEEZE',{inputs:[t([1,2,1],{shape_signature:[-1,2,1]})],output:t([1,2],{shape_signature:[-1,2]}),options:{squeeze_dims:[1]}},/squeeze_dims|維度|axis/],
 ['concat negative axis','CONCATENATION',{inputs:[dynamic,t([1,2])],output:t([1,4],{shape_signature:[-1,4]}),options:{axis:-3}},/axis.*rank/],
 ['concat known nonaxis extent','CONCATENATION',{inputs:[dynamic,t([1,3],{shape_signature:[-1,3]})],output:t([2,2],{shape_signature:[-1,2]}),options:{axis:0}},/非 axis/],
 ['concat known axis overflow','CONCATENATION',{inputs:[t([1,2147483647],{shape_signature:[-1,2147483647]}),t([1,1],{shape_signature:[-1,1]})],output:t([1,1],{shape_signature:[-1,-1]}),options:{axis:1}},/int32/],
 ['squeeze explicit output rank','SQUEEZE',{inputs:[t([1,2,1],{shape_signature:[-1,2,1]})],output:t([2],{shape_signature:[-1]}),options:{squeeze_dims:[-1,2,-1]}},/output rank/],
 ['squeeze implicit output rank bounds','SQUEEZE',{inputs:[t([1,2,1],{shape_signature:[-1,2,1]})],output:t([1,2,1],{shape_signature:[-1,2,1]})},/output rank/]
]){
 test(`actual transform edit rejects known ${label} with dynamic extents`,async()=>{const f=await fixture(name,spec);assert.throws(()=>prepareTfliteModelEdit(f.index,f.file,plan(f)),e=>/Subgraph #0.*OP #0/.test(e.message)&&error.test(e.message));});
 test(`serialized transform report rejects known ${label} before payload reads`,async()=>{const f=await fixture(name,spec);assert.throws(()=>validateTfliteConstants(f.model,0,()=>assert.fail('No payload reads.')) ,e=>/Subgraph #0.*OP #0/.test(e.message)&&error.test(e.message));});
}
test('static transforms get bounded per-OP metadata verdicts without payload reads',async()=>{
 for(const name of ['CONCATENATION','SQUEEZE']){const f=await fixture(name),proof=validateTfliteConstants(f.model,0,()=>assert.fail('No payload reads.'),{budget:0});assert.equal(proof.checked,1);assert.equal(proof.unchecked,0);assert.equal(proof.operators[0].status,'passed');assert.match(proof.operators[0].reason,/未.*kernel/);assert.equal(proof.bytesRead,0);assert.equal(proof.inspectedBytes,0);}
});
test('valid dynamic transforms remain editable and explicitly unverified',async()=>{
 for(const [name,spec]of [['CONCATENATION',{inputs:[dynamic,t([1,2])],output:t([1,4],{shape_signature:[-1,4]})}],['SQUEEZE',{inputs:[t([1,2,1],{shape_signature:[-1,2,1]})],output:t([1,2],{shape_signature:[-1,2]}),options:{squeeze_dims:[-1]}}]]){
  const f=await fixture(name,spec);f.file.arrayBuffer=()=>assert.fail('Do not read the whole source.');const edited=editTfliteModel(f.index,f.file,plan(f)),bytes=new Uint8Array(await edited.blob.arrayBuffer()),candidate=await parseModel((o,n)=>bytes.subarray(o,o+n),bytes.length,metadata);
  const proof=validateTfliteConstants(candidate.raw,0,()=>assert.fail('No payload reads.'),{budget:0});assert.equal(proof.checked,0);assert.equal(proof.unchecked,1);assert.equal(proof.operators[0].status,'not-run');assert.match(proof.operators[0].reason,/動態|未知/);
  for(const [i,a]of f.model.subgraphs[0].tensors.entries())for(const key of ['shape','shape_signature','type','has_rank','quantization'])assert.deepEqual(candidate.raw.subgraphs[0].tensors[i][key],a[key]);
  for(const [id,b]of f.model.buffers.entries())if(b.size){const a=candidate.raw.buffers[id];assert.equal(a.size,b.size);assert.deepEqual(bytes.subarray(Number(a.offset),Number(a.offset+a.size)),f.bytes.subarray(Number(b.offset),Number(b.offset+b.size)));}
 }
});
test('unknown dynamic axes are not inferred from allocated extent hints; implicit squeeze rank remains a range',()=>{
 const input=t([2,2,1],{shape_signature:[-1,2,1]});
 assert.doesNotThrow(()=>checkOperatorMetadata('SQUEEZE',[input],[t([2,1],{shape_signature:[-1,1]})],{squeeze_dims:[0]}));
 for(const shape of [[2],[2,2]])assert.doesNotThrow(()=>checkOperatorMetadata('SQUEEZE',[input],[t(shape,{shape_signature:shape.map(()=>-1)})],{}));
 assert.throws(()=>checkOperatorMetadata('SQUEEZE',[t([2,1],{shape_signature:[3,1]})],[t([1])],{squeeze_dims:[0]}),/squeeze_dims/);
});
test('unknown rank is not mistaken for scalar; nonempty legacy shape still supplies rank',()=>{
 assert.equal(inferStaticTransform('SQUEEZE',[t([],{has_rank:false})],{}).status,'manual');
 assert.equal(inferStaticTransform('CONCATENATION',[t([],{has_rank:false}),t([],{has_rank:false})],{axis:0}).status,'manual');
 assert.throws(()=>checkOperatorMetadata('CONCATENATION',[t([1,2],{has_rank:false,shape_signature:[-1,2]}),t([1,2])],[t([1,4])],{axis:2}),/axis/);
 assert.doesNotThrow(()=>checkOperatorMetadata('CONCATENATION',[t([],{has_rank:false}),t([1,2])],[t([1,4])],{axis:-1}));
});
test('scalar concat, unimplemented packing, high-rank kernels and non-NONE activation stay explicit not-run',async()=>{
 for(const [name,spec,reason]of [
  ['CONCATENATION',{inputs:[t([],{values:[1]}),t([],{values:[2]})],output:t([2]),options:{axis:0}},/scalar/],
  ['CONCATENATION',{inputs:[t([1,2],{type:17}),t([1,2],{type:17})],output:t([1,4],{type:17})},/packing/],
  ['SQUEEZE',{inputs:[t(Array(9).fill(1))],output:t([])},/高 rank/],
  ['CONCATENATION',{options:{fused_activation_function:1}},/activation/]
 ]){const f=await fixture(name,spec);assert.doesNotThrow(()=>prepareTfliteModelEdit(f.index,f.file,plan(f)));const proof=validateTfliteConstants(f.model,0,()=>assert.fail('No reads.'));assert.equal(proof.checked,0);assert.equal(proof.unchecked,1);assert.match(proof.operators[0].reason,reason);}
});
test('custom op names never select transform rules, and missing required builtin inputs reject before reads',async()=>{
 const f=await fixture('SQUEEZE',{inputs:[t([2,3])],output:t([2],{type:2}),custom:true});assert.doesNotThrow(()=>prepareTfliteModelEdit(f.index,f.file,plan(f)));
 const edited=editTfliteModel(f.index,f.file,plan(f)),bytes=new Uint8Array(await edited.blob.arrayBuffer()),candidate=await parseModel((o,n)=>bytes.subarray(o,o+n),bytes.length,metadata);assert.equal(candidate.raw.operator_codes[0].builtin_code,32);assert.deepEqual(candidate.raw.subgraphs[0].operators[0].custom_options,f.model.subgraphs[0].operators[0].custom_options);
 const proof=validateTfliteConstants(candidate.raw,0,()=>assert.fail('No custom reads.'));assert.equal(proof.operators[0].status,'not-run');assert.match(proof.operators[0].reason,/custom kernel/);
 const required=await fixture('CONCATENATION');required.model.subgraphs[0].operators[0].inputs[0]=-1;assert.throws(()=>validateTfliteConstants(required.model,0,()=>assert.fail('No reads.')),/必要輸入/);
});
test('actual transform reports preserve per-OP verdicts while runtime stays manual',async()=>{
 for(const isDynamic of [false,true]){
  const f=await fixture('CONCATENATION',isDynamic?{inputs:[dynamic,t([1,2],{values:[3,4]})],output:t([1,4],{shape_signature:[-1,4]})}:{}),result=editTfliteModel(f.index,f.file,plan(f)),bytes=new Uint8Array(await result.blob.arrayBuffer()),candidate=await parseModel((o,n)=>bytes.subarray(o,o+n),bytes.length,metadata);
  result.semanticValidation=[validateTfliteConstants(candidate.raw,0,()=>assert.fail('No reads.'))];result.roundTrip=true;const built=createModelEditReport(f.index,f.file,result,candidate,{graph:0,node:0,mode:'replace'},{outputName:'transform-edited.tflite'}),report=JSON.parse(await built.blob.text());
  assert.equal(report.operatorSummary.checked,isDynamic?0:1);assert.equal(report.operatorSummary.unchecked,isDynamic?1:0);assert.equal(report.operatorValidation[0].status,isDynamic?'not-run':'passed');assert.ok(report.checks.filter(c=>c.id.startsWith('runtime')).every(c=>c.status==='not-run'));assert.ok(!JSON.stringify(report).includes('"values"'));
 }
});
