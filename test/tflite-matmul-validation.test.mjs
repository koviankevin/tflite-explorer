import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {checkOperatorMetadata as check} from '../src/tflite-semantic-checks.js';
import {checkBuiltinPorts} from '../src/tflite-new-ops.js';
import {validateTfliteConstants} from '../src/tflite-constant-checks.js';
import {prepareTfliteModelEdit,editTfliteModel} from '../src/tflite-model-edit.js';
import {parseModel} from '../src/model-engine.js';
import {batchMatmulFixture as fixture} from './batch-matmul-fixture.mjs';
const t=(shape,type=0,extra={})=>({shape,type,has_rank:true,...extra});
const name='BATCH_MATMUL';

test('BMM rejects invalid result dtype and restricts the int32 exception to two int8 inputs',()=>{
    for(const [x,y,out] of [[0,0,2],[0,9,9],[9,0,2],[7,7,2],[1,1,0]]){
        assert.throws(()=>check(name,[t([2,2],x),t([2,2],y)],[t([2,2],out)]),/BATCH_MATMUL.*dtype/);
        assert.throws(()=>checkBuiltinPorts(126,[t([2,2],x),t([2,2],y)],[t([2,2],out)],{}),/BATCH_MATMUL.*dtype/);
    }
    assert.throws(()=>check(name,[t([2,2],2),t([2,2],2)],[t([2,2],2)]),/BATCH_MATMUL.*input.*dtype/);
});

test('BMM preserves hybrid, int16/int8, int8-to-int32 and float16 metadata cases',()=>{
    for(const [x,y,out] of [[0,0,0],[0,9,0],[9,9,9],[9,9,2],[7,7,7],[7,9,7],[1,1,1]])assert.doesNotThrow(()=>check(name,[t([2,2],x),t([2,2],y)],[t([2,2],out)]));
});

test('BMM enforces input rank 2 through 5 even when output dimensions are unknown',()=>{
    for(const shape of [[2],[1,1,1,1,2,2]])for(const dynamic of [false,true])assert.throws(()=>check(name,[t(shape,0,dynamic?{shape_signature:shape.map(()=>-1)}:{}),t([2,2])],[t([2,2],0,{shape_signature:[-1,2]})]),/BATCH_MATMUL.*rank/);
    assert.doesNotThrow(()=>check(name,[t([1,1,1,2,2]),t([2,2])],[t([1,1,1,2,2])]));
});

test('actual BMM edit refuses an invalid result dtype with subgraph, OP and tensor context',async()=>{
    const f=await fixture({output:t([2,2],2)});
    assert.throws(()=>prepareTfliteModelEdit(f.index,f.file,[{graph:0,operators:[{template:0,inputs:[0,1],outputs:[2]}]}]),/Subgraph #0.*OP #0.*inputs \[0, 1\].*outputs \[2\].*BATCH_MATMUL.*dtype/);
});

test('serialized BMM report verifies static types and shapes without reading weights or using the constant budget',async()=>{
    const f=await fixture();let calls=0;
    const proof=validateTfliteConstants(f.model,0,()=>{calls++;assert.fail('BMM metadata must not read any weights.');},{budget:0});
    assert.equal(calls,0);assert.equal(proof.bytesRead,0);assert.equal(proof.inspectedBytes,0);assert.equal(proof.checked,1);assert.equal(proof.unchecked,0);
    assert.equal(proof.operators[0].status,'passed');assert.equal(proof.operators[0].type,name);assert.match(proof.operators[0].reason,/dtype.*shape/);
    assert.deepEqual(proof.operators[0].inputs,[0,1]);assert.deepEqual(proof.operators[0].outputs,[2]);
});

test('BMM report keeps dynamic shapes and unresolved mixed precision explicit instead of guessing',async()=>{
    for(const [spec,reason] of [[{lhs:t([2,2],0,{shape_signature:[-1,2]})},/動態|未知/],[{lhs:t([],0,{has_rank:false})},/動態|未知/],[{rhs:t([2,2],1)},/dtype|型別/]]){
        const f=await fixture(spec),p=validateTfliteConstants(f.model,0,()=>assert.fail('Unknown metadata must not cause a weight read.'));
        assert.equal(p.checked,0);assert.equal(p.unchecked,1);assert.equal(p.operators[0].status,'not-run');assert.match(p.operators[0].reason,reason);
    }
});

test('serialized BMM failures identify original tensor slots before reading payloads',async()=>{
    const f=await fixture({output:t([2,2],2)});
    assert.throws(()=>validateTfliteConstants(f.model,0,()=>assert.fail('Invalid metadata must not read weights.')),/Subgraph #0.*OP #0 BATCH_MATMUL.*inputs.*0, 1.*outputs.*2.*dtype/);
});

test('legal BMM edit roundtrip preserves adjoints, quantization, dtype and exact constant weight bytes',async()=>{
    const metadata=JSON.parse(await readFile(new URL('../vendor/netron/tflite-metadata.json',import.meta.url),'utf8'));
    for(const [x,y,out] of [[0,0,0],[0,9,0],[9,9,2],[7,9,7]]){
        const quantization={scale:Float32Array.of(1),zero_point:BigInt64Array.of(0n),quantized_dimension:0};
        const f=await fixture({lhs:t([2,2],x,{has_rank:false}),rhs:{...t([2,2],y),values:[1,0,0,1],...(y===9?{quantization}:{})},output:t([2,2],out),options:{adj_x:true,adj_y:true,asymmetric_quantize_inputs:x===0&&y===9}});
        const edited=editTfliteModel(f.index,f.file,[{graph:0,operators:[{template:0,inputs:[0,1]}]}]),bytes=new Uint8Array(await edited.blob.arrayBuffer()),r=await parseModel((o,n)=>bytes.subarray(o,o+n),bytes.length,metadata),g=r.raw.subgraphs[0];
        assert.deepEqual(g.tensors.map(t=>t.type),[x,y,out]);assert.equal(g.tensors[0].has_rank,false);assert.equal(g.operators[0].builtin_options.adj_x,true);assert.equal(g.operators[0].builtin_options.adj_y,true);assert.equal(g.operators[0].builtin_options.asymmetric_quantize_inputs,x===0&&y===9);
        const a=f.model.buffers[1],b=r.raw.buffers[1];assert.deepEqual(bytes.subarray(Number(b.offset),Number(b.offset+b.size)),f.bytes.subarray(Number(a.offset),Number(a.offset+a.size)));
        if(y===9){assert.deepEqual(g.tensors[1].quantization.scale,f.model.subgraphs[0].tensors[1].quantization.scale);assert.deepEqual(g.tensors[1].quantization.zero_point,f.model.subgraphs[0].tensors[1].quantization.zero_point);}
        assert.equal(validateTfliteConstants(r.raw,0,()=>assert.fail('No BMM weights should be read.')).checked,1);
    }
});
