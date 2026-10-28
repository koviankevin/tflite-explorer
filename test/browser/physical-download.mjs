// Exact physical payload checks shared by the new desktop acceptance driver.
// The body comes from the authenticated da70c88 Chromium lifecycle verifier.
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {openSync,readSync,fstatSync,closeSync,createReadStream} from 'node:fs';
import {createHash} from 'node:crypto';
import {parseModel} from '../../src/model-engine.js';
import {PHYSICAL_OPTIONS,PHYSICAL_WEIGHT_BYTES,PHYSICAL_WEIGHT_SHA256} from '../physical-tflite-fixture.mjs';
import {DESKTOP_PHYSICAL_POLICY as policy} from '../../scripts/lib/desktop-physical-policy.mjs';
import {editFileFingerprint} from '../../src/model-edit-session.js';
export async function fingerprintPhysicalSource(filename){
    const fd=openSync(filename,'r');try{const size=fstatSync(fd).size;return await editFileFingerprint({size,slice(start,end){assert.ok(end-start<=1024**2);return {async arrayBuffer(){const bytes=new Uint8Array(end-start);assert.equal(readSync(fd,bytes,0,bytes.length,start),bytes.length);return bytes.buffer;}};}});}finally{closeSync(fd);}
}
export async function verifyPhysicalDownload(filename,kind,fullEdit=false){
    const fd=openSync(filename,'r');let index,readBytes=0,maxRead=0;
    try{
        const size=fstatSync(fd).size;assert.ok(size>1024**3);
        const metadata=JSON.parse(await readFile('vendor/netron/tflite-metadata.json','utf8'));
        index=await parseModel((at,length)=>{
            readBytes+=length;maxRead=Math.max(maxRead,length);assert.ok(length<=policy.maxReadBytes&&readBytes<=policy.realmReadBytes);
            const bytes=new Uint8Array(length);assert.equal(readSync(fd,bytes,0,length,at),length);return bytes;
        },size,metadata);
    }finally{closeSync(fd);}
    const graph=index.raw.subgraphs[0];assert.equal(graph.operators.length,fullEdit?21006:4);assert.equal(graph.tensors.length,21012);assert.equal(graph.inputs.length,1);assert.equal(graph.outputs.length,fullEdit?3:kind===0?1:2);assert.equal(index.raw.buffers.length,5);
    const custom=graph.operators.find(op=>op.opcode_index===(kind===0?0:5));assert.ok(custom);assert.deepEqual(custom.custom_options,PHYSICAL_OPTIONS);
    assert.deepEqual([...graph.operators[0].inputs],kind===0?[0,1]:[21005,4]);
    if(fullEdit){assert.deepEqual([...graph.operators[1].inputs],[0,1]);assert.deepEqual([...graph.operators[1].outputs],[21011]);assert.deepEqual([...graph.operators[2].inputs],[5,2]);assert.equal(graph.tensors[21011].name,'projected_input_edit_1_0');assert.equal(graph.operators.filter(op=>op.opcode_index===0).length,2);for(const op of graph.operators.filter(op=>[0,5].includes(op.opcode_index)))assert.deepEqual(op.custom_options,PHYSICAL_OPTIONS);}
    const weight=index.raw.buffers[1];assert.equal(Number(weight.size),PHYSICAL_WEIGHT_BYTES);
    const whole=createHash('sha256'),hash=createHash('sha256');let offset=0;
    const start=Number(weight.offset),end=Number(weight.offset+weight.size);
    for await(const chunk of createReadStream(filename,{highWaterMark:1024**2})){
        whole.update(chunk);const left=Math.max(0,start-offset),right=Math.min(chunk.length,end-offset);if(right>left)hash.update(chunk.subarray(left,right));offset+=chunk.length;
    }
    const weightSHA256=hash.digest('hex');assert.equal(weightSHA256,PHYSICAL_WEIGHT_SHA256);
    for(const [id,expected] of [[2,new Uint8Array(Int32Array.of(1,2).buffer)],[3,new Uint8Array(Int32Array.of(0,1).buffer)],[4,new Uint8Array(Float32Array.of(2,3).buffer)]]){
        const b=index.raw.buffers[id],small=openSync(filename,'r');try{const bytes=new Uint8Array(Number(b.size));assert.equal(readSync(small,bytes,0,bytes.length,Number(b.offset)),bytes.length);assert.deepEqual(bytes,expected);}finally{closeSync(small);}
    }
    return {bytes:offset,sha256:whole.digest('hex'),weightSHA256,readBytes,maxRead,operators:graph.operators.length,inputs:[...graph.inputs],outputs:[...graph.outputs],weightVerified:true,optionsVerified:true};
}
