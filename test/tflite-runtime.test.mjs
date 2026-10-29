import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {readFile as read} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {createRequire} from 'node:module';
import vm from 'node:vm';
import {createHash} from 'node:crypto';
import {runtimeFixture} from './runtime-fixture.mjs';
import {runtimePlan,RUNTIME_LIMITS,runtimeSkipped} from '../src/tflite-runtime-policy.js';
import {runtimeClient} from '../src/tflite-runtime-client.js';
import {executeRuntime} from '../src/tflite-runtime-execute.js';
import {attachRuntimeReport} from '../src/tflite-runtime-report.js';
import {Archive} from '../vendor/netron/zip.js';

test('runtime policy skips custom, dynamic, unsupported and large models without reading weights',async()=>{
    const {model,blob}=await runtimeFixture();assert.equal(runtimePlan(model,blob.size).eligible,true);
    assert.match(runtimePlan(model,RUNTIME_LIMITS.modelBytes+1).reason,/128 MiB/);
    let m=structuredClone(model);m.operator_codes[0].custom_code='company.kernel';assert.match(runtimePlan(m,blob.size).reason,/custom/);
    m=structuredClone(model);m.subgraphs[0].tensors[0].shape_signature=[-1,2];assert.match(runtimePlan(m,blob.size).reason,/動態/);
    m=structuredClone(model);m.subgraphs[0].tensors[0].type=5;assert.match(runtimePlan(m,blob.size).reason,/dtype/);
    m=structuredClone(model);m.subgraphs[0].tensors[0].shape=[2147483647,2147483647];assert.equal(runtimePlan(m,blob.size).eligible,false);
    const client=runtimeClient({createWorker:()=>{throw Error('must not initialize runtime');}});const result=await client.check({arrayBuffer(){throw Error('no read');}},runtimePlan(model,1024**3));assert.equal(result.status,'not-verified');
});
test('runtime rejects ambiguous or non-primary signatures before any model-body read',async()=>{
    const f=await runtimeFixture(),signature={signature_key:'serving_default',subgraph_index:0,inputs:[{name:'a',tensor_index:0},{name:'b',tensor_index:1}],outputs:[{name:'c',tensor_index:2}]};
    f.model.signature_defs=[signature];assert.equal(runtimePlan(f.model,f.blob.size).eligible,true);
    for(const signatures of [[{...signature,subgraph_index:1}],[signature,{...signature,signature_key:'other'}],[{...signature,inputs:signature.inputs.toReversed()}],[{...signature,outputs:[]}],[{...signature,inputs:[signature.inputs[0],signature.inputs[0]]}]]){const m={...f.model,signature_defs:signatures},plan=runtimePlan(m,f.blob.size);assert.equal(plan.eligible,false);assert.match(plan.reason,/signature/i);const r=await executeRuntime({blob:{size:f.blob.size,arrayBuffer(){throw Error('must not read');}},plan,rt:null});assert.equal(r.status,'not-verified');}
});
test('client owns and releases Workers on success, cancellation, supersession and errors',async()=>{
    const workers=[],client=runtimeClient({prepareModule:async()=>new WebAssembly.Module(Uint8Array.of(0,97,115,109,1,0,0,0)),createWorker:()=>{const w={terminated:0,terminate(){this.terminated++;},postMessage(){}};workers.push(w);return w;}}),plan={eligible:true};
    let promise=client.check({},plan);await Promise.resolve();workers[0].onmessage({data:{result:{status:'passed'}}});assert.equal((await promise).status,'passed');assert.equal(workers[0].terminated,1);
    promise=client.check({},plan);client.cancel();assert.equal((await promise).cancelled,true);assert.equal(workers[1].terminated,1);
    promise=client.check({},plan);const replacement=client.check({},plan);assert.equal((await promise).cancelled,true);workers.at(-1).onerror({preventDefault(){}});assert.equal((await replacement).status,'not-verified');assert.ok(workers.every(w=>w.terminated===1));
});
test('a nonresponsive runtime is terminated at the documented deadline and never passes',async t=>{
    t.mock.timers.enable({apis:['setTimeout']});let terminated=0;
    try{const client=runtimeClient({prepareModule:async()=>new WebAssembly.Module(Uint8Array.of(0,97,115,109,1,0,0,0)),createWorker:()=>({postMessage(){},terminate(){terminated++;}})}),task=client.check({}, {eligible:true});t.mock.timers.tick(RUNTIME_LIMITS.timeoutMs+1);const result=await task;assert.equal(result.status,'not-verified');assert.match(result.reason,/30 秒/);assert.equal(terminated,1);client.cancel();assert.equal(terminated,1);}
    finally{t.mock.timers.reset();}
});
test('runtime report keeps numerical equivalence unverified and reflects actual stages',async()=>{
    const record={checks:[{id:'runtime-load',status:'not-run'},{id:'runtime-equivalence',status:'not-run'}]},report={blob:new Blob([JSON.stringify(record)]),summary:{checks:record.checks}};
    const attached=await attachRuntimeReport(report,{...runtimeSkipped('custom kernel unavailable'),compiled:true});
    const doc=JSON.parse(await attached.blob.text());assert.equal(doc.checks.find(c=>c.id==='runtime-load').status,'passed');assert.equal(doc.checks.find(c=>c.id==='runtime-smoke').status,'not-run');assert.equal(doc.checks.find(c=>c.id==='runtime-equivalence').status,'not-run');assert.equal(doc.runtimeValidation.status,'not-verified');
});
test('vendored official LiteRT files match pinned provenance',async()=>{
    const base=new URL('../vendor/litert/2.6.0/',import.meta.url),p=JSON.parse(await read(new URL('provenance.json',base),'utf8'));
    for(const f of p.files){const bytes=await read(new URL(f.path,base));assert.equal(bytes.length,f.bytes);assert.equal(createHash('sha256').update(bytes).digest('hex'),f.sha256);}
    assert.ok((await read(new URL('LICENSE',base),'utf8')).includes('Apache License'));
});
test('actual CPU WASM loads, allocates and invokes ADD; detects wrong shape and bad broadcast',async()=>{
    const base=new URL('../vendor/litert/2.6.0/',import.meta.url),messages=[];
    globalThis.self=globalThis;globalThis.require=createRequire(import.meta.url);globalThis.__dirname=fileURLToPath(base);
    globalThis.importScripts=url=>vm.runInThisContext(readFileSync(new URL(url),'utf8'),{filename:fileURLToPath(url)});
    globalThis.Module={locateFile:name=>fileURLToPath(new URL(name,base)),printErr:s=>messages.push(String(s))};
    const rt=await import('../vendor/litert/2.6.0/core.js');await rt.loadLiteRt(new URL('litert_wasm_compat_internal.js',base).href);
    try{
        const f=await runtimeFixture(),result=await executeRuntime({blob:f.blob,plan:runtimePlan(f.model,f.blob.size),rt,diagnostics:()=>messages});assert.equal(result.status,'passed',JSON.stringify(result));assert.equal(result.invoked,true);
        const signed=await runtimeFixture({signatureTarget:0}),signedResult=await executeRuntime({blob:signed.blob,plan:runtimePlan(signed.model,signed.blob.size),rt});assert.equal(signedResult.status,'passed',signedResult.reason);
        const specs=[{mode:'bin',file:new File([Float32Array.of(1,2)],'a.bin')},{mode:'bin',file:new File([Float32Array.of(3,4)],'b.bin')}],raw=await executeRuntime({blob:f.blob,plan:runtimePlan(f.model,f.blob.size),rt,specs});assert.equal(raw.status,'passed');const zip=Archive.open(new Uint8Array(await raw.io.archive.arrayBuffer()),'zip');assert.deepEqual([...new Float32Array(zip.entries.get('outputs-0.bin').peek().slice().buffer)],[4,6]);assert.equal(raw.modelSHA256,createHash('sha256').update(f.bytes).digest('hex'));
        const env=await rt.Environment.create({webGpuDevice:null}),model=await rt.loadAndCompile(f.bytes,{accelerator:'wasm',environment:env,cpuOptions:{numThreads:1}}),ins=[new rt.Tensor(Float32Array.of(1,2),[1,2],env),new rt.Tensor(Float32Array.of(3,4),[1,2],env)],outs=await model.run(ins);assert.deepEqual([...outs[0].toTypedArray()],[4,6]);for(const t of [...ins,...outs])t.delete();model.delete();env.delete();
        const wrong=await runtimeFixture({outputShape:[1,99]}),shape=await executeRuntime({blob:wrong.blob,plan:runtimePlan(wrong.model,wrong.blob.size),rt});assert.equal(shape.status,'failed');assert.ok(['interface','invoke'].includes(shape.stage));
        const bad=await runtimeFixture({inputShapes:[[1,2],[1,3]]}),invalid=await executeRuntime({blob:bad.blob,plan:runtimePlan(bad.model,bad.blob.size),rt,diagnostics:()=>messages});assert.equal(invalid.status,'failed');assert.equal(invalid.invoked,false);assert.match(invalid.reason+' '+invalid.diagnostics.join(' '),/broadcast|ADD|prepare|incompatible|allocation/i);
    }finally{rt.unloadLiteRt();}
});
