import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {createRequire} from 'node:module';
import vm from 'node:vm';
import assert from 'node:assert/strict';
import {runtimeModuleCache,RUNTIME_MODULE_ASSET} from '../../src/runtime-module.js';
import {runtimeFixture} from '../runtime-fixture.mjs';
import {runtimePlan} from '../../src/tflite-runtime-policy.js';
import {executeRuntime} from '../../src/tflite-runtime-execute.js';
import {Archive} from '../../vendor/netron/zip.js';

if(process.argv[2]!=='--runtime-module-reference')throw Error('Explicit finite public CPU reference only.');
const base=new URL('../../vendor/litert/2.6.0/',import.meta.url),bytes=readFileSync(new URL('litert_wasm_compat_internal.wasm',base));let fetches=0,compiles=0;
const cache=runtimeModuleCache({assetURL:'https://runtime.invalid/litert_wasm_compat_internal.wasm',fetcher:async()=>{fetches++;return new Response(bytes,{headers:{'content-type':'application/wasm'}});},compile:b=>{compiles++;return WebAssembly.compile(b);}});
globalThis.self=globalThis;globalThis.require=createRequire(import.meta.url);globalThis.__dirname=fileURLToPath(base);globalThis.importScripts=url=>vm.runInThisContext(readFileSync(new URL(url),'utf8'),{filename:fileURLToPath(url)});
const diagnostics=[];const rt=await import('../../vendor/litert/2.6.0/core.js'),instances=[],outputs=[];
const binaryIO=process.argv.includes('--binary-io');
for(const scale of [1,10]){
    const module=structuredClone(await cache());assert.ok(module instanceof WebAssembly.Module);assert.equal(bytes.length,RUNTIME_MODULE_ASSET.bytes);
    globalThis.Module={print:s=>diagnostics.push(String(s)),printErr:s=>diagnostics.push(String(s)),locateFile(){throw Error('Unexpected second WASM read');},instantiateWasm(imports,ready){const instance=new WebAssembly.Instance(module,imports);instances.push(instance);ready(instance);}};
    await rt.loadLiteRt(new URL('litert_wasm_compat_internal.js',base).href,{threads:false,jspi:false});
    try{const f=await runtimeFixture(),specs=[{mode:'bin',file:new File([Float32Array.of(scale,scale*2)],'a.bin')},{mode:'bin',file:new File([Float32Array.of(scale*3,scale*4)],'b.bin')}],r=await executeRuntime({blob:f.blob,plan:runtimePlan(f.model,f.bytes.length),rt,specs,transferableIO:binaryIO});assert.equal(r.status,'passed',r.reason);if(binaryIO)assert.ok(r.io.archive instanceof Uint8Array);const zip=Archive.open(binaryIO?r.io.archive:new Uint8Array(await r.io.archive.arrayBuffer()),'zip');outputs.push([...new Float32Array(zip.entries.get('outputs-0.bin').peek().slice().buffer)]);}finally{rt.unloadLiteRt();}
}
assert.ok(instances[0]!==instances[1]);const memories=instances.map(i=>Object.values(i.exports).filter(v=>v instanceof WebAssembly.Memory));assert.ok(memories.every(m=>m.length===1));assert.ok(memories[0][0]!==memories[1][0]);console.log(JSON.stringify({status:'passed',binaryIO,fetches,compiles,instances:instances.length,identicalInstances:instances[0]===instances[1],identicalMemory:memories[0][0]===memories[1][0],outputs}));
