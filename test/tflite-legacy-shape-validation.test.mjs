import test from 'node:test';
import assert from 'node:assert/strict';
import {tflite as s} from '../vendor/netron/tflite-schema.js';
import {prepareTfliteModelEdit,editTfliteModel} from '../src/tflite-model-edit.js';
import {validateTfliteConstants} from '../src/tflite-constant-checks.js';
import {createModelEditReport} from '../src/model-edit-report.js';
import {legacyShapeFixture as fixture,parseLegacyShapeFixture as parse} from './legacy-shape-fixture.mjs';
import {checkOperatorMetadata} from '../src/tflite-semantic-checks.js';
import {inferSpatialTransform} from '../src/tflite-spatial-checks.js';
import {staticTfliteShape} from '../src/tflite-static-shape.js';

test('actual legacy FC rewire rejects a known incompatible input even when has_rank defaults false',async()=>{
    for(const rank of [true,false]){
        const c=await fixture('FULLY_CONNECTED',[[2,3],[5,4]],{rank,output:[2,5]});
        assert.equal(c.index.raw.subgraphs[0].tensors[0].has_rank,rank);
        assert.throws(()=>prepareTfliteModelEdit(c.index,c.file,[{graph:0,operators:[{template:0,inputs:[0,1,3]}]}]),error=>/Subgraph #0.*OP #0.*FULLY_CONNECTED/.test(error.message)&&/input_size/.test(error.message));
    }
});

test('valid serialized legacy FC edits preserve dimensions and the original false rank flags',async()=>{
    const c=await fixture('FULLY_CONNECTED',[[2,4],[5,4]],{output:[2,5]});
    const result=editTfliteModel(c.index,c.file,[{graph:0,operators:[{template:0,inputs:[0,1,3]}]}]);
    const candidate=await parse(new Uint8Array(await result.blob.arrayBuffer()));
    assert.deepEqual(candidate.raw.subgraphs[0].tensors.map(t=>Array.from(t.shape)),[[2,4],[5,4],[2,5],[5]]);
    assert.ok(candidate.raw.subgraphs[0].tensors.every(t=>t.has_rank===false));
});

test('actual legacy TRANSPOSE edit checks readable permutation and reports output tensor IDs without changing flags',async()=>{
    const c=await fixture('TRANSPOSE',[[2,3],[2]],{output:[3,2],values:[1,0]}),result=editTfliteModel(c.index,c.file,[{graph:0}]);
    const bytes=new Uint8Array(await result.blob.arrayBuffer()),candidate=await parse(bytes);
    assert.ok(candidate.raw.subgraphs[0].tensors.every(t=>t.has_rank===false));
    // The same serialized-candidate seam used by model-worker before reporting.
    const semanticValidation=[validateTfliteConstants(candidate.raw,0,(o,n)=>bytes.subarray(o,o+n))];
    const built=createModelEditReport(c.index,c.file,{...result,roundTrip:true,semanticValidation},candidate,{graph:0,node:0,mode:'replace'},{outputName:'legacy-edit.tflite'}),r=JSON.parse(await built.blob.text());
    assert.equal(r.operatorValidation[0].status,'passed');
    assert.ok(!('runtimeValidation' in r));
    const bad=await fixture('TRANSPOSE',[[2,3],[2]],{output:[3,2],values:[0,0]});
    const edited=editTfliteModel(bad.index,bad.file,[{graph:0}]),badBytes=new Uint8Array(await edited.blob.arrayBuffer()),badCandidate=await parse(badBytes);
    assert.throws(()=>validateTfliteConstants(badCandidate.raw,0,(o,n)=>badBytes.subarray(o,o+n)),/OP #0 TRANSPOSE.*permutation/);
});

test('legacy nonempty dimensions reach BMM, spatial and operand checks instead of silently bypassing them',()=>{
    const t=shape=>({shape:Int32Array.from(shape),type:s.TensorType.FLOAT32,has_rank:false});
    assert.throws(()=>checkOperatorMetadata('BATCH_MATMUL',[t([3,4]),t([3,5])],[t([3,5])]),/contracting dimension/);
    const opts={stride_h:1,stride_w:1,padding:0,dilation_h_factor:1,dilation_w_factor:1};
    assert.equal(inferSpatialTransform('CONV_2D',[t([1,5,5,2]),t([4,3,3,3])],opts).status,'invalid');
    assert.throws(()=>checkOperatorMetadata('PAD',[t([2,3]),{...t([2,1]),type:s.TensorType.INT32}],[t([2,3])]),/paddings shape/);
});

test('unknown rank, dynamic signatures and invalid or excessive dimensions do not become static',()=>{
    for(const tensor of [{shape:[],has_rank:false},{shape:[2,3],shape_signature:[-1,3],has_rank:false},{shape:[-1]},{shape:[1.5]},{shape:[2147483648]},{shape:Array(129).fill(1)},{}])assert.equal(staticTfliteShape(tensor),null);
    assert.deepEqual(staticTfliteShape({shape:[],has_rank:true}),[]);
    assert.deepEqual(staticTfliteShape({shape:[0,2],has_rank:false}),[0,2]);
    assert.deepEqual(staticTfliteShape({shape:Int32Array.of(2,3),shape_signature:Int32Array.of(2,3),has_rank:false}),[2,3]);
    const dynamic={shape:[2,3],shape_signature:[-1,3],has_rank:false,type:0};
    assert.doesNotThrow(()=>checkOperatorMetadata('FULLY_CONNECTED',[dynamic,{shape:[5,4],has_rank:false,type:0}],[{shape:[9,9],has_rank:false,type:0}]));
});

test('dynamic edited TRANSPOSE remains unverified and does not read constants',async()=>{
    const c=await fixture('TRANSPOSE',[[2,3],[2]],{output:[3,2],values:[1,0]});
    c.index.raw.subgraphs[0].tensors[2].shape_signature=Int32Array.of(-1,2);
    const proof=validateTfliteConstants(c.index.raw,0,()=>assert.fail('dynamic shape must precede payload reads'));
    assert.equal(proof.checked,0);assert.equal(proof.unchecked,1);assert.match(proof.operators[0].reason,/動態或未知/);
});
