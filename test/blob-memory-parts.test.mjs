import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {physicalFixtureHeader} from './physical-tflite-fixture.mjs';
import {memoryBlobParts,exportMemoryBlob,prepareExportResult} from '../src/blob-memory-parts.js';
import {parseModel} from '../src/model-engine.js';
import {editTfliteModel} from '../src/tflite-model-edit.js';
import {exportTflite} from '../src/tflite-export.js';

test('real TFLite writer avoids large memory Blob components without changing the physical fixture header bytes',async()=>{
    const NativeBlob=globalThis.Blob,calls=[];
    class ObservedBlob extends NativeBlob{constructor(parts=[],options){super(parts,options);calls.push(parts);}}
    let f;try{globalThis.Blob=ObservedBlob;f=await physicalFixtureHeader();}finally{globalThis.Blob=NativeBlob;}
    assert.equal(f.header.length,7787928);assert.equal(createHash('sha256').update(f.header).digest('hex'),'dd3531a96a0148db3a3a02fd94524dbb6f96b4123630b36a2b43ef172c25d826');
    assert.ok(calls.every(parts=>parts.every(p=>!ArrayBuffer.isView(p)||p.byteLength<=65536)),'Large typed header must reach the final Blob as bounded Blob components, not one multi-megabyte memory part.');
    assert.ok(calls.some(parts=>parts.filter(p=>p instanceof NativeBlob).length>100));
});

test('actual full-model and custom cut writers prepare only serialized metadata, preserving all bytes and provenance',async()=>{
    const f=await physicalFixtureHeader({repeats:500,weightBytes:256}),bytes=new Uint8Array(f.payloadOffset+f.weightBytes);bytes.set(f.header);bytes.fill(173,f.payloadOffset);
    const metadata=JSON.parse(await readFile(new URL('../vendor/netron/tflite-metadata.json',import.meta.url))),index=await parseModel((o,n)=>bytes.subarray(o,o+n),bytes.length,metadata),file=new Blob([bytes]);
    const full=editTfliteModel(index,file,[{graph:0,operators:index.raw.subgraphs[0].operators.map((_,template)=>({template}))}]),cut=exportTflite(index,0,[0],file);
    for(const original of [full,cut]){
        const requests=[];class Response{constructor(body){requests.push(body);}blob(){return new globalThis.Response(requests.at(-1)).blob();}}
        const prepared=await prepareExportResult(original,Response);assert.equal(requests.length,1);assert.ok(requests[0].size>65536&&requests[0].size<original.blob.size);
        assert.notEqual(prepared.blob,original.blob);assert.equal(prepared.blob.type,original.blob.type);assert.deepEqual(new Uint8Array(await prepared.blob.arrayBuffer()),new Uint8Array(await original.blob.arrayBuffer()));
        assert.deepEqual({...prepared,blob:null},{...original,blob:null});assert.equal(await prepareExportResult(prepared,Response),prepared);assert.equal(requests.length,1);
        const output=new Uint8Array(await prepared.blob.arrayBuffer()),after=await parseModel((o,n)=>output.subarray(o,o+n),output.length,metadata),weight=after.raw.buffers[1];
        assert.deepEqual(output.subarray(Number(weight.offset),Number(weight.offset+weight.size)),bytes.subarray(f.payloadOffset));assert.deepEqual(after.raw.subgraphs[0].operators[0].custom_options,index.raw.subgraphs[0].operators[0].custom_options);
    }
});

test('prefix preparation leaves small/unrelated exports alone and reports conversion failures without publishing a body',async()=>{
    const small={blob:exportMemoryBlob(new Uint8Array(65536),[])},unrelated={blob:new Blob(['MLIR'])};
    assert.equal(await prepareExportResult(small,null),small);assert.equal(await prepareExportResult(unrelated,null),unrelated);
    const original={blob:exportMemoryBlob(new Uint8Array(65537),[new Blob(['tail'])])};
    await assert.rejects(prepareExportResult(original,null),/缺少/);
    class Failure{async blob(){throw Error('conversion failed');}}await assert.rejects(prepareExportResult(original,Failure),/conversion failed/);
    class Short{async blob(){return new Blob(['short']);}}await assert.rejects(prepareExportResult(original,Short),/轉換不完整/);
    const retry=await prepareExportResult(original);assert.equal(retry.blob.size,original.blob.size);assert.equal(original.blob.size,65541);
});

test('bounded memory Blob components preserve exact bytes across boundaries and leave small headers simple',async()=>{
    const bytes=Uint8Array.from({length:3*65536+19},(_,i)=>(i*17+3)&255),parts=memoryBlobParts(bytes);
    assert.equal(parts.length,4);assert.ok(parts.every(p=>p instanceof Blob&&p.size<=65536));
    assert.deepEqual(new Uint8Array(await new Blob(parts).arrayBuffer()),bytes);
    const small=bytes.subarray(0,65536);assert.equal(memoryBlobParts(small)[0],small);assert.equal(memoryBlobParts(new Uint8Array())[0].length,0);
    for(const invalid of [null,new Int32Array(1),new Uint8Array(64*1024**2+1)])assert.throws(()=>memoryBlobParts(invalid),/結構資料/);
});
