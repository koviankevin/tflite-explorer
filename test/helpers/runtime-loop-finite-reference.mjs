import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {createRequire} from 'node:module';
import vm from 'node:vm';
import {runtimeLoopFixture} from '../runtime-loop-fixture.mjs';
import {runtimePlan} from '../../src/tflite-runtime-policy.js';
import {executeRuntime} from '../../src/tflite-runtime-execute.js';
import {Archive} from '../../vendor/netron/zip.js';

if(process.argv[2]!=='--finite-reference')throw Error('This child reference only runs the finite false-predicate model.');
const base=new URL('../../vendor/litert/2.6.0/',import.meta.url),diagnostics=[];
globalThis.self=globalThis;globalThis.require=createRequire(import.meta.url);globalThis.__dirname=fileURLToPath(base);
globalThis.importScripts=url=>vm.runInThisContext(readFileSync(new URL(url),'utf8'),{filename:fileURLToPath(url)});
globalThis.Module={locateFile:name=>fileURLToPath(new URL(name,base)),print:text=>diagnostics.push(String(text)),printErr:text=>diagnostics.push(String(text))};
const rt=await import('../../vendor/litert/2.6.0/core.js');await rt.loadLiteRt(new URL('litert_wasm_compat_internal.js',base).href);
let result;
try{
    const f=await runtimeLoopFixture(false);result=await executeRuntime({blob:f.blob,plan:runtimePlan(f.model,f.bytes.length),rt,specs:[{mode:'bin',file:new File([Float32Array.of(7)],'loop-input.bin')}],diagnostics:()=>diagnostics});
    if(result.status==='passed'){const zip=Archive.open(new Uint8Array(await result.io.archive.arrayBuffer()),'zip');result.output=Array.from(new Float32Array(zip.entries.get('outputs-0.bin').peek().slice().buffer));}
    delete result.io;
}finally{rt.unloadLiteRt();}
console.log(JSON.stringify(result));
