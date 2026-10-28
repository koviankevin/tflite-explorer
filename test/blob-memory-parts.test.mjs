import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {physicalFixtureHeader} from './physical-tflite-fixture.mjs';
import {memoryBlobParts} from '../src/blob-memory-parts.js';

test('real TFLite writer avoids large memory Blob components without changing the physical fixture header bytes',async()=>{
    const NativeBlob=globalThis.Blob,calls=[];
    class ObservedBlob extends NativeBlob{constructor(parts=[],options){super(parts,options);calls.push(parts);}}
    let f;try{globalThis.Blob=ObservedBlob;f=await physicalFixtureHeader();}finally{globalThis.Blob=NativeBlob;}
    assert.equal(f.header.length,7787928);assert.equal(createHash('sha256').update(f.header).digest('hex'),'dd3531a96a0148db3a3a02fd94524dbb6f96b4123630b36a2b43ef172c25d826');
    assert.ok(calls.every(parts=>parts.every(p=>!ArrayBuffer.isView(p)||p.byteLength<=65536)),'Large typed header must reach the final Blob as bounded Blob components, not one multi-megabyte memory part.');
    assert.ok(calls.some(parts=>parts.filter(p=>p instanceof NativeBlob).length>100));
});

test('bounded memory Blob components preserve exact bytes across boundaries and leave small headers simple',async()=>{
    const bytes=Uint8Array.from({length:3*65536+19},(_,i)=>(i*17+3)&255),parts=memoryBlobParts(bytes);
    assert.equal(parts.length,4);assert.ok(parts.every(p=>p instanceof Blob&&p.size<=65536));
    assert.deepEqual(new Uint8Array(await new Blob(parts).arrayBuffer()),bytes);
    const small=bytes.subarray(0,65536);assert.equal(memoryBlobParts(small)[0],small);assert.equal(memoryBlobParts(new Uint8Array())[0].length,0);
    for(const invalid of [null,new Int32Array(1),new Uint8Array(64*1024**2+1)])assert.throws(()=>memoryBlobParts(invalid),/結構資料/);
});
