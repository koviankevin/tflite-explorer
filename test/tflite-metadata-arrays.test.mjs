import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {fixture} from './fixture.mjs';
import {parseModel,snapshot} from '../src/model-engine.js';
import {BinaryReader} from '../vendor/netron/flatbuffers.js';
import {tflite as schema} from '../vendor/netron/tflite-schema.js';
import {installTfliteMetadataArrays} from '../src/tflite-metadata-arrays.js';
import {physicalFixtureHeader} from './physical-tflite-fixture.mjs';
const metadata=JSON.parse(await readFile(new URL('../vendor/netron/tflite-metadata.json',import.meta.url),'utf8'));
const open=async()=>{const f=fixture({graphCount:2,repeats:24}),bytes=new Uint8Array(f.totalBytes);bytes.set(f.data);return {bytes,index:await parseModel((o,n)=>bytes.subarray(o,o+n),bytes.length,metadata)};};
function vectors(value,path='',result=new Map()){
    if(value instanceof Int32Array)result.set(path,value);
    else if(value&&typeof value==='object'&&!ArrayBuffer.isView(value))for(const [name,child]of Object.entries(value))vectors(child,path+'.'+name,result);
    return result;
}

test('small metadata vectors use bounded storage instead of one backing buffer per field',async()=>{
    const {index}=await open(),all=[...vectors(index.raw).values()];assert.ok(all.length>500);
    assert.equal(new Set(all).size,all.length,'Every field keeps its own typed-array view.');
    const buffers=new Set(all.map(v=>v.buffer));assert.ok(buffers.size<=4,`Small metadata occupies ${buffers.size} buffers for ${all.length} views.`);
});

test('real parser preserves every generated-schema Int32 value, view mutations, clone contents and reader isolation',async()=>{
    const {bytes,index}=await open(),expected=vectors(schema.Model.create(BinaryReader.open(bytes))),actual=vectors(index.raw);
    assert.deepEqual([...actual.keys()],[...expected.keys()]);for(const [path,value]of actual)assert.deepEqual([...value],[...expected.get(path)],path);
    const nonempty=[...actual.values()].filter(v=>v.length),snapshots=nonempty.map(v=>[...v]),first=nonempty[0],saved=first[0];first[0]=123456;
    for(let i=1;i<nonempty.length;i++)assert.deepEqual([...nonempty[i]],snapshots[i]);first[0]=saved;
    assert.deepEqual(structuredClone(nonempty).map(v=>[...v]),snapshots);
    const other=await open(),otherBuffers=new Set([...vectors(other.index.raw).values()].map(v=>v.buffer));for(const v of actual.values())assert.equal(otherBuffers.has(v.buffer),false);
});

test('real model graph DTO normalizes metadata values without exposing arena views to the main thread',async()=>{
    const f=await physicalFixtureHeader({repeats:2,weightBytes:4}),bytes=new Uint8Array(f.payloadOffset+f.weightBytes);bytes.set(f.header);
    const index=await parseModel((o,n)=>bytes.subarray(o,o+n),bytes.length,metadata),dto=snapshot(index,0,[1,2,3]);
    assert.equal(vectors(dto.graph).size,0);
    assert.ok(dto.graph.nodes.some(n=>n.attributes.some(a=>a.name==='new_shape'&&Array.isArray(a.value))));
    const clone=structuredClone(dto);assert.deepEqual(clone,dto);
});

function readerFixture(length){
    const source=Int32Array.from({length},(_,i)=>i+100),reader={fallbacks:0,present:true,
        array(position,offset,type){this.fallbacks++;return new type(source);},
        __offset(){return this.present?4:0;},__vector_len(){return source.length;},__vector(){return 0;},
        _read(target,offset){assert.equal(offset,0);target.set(new Uint8Array(source.buffer));}
    };
    return reader;
}

test('metadata storage rolls pages without overlap and falls back once its bounded budget is exhausted',()=>{
    const reader=readerFixture(4096);installTfliteMetadataArrays(reader);
    const views=Array.from({length:513},()=>reader.array(0,4,Int32Array));
    assert.equal(reader.fallbacks,1);assert.equal(new Set(views.map(v=>v.buffer)).size,129);
    assert.deepEqual(views.slice(0,5).map(v=>v.byteOffset),[0,16384,32768,49152,0]);
    assert.equal(views[0].buffer,views[3].buffer);assert.notEqual(views[3].buffer,views[4].buffer);
    views[1][0]=-77;for(let i=0;i<views.length;i++)if(i!==1)assert.equal(views[i][0],100);
    for(const v of views){assert.equal(v.length,4096);assert.equal(v.at(-1),4195);}
    assert.equal(views.at(-1).buffer.byteLength,16384,'Fallback keeps the original owned vector.');
});

test('empty fields, other dtypes, large vectors and readers without a direct read path retain their semantics',()=>{
    const empty=readerFixture(0);installTfliteMetadataArrays(empty);
    const first=empty.array(0,4,Int32Array);empty.present=false;const second=empty.array(0,4,Int32Array);
    assert.notEqual(first,second);assert.equal(first.buffer,second.buffer);assert.equal(first.buffer.byteLength,0);assert.equal(empty.fallbacks,0);assert.throws(()=>first.set([1]),RangeError);
    const large=readerFixture(4097);installTfliteMetadataArrays(large);const actual=large.array(0,4,Int32Array);assert.equal(large.fallbacks,1);assert.equal(actual.length,4097);assert.equal(actual.at(-1),4196);
    const other=readerFixture(2);installTfliteMetadataArrays(other);assert.deepEqual([...other.array(0,4,Float32Array)],[100,101]);assert.equal(other.fallbacks,1);
    const indirect=readerFixture(2);delete indirect._read;installTfliteMetadataArrays(indirect);assert.deepEqual([...indirect.array(0,4,Int32Array)],[100,101]);assert.equal(indirect.fallbacks,1);
    const failed=readerFixture(2),reason=new Error('original direct read failure');failed._read=()=>{throw reason;};installTfliteMetadataArrays(failed);assert.throws(()=>failed.array(0,4,Int32Array),error=>error===reason);
    const invalid=readerFixture(2);invalid.__vector_len=()=>-1;invalid.array=()=>{throw reason;};installTfliteMetadataArrays(invalid);assert.throws(()=>invalid.array(0,4,Int32Array),error=>error===reason);
});

test('a truncated real metadata vector still rejects the file instead of returning partial bytes',async()=>{
    const f=fixture({graphCount:1}),bytes=new Uint8Array(f.totalBytes);bytes.set(f.data);const r=BinaryReader.open(bytes);
    const graph=r.__indirect(r.__vector(r.root+r.__offset(r.root,8))),tensor=r.__indirect(r.__vector(graph+r.__offset(graph,4))),field=tensor+r.__offset(tensor,4),vector=field+r.int32(field);
    new DataView(bytes.buffer).setInt32(vector,4096,true);
    await assert.rejects(parseModel((o,n)=>bytes.subarray(o,o+n),bytes.length,metadata),/範圍|more bytes|file|length/i);
});
