import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {readFile} from 'node:fs/promises';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
import vm from 'node:vm';
import {spatialFixture} from './spatial-fixture.mjs';
import {runtimePlan} from '../src/tflite-runtime-policy.js';
import {executeRuntime} from '../src/tflite-runtime-execute.js';
import {parseModel} from '../src/model-engine.js';
import {prepareTfliteModelEdit,editTfliteModel} from '../src/tflite-model-edit.js';
import {Archive} from '../vendor/netron/zip.js';
test('real pinned CPU executes spatial fixtures; serialized editor rejects bad shapes and preserves valid weights',async()=>{
    const base=new URL('../vendor/litert/2.6.0/',import.meta.url),messages=[];
    globalThis.self=globalThis;globalThis.require=createRequire(import.meta.url);globalThis.__dirname=fileURLToPath(base);
    globalThis.importScripts=url=>vm.runInThisContext(readFileSync(new URL(url),'utf8'),{filename:fileURLToPath(url)});
    globalThis.Module={locateFile:name=>fileURLToPath(new URL(name,base)),printErr:s=>messages.push(String(s))};
    const rt=await import('../vendor/litert/2.6.0/core.js');await rt.loadLiteRt(new URL('litert_wasm_compat_internal.js',base).href);
    const metadata=JSON.parse(await readFile(new URL('../vendor/netron/tflite-metadata.json',import.meta.url),'utf8'));
    try{
        for(const [name,expected]of [['CONV_2D',[12,16,24,28]],['DEPTHWISE_CONV_2D',[12,16,24,28]],['AVERAGE_POOL_2D',[3,4,6,7]],['MAX_POOL_2D',[5,6,8,9]],['L2_POOL_2D',null]]){
            const f=spatialFixture(name),raw=new Uint8Array(await f.blob.arrayBuffer()),index=await parseModel((o,n)=>raw.subarray(o,o+n),raw.length,metadata);
            const exported=editTfliteModel(index,f.file,[{graph:0,operators:[{template:0,inputs:Array.from(f.model.subgraphs[0].operators[0].inputs)}]}]);
            const editedBytes=new Uint8Array(await exported.blob.arrayBuffer()),edited=await parseModel((o,n)=>editedBytes.subarray(o,o+n),editedBytes.length,metadata);
            assert.deepEqual(Array.from(edited.raw.subgraphs[0].tensors.at(-1).shape),[1,2,2,1]);
            const result=await executeRuntime({blob:exported.blob,plan:runtimePlan(edited.raw,exported.blob.size),rt,specs:[{mode:'bin',file:new File([Float32Array.from([1,2,3,4,5,6,7,8,9])],'input.bin')}],diagnostics:()=>messages});
            assert.equal(result.status,'passed',name+': '+JSON.stringify(result));
            const zip=Archive.open(new Uint8Array(await result.io.archive.arrayBuffer()),'zip'),actual=[...new Float32Array(zip.entries.get('outputs-0.bin').peek().slice().buffer)];
            if(expected)assert.deepEqual(actual,expected);else assert.ok(Math.abs(actual[0]-Math.sqrt(11.5))<1e-5);
            assert.throws(()=>prepareTfliteModelEdit(index,f.file,[{graph:0,tensors:[{like:f.model.subgraphs[0].tensors.length-1,name:'wrong',shape:[1,3,3,1]}],operators:[{template:0,outputs:[f.model.subgraphs[0].tensors.length]}],outputs:[f.model.subgraphs[0].tensors.length]}]),/Subgraph #0.*OP #0.*output shape/);
            if(name==='CONV_2D'){
                const originalBuffers=f.model.buffers.slice(1).map(b=>Array.from(b.data));
                const preserved=edited.raw.buffers.slice(1).map(b=>Array.from(editedBytes.subarray(Number(b.offset),Number(b.offset+b.size))));assert.deepEqual(preserved,originalBuffers);
            }
        }
        const bad=spatialFixture('CONV_2D',{input:[1,3,3,2],filter:[1,2,2,3]});messages.length=0;
        const result=await executeRuntime({blob:bad.blob,plan:runtimePlan(bad.model,bad.blob.size),rt,diagnostics:()=>messages});
        console.log('actual pinned runtime invalid-channel diagnostics:',JSON.stringify({stage:result.stage,reason:result.reason,diagnostics:result.diagnostics}));
        assert.equal(result.status,'failed');assert.equal(result.invoked,false);
        assert.ok(result.diagnostics.length>0);
        assert.equal(result.failureKind,'tensor-allocation');
        assert.deepEqual(result.failureLocations.map(v=>({node:v.node,kernel:v.kernel,candidates:v.candidates})),[{node:0,kernel:'CONV_2D',candidates:[{graph:0,node:0,inputs:[0,1,2],outputs:[3],portsTruncated:false}]}]);
    }finally{rt.unloadLiteRt();}
});
