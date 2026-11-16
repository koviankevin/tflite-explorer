import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import vm from 'node:vm';
import {softmaxCases} from './softmax-fixture.mjs';
import {runtimePlan} from '../src/tflite-runtime-policy.js';
import {executeRuntime} from '../src/tflite-runtime-execute.js';
import {Archive} from '../vendor/netron/zip.js';

test('actual pinned CPU Softmax/LogSoftmax preserves raw inputs and agrees with stable numerical expectations',async()=>{
    const base=new URL('../vendor/litert/2.6.0/',import.meta.url),messages=[];
    globalThis.self=globalThis;globalThis.require=createRequire(import.meta.url);globalThis.__dirname=fileURLToPath(base);
    globalThis.importScripts=url=>vm.runInThisContext(readFileSync(new URL(url),'utf8'),{filename:fileURLToPath(url)});
    globalThis.Module={locateFile:name=>fileURLToPath(new URL(name,base)),printErr:s=>messages.push(String(s))};
    const rt=await import('../vendor/litert/2.6.0/core.js');await rt.loadLiteRt(new URL('litert_wasm_compat_internal.js',base).href);
    try{
        for(const f of await softmaxCases()){
            const plan=runtimePlan(f.model,f.blob.size);assert.equal(plan.eligible,true,f.name+': '+plan.reason);
            const result=await executeRuntime({blob:f.blob,plan,rt,specs:[{mode:'bin',file:new File([f.values],'logits.bin')}],diagnostics:()=>messages});
            assert.equal(result.status,'passed',f.name+': '+result.reason);
            const zip=Archive.open(new Uint8Array(await result.io.archive.arrayBuffer()),'zip'),manifest=JSON.parse(new TextDecoder().decode(zip.entries.get('manifest.json').peek()));
            assert.equal(manifest.modelSHA256,createHash('sha256').update(f.bytes).digest('hex'));
            assert.deepEqual(Buffer.from(zip.entries.get('inputs-0.bin').peek()),Buffer.from(f.values.buffer,f.values.byteOffset,f.values.byteLength),f.name);
            const type=f.options.outputType??f.options.inputType??0,Ctor={0:Float32Array,3:Uint8Array,7:Int16Array,9:Int8Array}[type];
            const raw=new Ctor(zip.entries.get('outputs-0.bin').peek().slice().buffer),q=f.options.outputQuantization;
            const values=Array.from(raw,v=>(v-(q?.zero_point?.[0]??0))*(q?.scale?.[0]??1));
            assert.equal(values.length,f.expected.length,f.name);
            values.forEach((v,i)=>assert.ok(Math.abs(v-f.expected[i])<=f.tolerance,JSON.stringify({name:f.name,index:i,actual:v,expected:f.expected[i],tolerance:f.tolerance})));
        }
    }finally{rt.unloadLiteRt();}
});
