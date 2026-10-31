import test from 'node:test';
import assert from 'node:assert/strict';
import {checkOperatorMetadata as check} from '../src/tflite-semantic-checks.js';
import {prepareTfliteModelEdit} from '../src/tflite-model-edit.js';
import {parseModel} from '../src/model-engine.js';
import {runtimeFixture} from './runtime-fixture.mjs';
import {readFile} from 'node:fs/promises';
const t=(shape,type=0)=>({shape,type});

test('TRANSPOSE permutation requires int32 while GATHER may use int64 indices',()=>{
    assert.doesNotThrow(()=>check('TRANSPOSE',[t([1,2]),t([2],2)],[t([1,2])]));
    for(const type of [4,0,7,9])assert.throws(()=>check('TRANSPOSE',[t([1,2]),t([2],type)],[t([1,2])]),/TRANSPOSE.*permutation.*int32/);
    assert.doesNotThrow(()=>check('GATHER',[t([1,2]),t([2],4)],[t([1,2])],{axis:1,batch_dims:0}));
});
test('FC checks flattened/keep_num_dims outputs and bias, retaining hybrid and dynamic cases',()=>{
    assert.doesNotThrow(()=>check('FULLY_CONNECTED',[t([2,3,4]),t([5,4],9),t([5])],[t([6,5])],{}));
    assert.doesNotThrow(()=>check('FULLY_CONNECTED',[t([2,4]),t([5,4]),t([1,5])],[t([2,5])],{}));
    assert.doesNotThrow(()=>check('FULLY_CONNECTED',[t([2,3,4]),t([5,4])],[t([2,3,5])],{keep_num_dims:true}));
    for(const [a,w,b,o,opts]of [[[2,3],[5,4],null,[2,5],{}],[[2,4],[5,4],[4],[2,5],{}],[[2,4],[5,4],null,[5,2],{}],[[2,3,4],[5,3],null,[2,3,5],{keep_num_dims:true}]])assert.throws(()=>check('FULLY_CONNECTED',[t(a),t(w),b&&t(b)],[t(o)],opts),/FULLY_CONNECTED/);
    assert.doesNotThrow(()=>check('FULLY_CONNECTED',[{...t([1,4]),shape_signature:[-1,4]},t([5,4])],[t([9,9])]));
});
test('BMM checks transpose, batch broadcasting, zero dimensions and contracting axes',()=>{
    assert.doesNotThrow(()=>check('BATCH_MATMUL',[t([2,3,4]),t([1,4,5])],[t([2,3,5])]));
    assert.doesNotThrow(()=>check('BATCH_MATMUL',[t([4,3]),t([5,4])],[t([3,5])],{adj_x:true,adj_y:true}));
    assert.doesNotThrow(()=>check('BATCH_MATMUL',[t([0,3,4]),t([1,4,5])],[t([0,3,5])]));
    for(const [a,b,o]of [[[3,4],[3,5],[3,5]],[[2,3,4],[3,4,5],[2,3,5]],[[3,4],[4,5],[5,3]]])assert.throws(()=>check('BATCH_MATMUL',[t(a),t(b)],[t(o)]),/BATCH_MATMUL/);
});
test('GATHER normalizes negative axes/batch_dims and checks index dtype and output',()=>{
    assert.doesNotThrow(()=>check('GATHER',[t([2,4,3]),t([2,5],7)],[t([2,5,3])],{axis:1,batch_dims:-1}));
    for(const [idx,out,options]of [[t([2,5],0),t([2,5,3]),{axis:1,batch_dims:1}],[t([2,5],2),t([2,4,5]),{axis:1,batch_dims:1}],[t([3,5],2),t([2,5,3]),{axis:1,batch_dims:1}]])assert.throws(()=>check('GATHER',[t([2,4,3]),idx],[out],options),/GATHER/);
});
test('quantization errors identify port; no guess is made for custom kernels',()=>{
    const q={scale:[.1,.2],zero_point:[0n,0n],quantized_dimension:1};
    assert.doesNotThrow(()=>check('CUSTOM',[{...t([1,2],9),quantization:q}],[]));
    assert.throws(()=>check('ADD',[{...t([1,3],9),quantization:q}],[]),/input 0.*量化/);
    assert.throws(()=>check('ADD',[{...t([1],9),quantization:{scale:[.1],zero_point:[999n]}}],[]),/zero point/);
});
test('actual edit exporter checks rewired existing OPs and includes subgraph/OP/tensor context',async()=>{
    const f=await runtimeFixture({inputShapes:[[2],[3]],outputShape:[2]}),meta=JSON.parse(await readFile(new URL('../vendor/netron/tflite-metadata.json',import.meta.url),'utf8')),index=await parseModel((o,n)=>f.bytes.subarray(o,o+n),f.bytes.length,meta);
    assert.throws(()=>prepareTfliteModelEdit(index,f.file,[{graph:0,operators:[{template:0,inputs:[0,1]}]}]),/Subgraph #0.*OP #0.*inputs \[0, 1\].*broadcast/);
});
