import {test} from 'node:test';
import assert from 'node:assert/strict';
import {runtimeFixture} from './runtime-fixture.mjs';
import {FlatbufferWriter} from '../src/flatbuffer-writer.js';
import {BinaryReader} from '../vendor/netron/flatbuffers.js';
import {tflite as schema} from '../vendor/netron/tflite-schema.js';
const tables=bytes=>{const reader=BinaryReader.open(bytes),graph=reader.__indirect(reader.__vector(reader.root+reader.__offset(reader.root,8))),op=reader.__indirect(reader.__vector(graph+reader.__offset(graph,10))),tensor=reader.__indirect(reader.__vector(graph+reader.__offset(graph,4)));return {reader,op,tensor};};
test('only an empty custom_options field of a known builtin operator is omitted',async()=>{
    for(const [code,options,present]of [
        [{builtin_code:0,deprecated_builtin_code:0},new Uint8Array(),false],
        [{builtin_code:0,deprecated_builtin_code:0},Uint8Array.of(0),true],
        [{builtin_code:32,deprecated_builtin_code:32,custom_code:'company.zero_options'},new Uint8Array(),true],
        [{builtin_code:0,deprecated_builtin_code:32},new Uint8Array(),true],
        [{builtin_code:32,deprecated_builtin_code:0},new Uint8Array(),true],
        [{custom_code:'company.name_is_authority',builtin_code:0},new Uint8Array(),true],
        [{},new Uint8Array(),true],
    ]){
        const f=await runtimeFixture();f.model.operator_codes[0]=code;f.model.subgraphs[0].operators[0].custom_options=options;
        const bytes=new Uint8Array(await new FlatbufferWriter().finish(f.model,new Blob()).arrayBuffer()),{reader,op}=tables(bytes),decoded=schema.Model.create(reader).subgraphs[0].operators[0];
        assert.equal(!!reader.__offset(op,14),present,JSON.stringify(code));assert.deepEqual([...decoded.custom_options],[...options]);
    }
});
test('empty inline options are retained beside external payloads without changing bytes or provenance',async()=>{
    const f=await runtimeFixture(),op=f.model.subgraphs[0].operators[0];op.custom_options=new Uint8Array();op.externalRanges=[{offset:0,size:2,offsetKey:'large_custom_options_offset',sizeKey:'large_custom_options_size',kind:'custom-options-external',reference:'operator:0'}];
    const result=new FlatbufferWriter().finishArtifact(f.model,new Blob([Uint8Array.of(255,7)])),bytes=new Uint8Array(await result.blob.arrayBuffer()),{reader,op:at}=tables(bytes),decoded=schema.Model.create(reader).subgraphs[0].operators[0];
    assert.ok(reader.__offset(at,14));assert.equal(decoded.large_custom_options_size,2n);assert.deepEqual([...bytes.subarray(Number(decoded.large_custom_options_offset),Number(decoded.large_custom_options_offset+2n))],[255,7]);assert.deepEqual(result.ranges,[{sourceOffset:0,outputOffset:Number(decoded.large_custom_options_offset),bytes:2,kind:'custom-options-external',reference:'operator:0'}]);
});
test('other empty vectors keep their presence, including scalar shape and zero-input OP metadata',async()=>{
    const f=await runtimeFixture();f.model.subgraphs[0].tensors[0].shape=new Int32Array();f.model.subgraphs[0].operators[0].inputs=new Int32Array();f.model.subgraphs[0].operators[0].custom_options=new Uint8Array();
    const bytes=new Uint8Array(await new FlatbufferWriter().finish(f.model,new Blob()).arrayBuffer()),{reader,op,tensor}=tables(bytes);assert.ok(reader.__offset(op,6));assert.ok(reader.__offset(tensor,4));assert.equal(reader.__offset(op,14),0);
});
