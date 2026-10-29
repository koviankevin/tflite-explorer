import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {createRequire} from 'node:module';
import vm from 'node:vm';
import {runtimeFixture} from './runtime-fixture.mjs';
import {parseModel} from '../src/model-engine.js';
import {exportTflite} from '../src/tflite-export.js';
import {runtimePlan} from '../src/tflite-runtime-policy.js';
import {executeRuntime} from '../src/tflite-runtime-execute.js';
import {Archive} from '../vendor/netron/zip.js';

test('a valid ADD submodel executes without acquiring custom options diagnostics on round trip',async()=>{
    const base=new URL('../vendor/litert/2.6.0/',import.meta.url),messages=[];
    globalThis.self=globalThis;globalThis.require=createRequire(import.meta.url);globalThis.__dirname=fileURLToPath(base);
    globalThis.importScripts=url=>vm.runInThisContext(readFileSync(new URL(url),'utf8'),{filename:fileURLToPath(url)});
    globalThis.Module={locateFile:name=>fileURLToPath(new URL(name,base)),printErr:s=>messages.push(String(s))};
    const rt=await import('../vendor/litert/2.6.0/core.js');await rt.loadLiteRt(new URL('litert_wasm_compat_internal.js',base).href);
    const metadata=JSON.parse(readFileSync(new URL('../vendor/netron/tflite-metadata.json',import.meta.url),'utf8')),parse=bytes=>parseModel((o,n)=>bytes.subarray(o,o+n),bytes.length,metadata),specs=[1,3].map(n=>({mode:'bin',file:new File([Float32Array.of(n,n+1)],'input.bin')}));
    try{
        const f=await runtimeFixture();
        const run=async(blob,model)=>{messages.length=0;const result=await executeRuntime({blob,plan:runtimePlan(model,blob.size),rt,specs,diagnostics:()=>messages});assert.equal(result.status,'passed',JSON.stringify(result));assert.equal(result.invoked,true);const zip=Archive.open(new Uint8Array(await result.io.archive.arrayBuffer()),'zip');assert.deepEqual([...new Float32Array(zip.entries.get('outputs-0.bin').peek().slice().buffer)],[4,6]);return result.diagnostics.filter(s=>/Found builtin operator .* with custom options/.test(s));};
        assert.deepEqual(await run(f.blob,f.model),[],'the original ADD fixture is a clean runtime control');
        const index=await parse(f.bytes),result=exportTflite(index,0,[0],new Blob([f.bytes])),bytes=new Uint8Array(await result.blob.arrayBuffer()),reopened=await parse(bytes);
        assert.deepEqual(await run(result.blob,reopened.raw),[],'cutting a valid builtin OP must not add a custom-options error');
    }finally{rt.unloadLiteRt();}
});
