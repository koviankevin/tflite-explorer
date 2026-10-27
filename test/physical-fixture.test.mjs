import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {physicalFixtureHeader,writePhysicalFixture,PHYSICAL_OPTIONS} from './physical-tflite-fixture.mjs';
import {parseModel} from '../src/model-engine.js';
import {exportTflite} from '../src/tflite-export.js';
const metadata=JSON.parse(await readFile(new URL('../vendor/netron/tflite-metadata.json',import.meta.url)));
const parse=bytes=>parseModel((offset,length)=>bytes.subarray(offset,offset+length),bytes.length,metadata);
test('physical corpus has the fixed full scale before allocating weight storage',async()=>{
    const f=await physicalFixtureHeader();assert.equal(f.operators,21005);assert.equal(f.tensors,21011);assert.equal(f.payloadOffset,7787936);assert.equal(f.payloadOffset+f.weightBytes,1349965216);
});
test('small generator unit case writes real weights and custom branch export preserves ids/options/boundaries',async()=>{
    const dir=await mkdtemp(path.join(os.tmpdir(),'physical-fixture-unit-'));
    try{
        const f=await writePhysicalFixture(path.join(dir,'fixture.tflite'),{repeats:2,weightBytes:4096});assert.equal(f.sha256,f.readbackSHA256);
        const bytes=await readFile(f.file),index=await parse(bytes);assert.equal(index.raw.subgraphs[0].operators.length,11);
        for(const [nodes,outputs] of [[[0,1,2,3],1],[[7,8,9,10],2]]){
            const result=exportTflite(index,0,nodes,new Blob([bytes])),copy=new Uint8Array(await result.blob.arrayBuffer()),after=await parse(copy),g=after.raw.subgraphs[0];
            assert.equal(g.operators.length,4);assert.equal(g.outputs.length,outputs);assert.equal(after.raw.buffers.length,5);assert.equal(g.tensors.length,17);
            const custom=g.operators.find(op=>op.opcode_index===0||op.opcode_index===5);assert.deepEqual(custom.custom_options,PHYSICAL_OPTIONS);
            const b=after.raw.buffers[1];assert.equal(Number(b.size),4096);assert.deepEqual(copy.subarray(Number(b.offset),Number(b.offset+b.size)),new Uint8Array(bytes.subarray(f.payloadOffset)));
        }
    }finally{await rm(dir,{recursive:true,force:true});}
});
