import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
import vm from 'node:vm';
import {legacyShapeFixture as fixture,parseLegacyShapeFixture as parse} from './legacy-shape-fixture.mjs';
import {runtimePlan} from '../src/tflite-runtime-policy.js';
import {executeRuntime} from '../src/tflite-runtime-execute.js';
import {editTfliteModel} from '../src/tflite-model-edit.js';
import {exportTflite} from '../src/tflite-export.js';
import {Archive} from '../vendor/netron/zip.js';

test('actual pinned CPU agrees for canonical, legacy, edited and cut FC; invalid legacy FC violates the output contract',async()=>{
    const base=new URL('../vendor/litert/2.6.0/',import.meta.url),messages=[];
    globalThis.self=globalThis;globalThis.require=createRequire(import.meta.url);globalThis.__dirname=fileURLToPath(base);
    globalThis.importScripts=url=>vm.runInThisContext(readFileSync(new URL(url),'utf8'),{filename:fileURLToPath(url)});
    globalThis.Module={locateFile:name=>fileURLToPath(new URL(name,base)),printErr:s=>{messages.push(String(s));if(messages.length>12)messages.shift();}};
    const rt=await import('../vendor/litert/2.6.0/core.js');await rt.loadLiteRt(new URL('litert_wasm_compat_internal.js',base).href);
    try{
        const canonical=await fixture('FULLY_CONNECTED',[[2,4],[5,4]],{rank:true,output:[2,5]}),legacy=await fixture('FULLY_CONNECTED',[[2,4],[5,4]],{output:[2,5]});
        const edited=editTfliteModel(legacy.index,legacy.file,[{graph:0,operators:[{template:0,inputs:[0,1,3]}]}]),cut=exportTflite(legacy.index,0,[0],legacy.file);
        for(const [name,blob]of [['canonical',canonical.blob],['legacy',legacy.blob],['edited',edited.blob],['cut',cut.blob]]){
            const bytes=new Uint8Array(await blob.arrayBuffer()),index=await parse(bytes),plan=runtimePlan(index.raw,blob.size);assert.equal(plan.eligible,true,name+': '+plan.reason);messages.length=0;
            const specs=[Float32Array.from([1,2,3,4,5,6,7,8]),new Float32Array(20).fill(1),new Float32Array(5)].map((data,i)=>({mode:'bin',file:new File([data],`input-${i}.bin`)}));
            const result=await executeRuntime({blob,plan,rt,specs,diagnostics:()=>messages});assert.equal(result.status,'passed',name+': '+JSON.stringify(result));
            const zip=Archive.open(new Uint8Array(await result.io.archive.arrayBuffer()),'zip'),values=zip.entries.get('outputs-0.bin').peek().slice();
            assert.deepEqual([...new Float32Array(values.buffer)],[10,10,10,10,10,26,26,26,26,26]);
        }
        const bad=await fixture('FULLY_CONNECTED',[[2,3],[5,4]],{output:[2,5]});messages.length=0;
        const result=await executeRuntime({blob:bad.blob,plan:runtimePlan(bad.index.raw,bad.blob.size),rt,specs:[{mode:'zero'},{mode:'zero'},{mode:'zero'}],diagnostics:()=>messages});
        console.log(JSON.stringify({legacyInvalidFC:{status:result.status,stage:result.stage,invoked:result.invoked,reason:result.reason,diagnostics:result.diagnostics,io:!!result.io,ioError:result.ioError}}));
        // The pinned kernel can run this nondivisible input and produce a
        // different output shape. It is not necessarily an allocation failure.
        assert.equal(result.status,'failed');assert.equal(result.invoked,true);assert.match(result.reason,/執行後輸出 shape/);
        // Keep the existing runtime limitation explicit: this malformed model
        // returns a padded tensor that the pinned runtime cannot serialize.
        assert.equal(result.io,undefined);assert.match(result.ioError,/strides or padding/);
    }finally{await rt.unloadLiteRt();}
});
