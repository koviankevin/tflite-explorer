import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
import vm from 'node:vm';
import {axisTransformFixture} from './axis-transform-fixture.mjs';
import {runtimePlan} from '../src/tflite-runtime-policy.js';
import {executeRuntime} from '../src/tflite-runtime-execute.js';
import {Archive} from '../vendor/netron/zip.js';

test('pinned CPU exposes delegated TRANSPOSE behavior and rejects invalid EXPAND_DIMS axis metadata',async()=>{
    const base=new URL('../vendor/litert/2.6.0/',import.meta.url),messages=[];
    globalThis.self=globalThis;globalThis.require=createRequire(import.meta.url);globalThis.__dirname=fileURLToPath(base);
    globalThis.importScripts=url=>vm.runInThisContext(readFileSync(new URL(url),'utf8'),{filename:fileURLToPath(url)});
    globalThis.Module={locateFile:name=>fileURLToPath(new URL(name,base)),printErr:s=>messages.push(String(s))};
    const rt=await import('../vendor/litert/2.6.0/core.js');await rt.loadLiteRt(new URL('litert_wasm_compat_internal.js',base).href);
    const run=async options=>{
        const f=await axisTransformFixture(options),n=f.model.subgraphs[0].tensors[0].shape.reduce((a,b)=>a*b,1),values=Float32Array.from({length:n},(_,i)=>i+1);
        const result=await executeRuntime({blob:f.blob,plan:runtimePlan(f.model,f.blob.size),rt,specs:[{mode:'bin',file:new File([values],'input.bin')}],diagnostics:()=>messages});
        return {f,result};
    };
    try{
        for(const options of [{name:'EXPAND_DIMS',axes:[0,1],axisShape:[2],output:[1,2,3]},{name:'EXPAND_DIMS',axes:[1],axisShape:[],axisType:0,output:[2,1,3]}]){
            const {result}=await run(options);assert.equal(result.status,'failed',JSON.stringify({options,result}));
        }
        // XNNPACK also executes constant 2D permutations; that observation
        // does not widen the generic TRANSPOSE metadata contract to matrices.
        for(const [options,expected] of [[{axisShape:[1,2]},[1,4,2,5,3,6]],[{axisShape:[2,1]},[1,4,2,5,3,6]],[{axes:[-1,0]},[1,4,2,5,3,6]],[{name:'EXPAND_DIMS',axes:[-1],axisShape:[],axisType:4,output:[2,3,1]},[1,2,3,4,5,6]],[{name:'EXPAND_DIMS',axes:[0],axisShape:[1,1],output:[1,2,3]},[1,2,3,4,5,6]]]){
            const {result}=await run(options);assert.equal(result.status,'passed',JSON.stringify({options,result}));
            const zip=Archive.open(new Uint8Array(await result.io.archive.arrayBuffer()),'zip');
            assert.deepEqual([...new Float32Array(zip.entries.get('outputs-0.bin').peek().slice().buffer)],expected);
        }
    }finally{rt.unloadLiteRt();}
});
