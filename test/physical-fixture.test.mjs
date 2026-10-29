import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {physicalFixtureHeader,writePhysicalFixture,PHYSICAL_OPTIONS} from './physical-tflite-fixture.mjs';
import {parseModel} from '../src/model-engine.js';
import {exportTflite} from '../src/tflite-export.js';
import {editWorkspaceSnapshot,exportEditWorkspace} from '../src/model-edit-workspace.js';
import {modelEditDraft} from '../src/model-edit-draft.js';
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

test('21,005-OP composition contract joins distant fragments with the expected new tensor and explicit interface (64-byte payload only)',async()=>{
    const f=await physicalFixtureHeader({weightBytes:64}),file=new File([f.header,new Uint8Array(f.payloadOffset-f.header.length),Uint8Array.from({length:64},(_,i)=>i)],'composition-contract.tflite'),bytes=new Uint8Array(await file.arrayBuffer()),index=await parse(bytes);
    const selections=[[0,1,2,3],[21001,21002,21003,21004]],snapshot=editWorkspaceSnapshot(index,{targets:selections.flat().map(node=>({graph:0,node})),composition:true}),draft=modelEditDraft(snapshot);
    for(const [i,nodes] of selections.entries())draft.apply({kind:'import',node:`op:0:${nodes[0]}`,nodes:nodes.map(n=>`op:0:${n}`),label:i?'B':'A'});
    draft.apply({kind:'wire',node:'op:0:21001',slot:0,value:'t:0:8'});draft.apply({kind:'clone',node:'op:0:21004',side:'after'});for(const slot of [0,1])draft.apply({kind:'wire',node:'new:1',slot,value:'t:0:21010'});draft.apply({kind:'interface',node:'new:1',side:'outputs',value:'t:0:21010',enabled:false});
    const result=await exportEditWorkspace(index,file,snapshot,draft.commands),out=await parse(new Uint8Array(await result.blob.arrayBuffer())),g=out.raw.subgraphs[0];
    assert.equal(draft.commands.length,7);assert.equal(g.operators.length,9);assert.equal(g.tensors.length,21012);assert.deepEqual([...g.inputs],[0]);assert.deepEqual([...g.outputs],[21009,21011]);assert.deepEqual([...g.operators[4].inputs],[8,4]);assert.deepEqual([...g.operators[8].inputs],[21010,21010]);for(const code of [0,5])assert.deepEqual(g.operators.find(op=>op.opcode_index===code).custom_options,PHYSICAL_OPTIONS);
    const weight=out.raw.buffers[1];assert.equal(Number(weight.size),64);assert.deepEqual(new Uint8Array(await result.blob.slice(Number(weight.offset),Number(weight.offset+weight.size)).arrayBuffer()),Uint8Array.from({length:64},(_,i)=>i));
});
