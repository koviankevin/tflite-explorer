import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { parseModel } from '../src/model-engine.js';
import { exportTflite } from '../src/tflite-export.js';
import { customFixture } from './custom-fixture.mjs';
import { BinaryReader } from '../vendor/netron/flatbuffers.js';
const metadata = JSON.parse(await readFile(new URL('../vendor/netron/tflite-metadata.json', import.meta.url)));
const parse = (bytes) => parseModel((offset,length)=>bytes.subarray(offset,offset+length),bytes.length,metadata);

for (const external of [false,true]) test(`custom op cut preserves opaque ${external ? 'external' : 'inline'} options, ids, weights and two outputs`, async () => {
    const {bytes,options,weight} = await customFixture({external});
    const index = await parse(bytes);
    const before = index.raw.subgraphs[0].operators[1];
    const exported = exportTflite(index,0,[1],new Blob([bytes]));
    const afterBytes = new Uint8Array(await exported.blob.arrayBuffer());
    const after = await parse(afterBytes);
    assert.equal(exported.preservedIds,true);
    assert.deepEqual(exported.customOperators,['InternalSplitFoo']);
    assert.equal(after.raw.subgraphs[0].operators.length,1);
    const op = after.raw.subgraphs[0].operators[0];
    assert.deepEqual([...op.inputs],[4,5,-1]);
    assert.deepEqual([...op.outputs],[7,8]);
    assert.deepEqual([...op.intermediates],[6]);
    assert.deepEqual(op.mutating_variable_inputs,before.mutating_variable_inputs);
    assert.deepEqual([...after.raw.subgraphs[0].inputs],[4]);
    assert.deepEqual([...after.raw.subgraphs[0].outputs],[7,8]);
    assert.deepEqual(after.raw.operator_codes[1],index.raw.operator_codes[1]);
    assert.equal(after.raw.subgraphs[0].tensors.length,10);
    assert.equal(after.raw.subgraphs[0].tensors[5].buffer,3);
    assert.equal(after.raw.subgraphs[0].tensors[7].quantization.scale[0],.25);
    assert.deepEqual(after.raw.metadata,index.raw.metadata);
    assert.deepEqual(after.raw.metadata_buffer,index.raw.metadata_buffer);
    assert.equal(after.raw.buffers.length,index.raw.buffers.length);
    for(let b=1;b<after.raw.buffers.length;b++) {
        const original=index.raw.buffers[b], copied=after.raw.buffers[b];
        assert.deepEqual(afterBytes.subarray(Number(copied.offset),Number(copied.offset+copied.size)),bytes.subarray(Number(original.offset),Number(original.offset+original.size)));
    }
    const copiedWeight = after.raw.buffers[3];
    assert.deepEqual(afterBytes.subarray(Number(copiedWeight.offset),Number(copiedWeight.offset+copiedWeight.size)),weight);
    if(external) {
        const start=Number(op.large_custom_options_offset),size=Number(op.large_custom_options_size);
        assert.equal(start%16,0);
        assert.notEqual(op.large_custom_options_offset,before.large_custom_options_offset);
        assert.equal(size,options.length);
        assert.deepEqual(afterBytes.subarray(start,start+size),options);
        assert.equal(op.custom_options.length,0);
    } else assert.deepEqual(op.custom_options,options);
    assert.equal(index.raw.subgraphs[0].operators.length,3);
    assert.deepEqual(before.inputs,Int32Array.of(4,5,-1));
});

test('large inline custom options stay lazy and export byte-for-byte as an external range', async () => {
    const options=Uint8Array.from({length:2*1024*1024},(_,i)=>(i*17)%256);
    const {bytes}=await customFixture({optionBytes:options});
    const index=await parse(bytes);
    assert.equal(index.raw.subgraphs[0].operators[1].customOptionsDeferred,true);
    assert.equal(index.raw.subgraphs[0].operators[1].custom_options.length,0);
    assert.ok(index.stats.bytesRead < 512*1024, `initial read ${index.stats.bytesRead}`);
    const result=exportTflite(index,0,[1],new Blob([bytes]));
    const exported=new Uint8Array(await result.blob.arrayBuffer());
    const after=await parse(exported);
    const op=after.raw.subgraphs[0].operators[0];
    assert.equal(op.customOptionsInline,false);
    assert.equal(Number(op.large_custom_options_size),options.length);
    assert.deepEqual(exported.subarray(Number(op.large_custom_options_offset),Number(op.large_custom_options_offset+op.large_custom_options_size)),options);
});

test('custom and builtin operators can be cut together with correct external boundaries', async () => {
    const {bytes,options}=await customFixture();
    const index=await parse(bytes);
    const result=exportTflite(index,0,[2,1,1],new Blob([bytes]));
    const after=await parse(new Uint8Array(await result.blob.arrayBuffer()));
    const graph=after.raw.subgraphs[0];
    assert.equal(graph.operators.length,2);
    assert.deepEqual([...graph.inputs],[4]);
    assert.deepEqual([...graph.outputs],[9]);
    assert.deepEqual(graph.operators[0].custom_options,options);
    assert.deepEqual([...graph.operators[1].inputs],[7,8]);
    assert.deepEqual(graph.operators[1].builtin_options,index.raw.subgraphs[0].operators[2].builtin_options);
});

test('inline options keep runtime precedence when external options also exist', async () => {
    for(const inline of [new Uint8Array(),Uint8Array.of(33,0,4)]) {
        const {bytes}=await customFixture({external:true,inlineWithExternal:inline});
        const index=await parse(bytes);
        const result=exportTflite(index,0,[1],new Blob([bytes]));
        const after=await parse(new Uint8Array(await result.blob.arrayBuffer()));
        const op=after.raw.subgraphs[0].operators[0];
        assert.equal(op.customOptionsInline,true);
        assert.deepEqual(op.custom_options,inline);
    }
});

test('custom options beyond 2 GiB relocate with 64-bit offsets without reading the large gap', async () => {
    const {bytes,options}=await customFixture({external:true});
    const r=BinaryReader.open(bytes);
    const graph=r.__indirect(r.__vector(r.root+r.__offset(r.root,8)));
    const op=r.__indirect(r.__vector(graph+r.__offset(graph,10))+4);
    const sourceOffset=3*1024*1024*1024;
    new DataView(bytes.buffer).setBigUint64(op+r.__offset(op,22),BigInt(sourceOffset),true);
    const size=sourceOffset+options.length;
    const read=(offset,length)=>{
        const result=new Uint8Array(length);
        if(offset<bytes.length) result.set(bytes.subarray(offset,Math.min(offset+length,bytes.length)));
        if(offset<=sourceOffset && offset+length>sourceOffset) result.set(options.subarray(0,Math.min(options.length,offset+length-sourceOffset)),sourceOffset-offset);
        return result;
    };
    const index=await parseModel(read,size,metadata);
    assert.ok(index.stats.bytesRead<512*1024);
    const slices=[];
    const file={size,slice:(start,end)=>{slices.push([start,end]);return new Blob([read(start,end-start)]);}};
    const result=exportTflite(index,0,[1],file);
    assert.ok(slices.some(([start,end])=>start===sourceOffset&&end===size));
    const exported=new Uint8Array(await result.blob.arrayBuffer());
    const after=await parse(exported);
    const copied=after.raw.subgraphs[0].operators[0];
    assert.deepEqual(exported.subarray(Number(copied.large_custom_options_offset),Number(copied.large_custom_options_offset+copied.large_custom_options_size)),options);
    index.raw.subgraphs[0].operators[1].large_custom_options_offset=BigInt(size+1);
    assert.throws(()=>exportTflite(index,0,[1],file),/資料範圍/);
});
