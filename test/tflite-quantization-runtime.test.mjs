import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {readFile} from 'node:fs/promises';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
import vm from 'node:vm';
import {quantizationFixture} from './quantization-fixture.mjs';
import {runtimePlan} from '../src/tflite-runtime-policy.js';
import {executeRuntime} from '../src/tflite-runtime-execute.js';
import {parseModel} from '../src/model-engine.js';
import {editTfliteModel} from '../src/tflite-model-edit.js';
import {exportTflite} from '../src/tflite-export.js';
import {Archive} from '../vendor/netron/zip.js';
test('pinned CPU executes original, rewired and cut quantized ADD; malformed legacy axis remains a compile failure',async()=>{
    const base=new URL('../vendor/litert/2.6.0/',import.meta.url),messages=[];
    globalThis.self=globalThis;globalThis.require=createRequire(import.meta.url);globalThis.__dirname=fileURLToPath(base);
    globalThis.importScripts=url=>vm.runInThisContext(readFileSync(new URL(url),'utf8'),{filename:fileURLToPath(url)});
    globalThis.Module={locateFile:name=>fileURLToPath(new URL(name,base)),printErr:s=>{messages.push(String(s));if(messages.length>12)messages.shift();}};
    const rt=await import('../vendor/litert/2.6.0/core.js');await rt.loadLiteRt(new URL('litert_wasm_compat_internal.js',base).href);
    const metadata=JSON.parse(await readFile(new URL('../vendor/netron/tflite-metadata.json',import.meta.url),'utf8'));
    try{
        const f=await quantizationFixture(),legacy=await quantizationFixture({rank:false}),edited=editTfliteModel(f.index,f.file,[{graph:0,operators:[{template:0,inputs:[1,0]}]}]),cut=exportTflite(f.index,0,[0],f.file);
        for(const [name,blob]of [['original',f.file],['legacy-rank-flag',legacy.file],['rewired',edited.blob],['cut',cut.blob]]){
            const b=new Uint8Array(await blob.arrayBuffer()),index=await parseModel((o,n)=>b.subarray(o,o+n),b.length,metadata),plan=runtimePlan(index.raw,blob.size);
            assert.equal(plan.eligible,true,name+': '+plan.reason);messages.length=0;
            const r=await executeRuntime({blob,plan,rt,specs:[{mode:'bin',file:new File([Int8Array.of(-2,2)],'a.bin')},{mode:'bin',file:new File([Int8Array.of(4,-4)],'b.bin')}],diagnostics:()=>messages});
            assert.equal(r.status,'passed',name+': '+JSON.stringify(r));
            const zip=Archive.open(new Uint8Array(await r.io.archive.arrayBuffer()),'zip'),values=zip.entries.get('outputs-0.bin').peek().slice();assert.deepEqual([...new Int8Array(values.buffer)],[2,-2]);
        }
        const bad=await quantizationFixture({rank:false,dimension:3}),plan=runtimePlan(bad.index.raw,bad.file.size);assert.equal(plan.eligible,true);
        messages.length=0;const r=await executeRuntime({blob:bad.file,plan,rt,specs:[{mode:'zero'},{mode:'zero'}],diagnostics:()=>messages});
        assert.equal(r.status,'failed');assert.equal(r.stage,'compile');assert.equal(r.compiled,false);assert.equal(r.invoked,false);assert.equal(r.io,undefined);assert.match(r.reason,/Failed to build TFL interpreter|invalid quantization parameters|quantized_dimension/);
    }finally{await rt.unloadLiteRt();}
});

