import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {createRequire} from 'node:module';
import {createHash} from 'node:crypto';
import vm from 'node:vm';
import assert from 'node:assert/strict';
import {runtimeMemoryFixture,runtimeMemoryValues,RUNTIME_MEMORY_ELEMENTS} from '../runtime-memory-fixture.mjs';
import {runtimePlan} from '../../src/tflite-runtime-policy.js';
import {executeRuntime} from '../../src/tflite-runtime-execute.js';
import {Archive} from '../../vendor/netron/zip.js';
if(process.argv[2]!=='--memory-reference')throw Error('Explicit finite fixture reference only.');
const base=new URL('../../vendor/litert/2.6.0/',import.meta.url),diagnostics=[],hash=b=>createHash('sha256').update(b).digest('hex');
globalThis.self=globalThis;globalThis.require=createRequire(import.meta.url);globalThis.__dirname=fileURLToPath(base);globalThis.importScripts=url=>vm.runInThisContext(readFileSync(new URL(url),'utf8'),{filename:fileURLToPath(url)});globalThis.Module={locateFile:name=>fileURLToPath(new URL(name,base)),print:text=>diagnostics.push(String(text)),printErr:text=>diagnostics.push(String(text))};
const rt=await import('../../vendor/litert/2.6.0/core.js');await rt.loadLiteRt(new URL('litert_wasm_compat_internal.js',base).href);
try{const f=await runtimeMemoryFixture(),input=new Float32Array(RUNTIME_MEMORY_ELEMENTS).fill(7),r=await executeRuntime({blob:f.blob,plan:runtimePlan(f.model,f.bytes.length),rt,specs:[{mode:'bin',file:new File([input],'memory.bin')}],diagnostics:()=>diagnostics});assert.equal(r.status,'passed',JSON.stringify(r));const z=Archive.open(new Uint8Array(await r.io.archive.arrayBuffer()),'zip'),bytes=z.entries.get('outputs-0.bin').peek();assert.equal(hash(bytes),hash(runtimeMemoryValues(7)));console.log(JSON.stringify({status:r.status,compiled:r.compiled,invoked:r.invoked,modelSHA256:r.modelSHA256,outputSHA256:hash(bytes),outputBytes:bytes.length,diagnostics:r.diagnostics}));}finally{rt.unloadLiteRt();}
