import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {runtimeFixture} from './runtime-fixture.mjs';
import {FlatbufferWriter} from '../src/flatbuffer-writer.js';
import {BinaryReader} from '../vendor/netron/flatbuffers.js';
import {parseModel} from '../src/model-engine.js';
import {editTfliteModel} from '../src/tflite-model-edit.js';
import {exportTflite} from '../src/tflite-export.js';
import {editWorkspaceSnapshot,exportEditWorkspace} from '../src/model-edit-workspace.js';
import {modelEditDraft} from '../src/model-edit-draft.js';
const metadata=JSON.parse(await readFile(new URL('../vendor/netron/tflite-metadata.json',import.meta.url),'utf8'));
const parse=b=>parseModel((o,n)=>b.subarray(o,o+n),b.length,metadata);
const presence=bytes=>{const r=BinaryReader.open(bytes);return r.tables(r.root,12,{decode:(reader,position)=>Boolean(reader.__offset(position,4))});};
async function fixture(){
    const {model}=await runtimeFixture();
    model.buffers.push({data:null,offset:0n,size:0n},{data:new Uint8Array(),offset:0n,size:0n});
    // Real converters may give runtime activation tensors distinct, absent-data
    // Buffer tables instead of referencing the reserved buffer zero.
    for(const t of model.subgraphs[0].tensors)t.buffer=1;
    const blob=new FlatbufferWriter().finish(model,new Blob()),bytes=new Uint8Array(await blob.arrayBuffer());
    assert.deepEqual(presence(bytes),[true,false,true]);return {bytes,file:new File([blob],'absent-buffer.tflite'),index:await parse(bytes)};
}
test('full model edit preserves absent versus explicitly empty Buffer.data vectors',async()=>{
    const f=await fixture(),result=editTfliteModel(f.index,f.file,[{graph:0,operators:[{template:0,inputs:[0,1]}]}]);
    const bytes=new Uint8Array(await result.blob.arrayBuffer());assert.deepEqual(presence(bytes),[true,false,true]);
    const reopened=await parse(bytes);assert.equal(reopened.raw.subgraphs[0].tensors[2].buffer,1);
});
test('submodel cut never turns an absent runtime buffer into a zero-byte constant',async()=>{
    const f=await fixture(),result=exportTflite(f.index,0,[0],f.file);
    assert.deepEqual(presence(new Uint8Array(await result.blob.arrayBuffer())),[true,false]);
});
test('composition export preserves absent runtime buffers through prepare and compaction',async()=>{
    const f=await fixture(),snapshot=editWorkspaceSnapshot(f.index,{targets:[{graph:0,node:0}],composition:true}),draft=modelEditDraft(snapshot);
    draft.apply({kind:'import',node:'op:0:0',nodes:['op:0:0'],label:'public A'});
    const result=await exportEditWorkspace(f.index,f.file,snapshot,draft.commands);
    assert.deepEqual(presence(new Uint8Array(await result.blob.arrayBuffer())),[true,false]);
});
