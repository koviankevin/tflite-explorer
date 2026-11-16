import test from 'node:test';
import assert from 'node:assert/strict';
import {axisTransformFixture} from './axis-transform-fixture.mjs';
import {validateTfliteConstants} from '../src/tflite-constant-checks.js';
import {checkOperatorMetadata} from '../src/tflite-semantic-checks.js';
import {prepareTfliteModelEdit} from '../src/tflite-model-edit.js';
import {editTfliteModel} from '../src/tflite-model-edit.js';
import {parseModel} from '../src/model-engine.js';
import {readFile} from 'node:fs/promises';
const metadata=JSON.parse(await readFile(new URL('../vendor/netron/tflite-metadata.json',import.meta.url),'utf8'));

for(const axisShape of [[1,2],[2,1]])test('TRANSPOSE rejects serialized non-vector permutation '+axisShape,async()=>{
    const f=await axisTransformFixture({axisShape});
    assert.throws(()=>validateTfliteConstants(f.model,0,()=>assert.fail('Invalid metadata must precede payload reads.')),/Subgraph #0.*OP #0.*TRANSPOSE.*permutation.*一維/);
    assert.throws(()=>prepareTfliteModelEdit(f.index,f.file,[{graph:0,operators:[{template:0,inputs:[0,1],outputs:[2]}]}]),/TRANSPOSE.*permutation.*一維/);
});

test('TRANSPOSE checks permutation rank and declared length even for dynamic data',()=>{
    const input={type:0,shape:[2,3],shape_signature:[-1,3]},out={type:0,shape:[3,2]};
    for(const shape of [[],[1,2]])assert.throws(()=>checkOperatorMetadata('TRANSPOSE',[input,{type:2,shape}], [out]),/TRANSPOSE.*permutation.*一維/);
    assert.throws(()=>checkOperatorMetadata('TRANSPOSE',[input,{type:2,shape:[3]}],[out]),/TRANSPOSE.*permutation.*rank/);
});

test('EXPAND_DIMS rejects noninteger axis metadata even when input shape is dynamic',async()=>{
    const f=await axisTransformFixture({name:'EXPAND_DIMS',axes:[1],axisShape:[],axisType:0,input:[2,3],output:[2,1,3],dynamic:true});
    assert.throws(()=>validateTfliteConstants(f.model,0,()=>assert.fail('Invalid dtype must precede payload reads.')),/Subgraph #0.*OP #0.*EXPAND_DIMS.*axis.*int32.*int64/);
    assert.throws(()=>prepareTfliteModelEdit(f.index,f.file,[{graph:0,operators:[{template:0,inputs:[0,1],outputs:[2]}]}]),/EXPAND_DIMS.*axis.*int32.*int64/);
});

test('EXPAND_DIMS rejects known axis count and output rank contradictions before constant reads',async()=>{
    const multiple=await axisTransformFixture({name:'EXPAND_DIMS',axes:[0,1],axisShape:[2],output:[1,2,3],dynamic:true});
    assert.throws(()=>validateTfliteConstants(multiple.model,0,()=>assert.fail('Invalid axis count must precede payload reads.')),/EXPAND_DIMS.*axis.*1 個元素/);
    const rank=await axisTransformFixture({name:'EXPAND_DIMS',axes:[1],axisShape:[1],output:[2,3],dynamic:true});
    assert.throws(()=>validateTfliteConstants(rank.model,0,()=>assert.fail('Invalid rank must precede payload reads.')),/EXPAND_DIMS.*output rank/);
});

for(const options of [{axes:[-1,0]},{name:'EXPAND_DIMS',axes:[-1],axisShape:[],axisType:4,output:[2,3,1]},{name:'EXPAND_DIMS',axes:[0],axisShape:[1,1],output:[1,2,3]}])test('legal axis metadata survives edit, serialized proof and byte-preserving reopen '+JSON.stringify(options),async()=>{
    const f=await axisTransformFixture(options),before=f.bytes.slice(),g=f.model.subgraphs[0];
    const edited=editTfliteModel(f.index,f.file,[{graph:0,tensors:[{like:2,name:'copy'}],operators:[{template:0,inputs:[0,1],outputs:[2]},{template:0,inputs:[0,1],outputs:[3]}],outputs:[2,3]}]);
    const bytes=new Uint8Array(await edited.blob.arrayBuffer()),read=(o,n)=>bytes.subarray(o,o+n),reopened=await parseModel(read,bytes.length,metadata);
    const proof=validateTfliteConstants(reopened.raw,0,read);assert.equal(proof.checked,2);assert.equal(proof.unchecked,0);
    const original=g.tensors[1],buffer=f.model.buffers[original.buffer],next=reopened.raw.subgraphs[0],copied=next.tensors[next.operators[0].inputs[1]],b=reopened.raw.buffers[copied.buffer];
    assert.equal(copied.type,original.type);assert.deepEqual(Array.from(copied.shape),Array.from(original.shape));
    assert.deepEqual(read(Number(b.offset),Number(b.size)),f.read(Number(buffer.offset),Number(buffer.size)));assert.deepEqual(f.bytes,before);
});

test('legal runtime parameters and partial metadata remain unverified without payload reads',async()=>{
    for(const options of [{axisInput:true},{dynamic:true},{name:'EXPAND_DIMS',axes:[0],axisShape:[1],output:[1,2,3],axisInput:true}]){
        const f=await axisTransformFixture(options),proof=validateTfliteConstants(f.model,0,()=>assert.fail('Dynamic parameters cannot be read as constants.'));
        assert.equal(proof.checked,0);assert.equal(proof.unchecked,1);assert.equal(proof.bytesRead,0);
    }
    const f=await axisTransformFixture();f.model.subgraphs[0].tensors[1].shape_signature=Int32Array.of(-1);
    assert.equal(validateTfliteConstants(f.model,0,()=>assert.fail('Unknown operand length cannot be inspected.')).unchecked,1);
});

test('known shape and dtype contradictions are checked without confusing unknown rank with scalar',()=>{
    const t=(shape,type=0)=>({shape,type,has_rank:true});
    assert.throws(()=>checkOperatorMetadata('TRANSPOSE',[t([2,3]),t([2],2)],[t([6])]),/TRANSPOSE.*output rank/);
    assert.throws(()=>checkOperatorMetadata('EXPAND_DIMS',[t([2]),t([1],2)],[t([1,2],9)]),/EXPAND_DIMS.*dtype/);
    assert.doesNotThrow(()=>checkOperatorMetadata('TRANSPOSE',[{...t([]),has_rank:false},t([2],2)],[{...t([]),has_rank:false}]));
    assert.doesNotThrow(()=>checkOperatorMetadata('TRANSPOSE',[t([]),t([0],2)],[t([])]));
    assert.doesNotThrow(()=>checkOperatorMetadata('EXPAND_DIMS',[t([]),t([],4)],[t([1])]));
    assert.throws(()=>checkOperatorMetadata('EXPAND_DIMS',[t([2]),t([0],2)],[t([1,2])]),/axis.*1 個元素/);
    assert.throws(()=>checkOperatorMetadata('TRANSPOSE',[t([2])],[t([2])]),/2 個完整輸入/);
});
