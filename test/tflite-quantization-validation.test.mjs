import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {tflite as s} from '../vendor/netron/tflite-schema.js';
import {FlatbufferWriter} from '../src/flatbuffer-writer.js';
import {parseModel} from '../src/model-engine.js';
import {runtimeFixture} from './runtime-fixture.mjs';
import {prepareTfliteModelEdit,editTfliteModel} from '../src/tflite-model-edit.js';
import {createModelEditReport} from '../src/model-edit-report.js';
import {checkBuiltinPorts} from '../src/tflite-new-ops.js';
import {inspectTensorQuantization,inspectTfliteQuantization,QUANTIZATION_VALUE_LIMIT,QUANTIZATION_TENSOR_LIMIT} from '../src/tflite-quantization-checks.js';
import {exportTflite} from '../src/tflite-export.js';
import {createExportReport} from '../src/export-report.js';
import {attachRuntimeReport} from '../src/tflite-runtime-report.js';
import {runtimeSkipped} from '../src/tflite-runtime-policy.js';
const metadata=JSON.parse(await readFile(new URL('../vendor/netron/tflite-metadata.json',import.meta.url),'utf8'));
const parse=bytes=>parseModel((o,n)=>bytes.subarray(o,o+n),bytes.length,metadata);
const affine=(scale=[.5],dimension=0)=>Object.assign(new s.QuantizationParameters(),{scale:Float32Array.from(scale),zero_point:BigInt64Array.from(scale,()=>0n),quantized_dimension:dimension});
async function quantizedFixture({rank=true,scale=[.5],dimension=0}={}){
    const {model}=await runtimeFixture({inputShapes:[[2],[2]],outputShape:[2]});
    for(const t of model.subgraphs[0].tensors){t.type=s.TensorType.INT8;t.quantization=affine();}
    Object.assign(model.subgraphs[0].tensors[0],{has_rank:rank,quantization:affine(scale,dimension)});
    const blob=new FlatbufferWriter().finish(model,new Blob()),bytes=new Uint8Array(await blob.arrayBuffer()),index=await parse(bytes),file=new File([blob],'quantized-public-fixture.tflite');
    file.arrayBuffer=()=>assert.fail('never read the whole source File');
    return {index,file,bytes};
}
for(const [title,options]of [
    ['legacy nonempty shape with has_rank false',{rank:false,scale:[.25,.5],dimension:3}],
    ['per-tensor scale with an out-of-range axis',{rank:true,scale:[.5],dimension:3}]
])test('actual rewired export rejects '+title+' with OP and tensor context',async()=>{
    const {index,file}=await quantizedFixture(options);
    assert.throws(()=>prepareTfliteModelEdit(index,file,[{graph:0,operators:[{template:0,inputs:[0,1]}]}]),error=>/Subgraph #0.*OP #0.*inputs \[0, 1\]/.test(error.message)&&/input 0.*quantized_dimension/.test(error.message));
});
test('QuantizationDetails overrides affine fields instead of rejecting an unknown custom codec',()=>{
    const opaque=Object.assign(new s.CustomQuantization(),{custom:Uint8Array.of(9,8)}),t={shape:Int32Array.of(2),has_rank:true,type:s.TensorType.INT8,quantization:{scale:[NaN],zero_point:[0n],quantized_dimension:99,details:opaque}};
    assert.doesNotThrow(()=>checkBuiltinPorts(s.BuiltinOperator.ADD,[t,{...t,quantization:null}],[{...t,quantization:null}],{}));
});
test('actual identity export retains invalid original quantization and reports its failure without interpreter',async()=>{
    const {index,file}=await quantizedFixture({rank:false,scale:[.25,.5],dimension:3});
    const result=editTfliteModel(index,file,[{graph:0}]),bytes=new Uint8Array(await result.blob.arrayBuffer()),candidate=await parse(bytes);
    assert.equal(candidate.raw.subgraphs[0].tensors[0].quantization.quantized_dimension,3);
    const built=createModelEditReport(index,file,{...result,roundTrip:true},candidate,{graph:0,node:0,mode:'replace'},{outputName:'identity.tflite'}),r=JSON.parse(await built.blob.text());
    assert.equal(r.quantizationSummary.failed,1);assert.equal(r.quantizationValidation[0].tensor,0);
    assert.equal(r.quantizationValidation[0].status,'failed');assert.match(r.quantizationValidation[0].reason,/quantized_dimension/);
    assert.equal(r.checks.find(c=>c.id==='quantization-metadata').status,'failed');
    assert.ok(r.checks.filter(c=>c.id.startsWith('runtime')).every(c=>c.status==='not-run'));
    assert.deepEqual(built.summary.quantizationValidation,r.quantizationValidation);
    assert.ok(!JSON.stringify(r.quantizationValidation).includes('zero_point'));
});
test('legacy rank, dynamic channel and scalar limits follow affine metadata rather than has_rank alone',()=>{
    const t=(shape,quantization=affine(),has_rank=false)=>({shape,quantization,has_rank,type:9});
    assert.equal(inspectTensorQuantization(t([2],affine([.25,.5],0))).status,'passed');
    assert.equal(inspectTensorQuantization({...t([1,2]),shape_signature:[-1,2]}).status,'passed');
    assert.equal(inspectTensorQuantization(t([-1],affine([.25,.5],0))).status,'not-run');
    assert.equal(inspectTensorQuantization(t([])).status,'not-run');
    assert.equal(inspectTensorQuantization(t([],affine([.5],3),true)).status,'passed');
    assert.equal(inspectTensorQuantization(t([],affine([.5],-1),true)).status,'failed');
    assert.equal(inspectTensorQuantization(t([2],{scale:[],zero_point:[],quantized_dimension:-1})),null);
});
test('invalid affine metadata has explicit failure while QuantizationDetails is never guessed',()=>{
    for(const q of [{scale:[0],zero_point:[0n]},{scale:[NaN],zero_point:[0n]},{scale:[1],zero_point:[]},{scale:[1],zero_point:[128n]},{scale:[1],zero_point:[1.25]}]){
        assert.equal(inspectTensorQuantization({shape:[2],has_rank:false,type:9,quantization:q}).status,'failed');
    }
    const details={custom:Uint8Array.of(1)},q={details,get scale(){assert.fail('opaque details do not read affine fields');}};
    assert.equal(inspectTensorQuantization({quantization:q}).status,'not-run');
});
test('quantization budget is shared across subgraphs, charges actual visited values and never reads tensor payloads',()=>{
    const tensors=Array.from({length:3},()=>({shape:[2],has_rank:false,type:9,quantization:affine(),get buffer(){assert.fail('metadata check must not read payload references');}}));
    const model={subgraphs:[{tensors:tensors.slice(0,2)},{tensors:tensors.slice(2)}]};
    const r=inspectTfliteQuantization(model,[0,0,1],{valueLimit:4});
    assert.equal(r.total,3);assert.equal(r.checked,2);assert.equal(r.unchecked,1);assert.equal(r.inspectedValues,4);assert.equal(r.tensors[2].status,'not-run');
    const failed=inspectTfliteQuantization({subgraphs:[{tensors:[{shape:[2],type:9,quantization:affine([.5],9)}]}]},[0],{valueLimit:0});
    assert.equal(failed.failed,1);assert.equal(failed.inspectedValues,0);
});
test('tensor record cap preserves unknown counts and cannot be expanded beyond the fixed bound',()=>{
    const t={shape:[2],has_rank:true,type:9,quantization:affine()},model={subgraphs:[{tensors:[t,t,t]}]};
    const r=inspectTfliteQuantization(model,[0],{tensorLimit:2});
    assert.equal(r.tensors.length,2);assert.equal(r.total,3);assert.equal(r.checked,2);assert.equal(r.unchecked,1);assert.equal(r.omitted,1);
    assert.throws(()=>inspectTfliteQuantization(model,[0],{valueLimit:QUANTIZATION_VALUE_LIMIT+1}),/上限/);
    assert.throws(()=>inspectTfliteQuantization(model,[0],{tensorLimit:QUANTIZATION_TENSOR_LIMIT+1}),/上限/);
});
test('ordinary cut keeps source quantization byte-for-byte, reports output IDs and never starts interpreter',async()=>{
    const c=await quantizedFixture({rank:false,scale:[.25,.5],dimension:3}),source=c.bytes.slice();
    const result=exportTflite(c.index,0,[0],c.file),bytes=new Uint8Array(await result.blob.arrayBuffer()),candidate=await parse(bytes);
    assert.deepEqual(candidate.raw.subgraphs[0].tensors.map(t=>t.quantization),c.index.raw.subgraphs[0].tensors.map(t=>t.quantization));
    assert.deepEqual(c.bytes,source);
    const built=createExportReport(c.index,c.file,result,{graph:0,nodes:[0],outputName:'cut.tflite'}),r=JSON.parse(await built.blob.text());
    assert.equal(r.quantizationSummary.failed,1);assert.equal(r.quantizationValidation[0].tensor,0);assert.equal(r.quantizationValidation[0].graph,0);
    assert.equal(r.checks.find(x=>x.id==='quantization-metadata').status,'failed');
    assert.ok(!('runtimeValidation' in r));
    const attached=await attachRuntimeReport(built,runtimeSkipped('manual only'));
    const retained=JSON.parse(await attached.blob.text());assert.deepEqual(retained.quantizationValidation,r.quantizationValidation);
    assert.equal(retained.checks.find(x=>x.id==='quantization-metadata').status,'failed');
});
test('valid quantized rewiring and actual serialized output report pass static checks without claiming CPU equivalence',async()=>{
    const c=await quantizedFixture(),result=editTfliteModel(c.index,c.file,[{graph:0,operators:[{template:0,inputs:[1,0]}]}]),bytes=new Uint8Array(await result.blob.arrayBuffer()),candidate=await parse(bytes);
    const built=createModelEditReport(c.index,c.file,{...result,roundTrip:true},candidate,{graph:0,node:0,mode:'replace'},{outputName:'valid.tflite'}),r=JSON.parse(await built.blob.text());
    assert.equal(r.quantizationSummary.checked,3);assert.equal(r.quantizationSummary.failed,0);assert.equal(r.quantizationSummary.unchecked,0);
    assert.equal(r.checks.find(x=>x.id==='quantization-metadata').status,'passed');
    assert.equal(r.checks.find(x=>x.id==='runtime-equivalence').status,'not-run');
});

test('unimplemented affine dtype ranges stay unverified rather than passing partial checks',()=>{
    for(const type of [s.TensorType.INT64,s.TensorType.INT4,s.TensorType.UINT16,s.TensorType.FLOAT32]){
        const t={type,shape:[2],has_rank:true,quantization:affine()};
        const r=inspectTfliteQuantization({subgraphs:[{tensors:[t]}]},[0]);
        assert.equal(r.checked,0);assert.equal(r.unchecked,1);assert.equal(r.failed,0);
        assert.match(r.tensors[0].reason,/dtype.*範圍/);
    }
});

test('actual serialized INT4 identity report does not claim an unimplemented dtype range was checked',async()=>{
    const c=await quantizedFixture();for(const t of c.index.raw.subgraphs[0].tensors)t.type=s.TensorType.INT4;
    const blob=new FlatbufferWriter().finish(c.index.raw,new Blob()),bytes=new Uint8Array(await blob.arrayBuffer()),index=await parse(bytes),file=new File([blob],'unverified-int4.tflite');
    const result=editTfliteModel(index,file,[{graph:0}]),reopened=await parse(new Uint8Array(await result.blob.arrayBuffer())),built=createModelEditReport(index,file,{...result,roundTrip:true},reopened,{graph:0,node:0,mode:'replace'},{outputName:'int4-copy.tflite'}),r=JSON.parse(await built.blob.text());
    assert.equal(r.quantizationSummary.checked,0);assert.equal(r.quantizationSummary.unchecked,3);assert.equal(r.quantizationSummary.failed,0);
    assert.equal(r.checks.find(c=>c.id==='quantization-metadata').status,'not-run');
    assert.ok(r.quantizationValidation.every(c=>c.dtype==='INT4'&&c.status==='not-run'));
});

