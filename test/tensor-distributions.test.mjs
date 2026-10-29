import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {seededRandom,validateRandomRange,randomDefaults,randomAlgorithm} from '../src/tensor-random.js';
import {runtimeInput,littleEndianBytes} from '../src/tflite-runtime-inputs.js';
import {randomTensor} from '../src/tflite-new-ops.js';
import {runtimeFixture} from './runtime-fixture.mjs';
import {parseModel} from '../src/model-engine.js';
import {editWorkspaceSnapshot,exportEditWorkspace} from '../src/model-edit-workspace.js';
import {modelEditDraft} from '../src/model-edit-draft.js';
import {createEditSession,exportEditSession,parseEditSession,restoreEditSession,editFileFingerprint} from '../src/model-edit-session.js';
import {nextEditRecovery,readEditRecovery} from '../src/edit-recovery-store.js';
import {runtimeArchive} from '../src/tflite-runtime-archive.js';
import {Archive} from '../vendor/netron/zip.js';
const sample=(spec,n=100000)=>{const next=seededRandom('float64',spec);return Array.from({length:n},next);};
const stats=values=>{const mean=values.reduce((a,b)=>a+b,0)/values.length;return {mean,variance:values.reduce((a,b)=>a+(b-mean)**2,0)/values.length};};
test('Normal has the requested mean/variance; seeded sampling is reproducible',()=>{
    const spec={distribution:'normal',seed:123,mean:3,std:2},values=sample(spec),s=stats(values);assert.ok(Math.abs(s.mean-3)<.025);assert.ok(Math.abs(s.variance-4)<.06);assert.deepEqual(values.slice(0,64),sample(spec,64));assert.notDeepEqual(values.slice(0,64),sample({...spec,seed:124},64));assert.ok(values.every(Number.isFinite));
});
test('Truncated Normal follows conditional density instead of clipping or using independent endpoint weights',()=>{
    const values=sample({distribution:'truncated-normal',seed:321,mean:0,std:1,min:-1,max:1}),s=stats(values);assert.ok(values.every(x=>x>-1&&x<1));assert.ok(Math.abs(s.mean)<.01);assert.ok(Math.abs(s.variance-.291125094772793)<.004);
    const tail=sample({distribution:'truncated-normal',seed:456,mean:0,std:1,min:4,max:4.01},50000),t=stats(tail);assert.ok(tail.every(x=>x>=4&&x<=4.01));assert.ok(Math.abs(t.mean-4.004966625)<.00008);assert.ok(Math.abs(t.variance-.0000083327)<.00000015);
});
test('Bernoulli respects probability, binary outputs and exact 0/1 endpoints',()=>{
    const spec={distribution:'bernoulli',seed:123,probability:.2},values=sample(spec);assert.ok(values.every(x=>x===0||x===1));assert.ok(Math.abs(stats(values).mean-.2)<.005);for(const probability of [0,1])assert.ok(sample({...spec,probability},20).every(n=>n===probability));
});
test('default presets are dtype-safe and distinguish normalized inputs, small weights and binary masks',()=>{
    for(const dtype of ['float16','float32','float64','int8','uint8','int64','uint64','bool'])for(const role of ['input','weight'])assert.doesNotThrow(()=>validateRandomRange(dtype,randomDefaults(dtype,undefined,role)));
    assert.deepEqual(randomDefaults('float32'),{seed:1,distribution:'normal',mean:0,std:1});assert.deepEqual(randomDefaults('float32',undefined,'weight'),{seed:1,distribution:'truncated-normal',mean:0,std:.05,min:-.1,max:.1});assert.equal(randomDefaults('bool').probability,.5);assert.equal(randomDefaults('uint8').max,255);
});
test('invalid distributions, nonfinite/overflowing parameters and inefficient truncation fail preflight',()=>{
    for(const spec of [{distribution:'normal',mean:0,std:0},{distribution:'normal',mean:0,std:-1},{distribution:'normal',mean:Infinity,std:1},{distribution:'normal',mean:0,std:1e38},{distribution:'truncated-normal',mean:0,std:1,min:3,max:3},{distribution:'truncated-normal',mean:0,std:1,min:100,max:101},{distribution:'bernoulli',probability:-.1},{distribution:'bernoulli',probability:NaN},{distribution:'bernoulli',probability:1.1},{distribution:'constructor'}])assert.throws(()=>seededRandom('float32',{seed:1,...spec}));
    assert.throws(()=>seededRandom('int8',{seed:1,distribution:'normal',mean:0,std:1}),/浮點/);
});
test('runtime inputs and generated const tensors share exact bytes for every new distribution',async()=>{
    for(const spec of [{seed:1,distribution:'normal',mean:0,std:1},{seed:7,distribution:'truncated-normal',mean:.1,std:.05,min:-.1,max:.2},{seed:123,distribution:'bernoulli',probability:.3}])for(const [type,dtype]of [[0,'float32'],[10,'float64']]){
        const expected=randomTensor({type,shape:[1024]},spec),actual=await runtimeInput({dtype,shape:[1024]},{mode:'random',...spec});assert.deepEqual(littleEndianBytes(actual,dtype),expected);assert.ok([...actual].every(Number.isFinite));assert.match(randomAlgorithm(spec),/^xorshift32-/);
    }
    const spec={seed:123,distribution:'bernoulli',probability:.2};assert.deepEqual(randomTensor({type:6,shape:[1024]},spec),await runtimeInput({dtype:'bool',shape:[1024]},{mode:'random',...spec}));
});
test('downloaded IO manifest retains enough distribution parameters to replay its actual BIN',async()=>{
    for(const s of [{seed:1,distribution:'normal',mean:0,std:1},{seed:7,distribution:'truncated-normal',mean:0,std:.1,min:-.2,max:.2},{seed:9,distribution:'bernoulli',probability:.3}]){
        const spec={mode:'random',...s},detail={name:'input',dtype:'float32',shape:[64]},data=await runtimeInput(detail,spec),tensor={...detail,toTypedArray:()=>data},bundle=runtimeArchive({validation:{status:'passed'},inputs:[tensor],outputs:[],inputDetails:[detail],outputDetails:[],specs:[spec],modelSHA256:'a'.repeat(64)}),zip=Archive.open(new Uint8Array(await bundle.archive.arrayBuffer()),'zip'),manifest=JSON.parse(new TextDecoder().decode(zip.entries.get('manifest.json').peek())),row=manifest.inputs[0];
        for(const [k,value]of Object.entries(s))assert.equal(row[k],value);assert.equal(row.algorithm,randomAlgorithm(s));const replay=await runtimeInput(detail,{mode:'random',...row});assert.deepEqual(littleEndianBytes(replay,'float32'),zip.entries.get('inputs-0.bin').peek());
    }
});
test('new distribution drafts use v3, restore redo/const bytes and persist in recovery without changing legacy v1',async()=>{
    const f=await runtimeFixture(),metadata=JSON.parse(await readFile(new URL('../vendor/netron/tflite-metadata.json',import.meta.url),'utf8')),parse=b=>parseModel((o,n)=>b.subarray(o,o+n),b.length,metadata),index=await parse(f.bytes),snapshot=editWorkspaceSnapshot(index,{targets:[{graph:0,node:0}]}),fingerprint=await editFileFingerprint(f.file),view={selected:'new:1',zoom:1,font:32,left:0,top:0},options={updateSignatures:false};
    for(const composition of [false,true])for(const spec of [{seed:1,min:0,max:1},{seed:123,distribution:'normal',mean:0,std:.1},{seed:123,distribution:'truncated-normal',mean:0,std:.05,min:-.1,max:.1},{seed:123,distribution:'bernoulli',probability:.25}]){
        const scope=composition?editWorkspaceSnapshot(index,{targets:[{graph:0,node:0}],composition:true}):snapshot,d=modelEditDraft(scope);if(composition)d.apply({kind:'import',node:'op:0:0',nodes:['op:0:0'],label:'A'});d.apply({kind:'clone',node:'op:0:0',side:'after'});d.apply({kind:'random',node:'new:1',slot:1,like:'t:0:0',...spec});d.undo();const doc=await createEditSession(f.file,scope,{history:d.history,view,options},fingerprint);assert.equal(doc.version,spec.distribution?3:composition?2:1);
        const text=exportEditSession(doc),saved=parseEditSession(text),record=nextEditRecovery(null,{key:'a'.repeat(32),owner:'b'.repeat(32),revision:0,document:saved});assert.equal(readEditRecovery(record).document.version,doc.version);
        const fresh=new File([f.bytes],'renamed.tflite'),restored=await restoreEditSession(index,fresh,saved,fingerprint),next=modelEditDraft(restored.snapshot,restored.saved.history.commands,restored.saved.history.redo);next.redo();d.redo();const a=await exportEditWorkspace(index,f.file,scope,d.commands),b=await exportEditWorkspace(index,fresh,restored.snapshot,next.commands);assert.deepEqual(new Uint8Array(await a.blob.arrayBuffer()),new Uint8Array(await b.blob.arrayBuffer()));
        const out=await parse(new Uint8Array(await b.blob.arrayBuffer())),constant=out.raw.subgraphs[0].tensors[out.raw.subgraphs[0].operators[1].inputs[1]],buffer=out.raw.buffers[constant.buffer],data=buffer.size?new Uint8Array(await b.blob.slice(Number(buffer.offset),Number(buffer.offset+buffer.size)).arrayBuffer()):buffer.data;assert.deepEqual(data,randomTensor(index.raw.subgraphs[0].tensors[0],spec));
        if(spec.distribution){const wrong=structuredClone(doc);wrong.version=1;assert.throws(()=>parseEditSession(JSON.stringify(wrong)),/版本/);}
    }
});
