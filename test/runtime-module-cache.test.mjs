import {test} from 'node:test';
import assert from 'node:assert/strict';
import {runtimeClient} from '../src/tflite-runtime-client.js';
import {runtimeModuleCache,RUNTIME_MODULE_ASSET} from '../src/runtime-module.js';
import {readFile} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import vm from 'node:vm';
import {RUNTIME_LIMITS} from '../src/tflite-runtime-policy.js';

const module=new WebAssembly.Module(Uint8Array.of(0,97,115,109,1,0,0,0));
const tick=()=>new Promise(resolve=>setImmediate(resolve));
function worker(){return {messages:[],terminated:0,postMessage(value){this.messages.push(value);},terminate(){this.terminated++;}};}
const bytes=new Uint8Array(await readFile(new URL(RUNTIME_MODULE_ASSET.path,new URL('../src/runtime-module.js',import.meta.url))));
const assetURL='https://runtime.invalid/litert_wasm_compat_internal.wasm',response=()=>new Response(bytes,{headers:{'content-type':'application/wasm'}});

test('manual executions receive the prepared stateless module in separate owned Workers',async t=>{
    const workers=[];let preparations=0;const client=runtimeClient({prepareModule:async()=>{preparations++;return module;},createWorker:()=>{const w=worker();workers.push(w);return w;}});t.after(()=>client.cancel());
    for(let i=0;i<2;i++){
        const task=client.check(new Blob(['synthetic']),{eligible:true,inputs:[]});await tick();assert.equal(workers[i].messages.length,1);assert.ok(workers[i].messages[0].runtimeModule===module,'Expected prepared stateless runtime module on every execution.');
        workers[i].onmessage({data:{result:{status:'passed'}}});assert.equal((await task).status,'passed');assert.equal(workers[i].terminated,1);
    }
    assert.equal(preparations,2);assert.notEqual(workers[0],workers[1]);
});
test('cancel during public-module preparation never sends the model or executes a late request',async t=>{
    let ready;const pending=new Promise(resolve=>ready=resolve),w=worker(),client=runtimeClient({prepareModule:()=>pending,createWorker:()=>w});t.after(()=>client.cancel());
    const task=client.check(new Blob(['private payload stays local']),{eligible:true,inputs:[]});await tick();assert.equal(w.messages.length,0);client.cancel();assert.equal((await task).cancelled,true);assert.equal(w.terminated,1);ready(module);await tick();assert.equal(w.messages.length,0);assert.equal(w.terminated,1);
});
test('public cache is lazy and concurrent/repeated requests fetch, verify and compile exactly once',async()=>{
    let fetches=0,compiles=0;const cache=runtimeModuleCache({assetURL,fetcher:async(url,options)=>{fetches++;assert.equal(url,assetURL);assert.equal(options.credentials,'omit');assert.equal(options.redirect,'error');return response();},compile:async b=>{compiles++;assert.equal(b.byteLength,RUNTIME_MODULE_ASSET.bytes);return WebAssembly.compile(b);}});
    assert.equal(fetches,0);assert.equal(compiles,0);const a=cache(),b=cache();assert.ok(a===b);const result=await a;assert.ok(result instanceof WebAssembly.Module);assert.ok(await cache()===result);assert.equal(fetches,1);assert.equal(compiles,1);
});
test('invalid HTTP/MIME/size/digest and broken streams never reach compilation or retain stream locks',async()=>{
    const cases=[()=>new Response('bad',{status:503}),()=>new Response('bad',{headers:{'content-type':'text/html'}}),()=>new Response('bad',{headers:{'content-type':'application/wasm','content-length':String(bytes.length+1)}}),()=>new Response(bytes.subarray(0,8),{headers:{'content-type':'application/wasm'}}),()=>new Response(new Uint8Array(bytes.length+1),{headers:{'content-type':'application/wasm'}}),()=>new Response(new Uint8Array(bytes.length),{headers:{'content-type':'application/wasm'}}),()=>new Response(new ReadableStream({start(c){c.error(Error('stream failed'));}}),{headers:{'content-type':'application/wasm'}})];
    for(const make of cases){let compiles=0,signal;const r=make(),cache=runtimeModuleCache({assetURL,fetcher:async(_,o)=>{signal=o.signal;return r;},compile:async()=>{compiles++;return module;}});await assert.rejects(cache());assert.equal(compiles,0);assert.equal(r.body.locked,false);assert.equal(signal.aborted,true);}
});
test('failed preparation resets only for a later explicit retry, without background retrying',async()=>{
    let fetches=0,compiles=0;const cache=runtimeModuleCache({assetURL,fetcher:async()=>{if(++fetches===1)throw Error('temporary failure');return response();},compile:async()=>{compiles++;return module;}});
    await assert.rejects(cache(),/temporary failure/);await tick();assert.equal(fetches,1);assert.ok(await cache()===module);assert.equal(fetches,2);assert.equal(compiles,1);
});
test('unsupported WASM does not break import or download until explicit manual execution',async()=>{
    let fetches=0;const text=(await readFile(new URL('../src/runtime-module.js',import.meta.url),'utf8')).replaceAll('export ','').replaceAll('import.meta.url',JSON.stringify('https://runtime.invalid/src/runtime-module.js'));
    const prepare=vm.runInNewContext(text+'\nprepareRuntimeModule;',{URL,WebAssembly:undefined,fetch(){fetches++;}});assert.equal(typeof prepare,'function');assert.equal(fetches,0);await assert.rejects(prepare(),/不支援/);assert.equal(fetches,0);
});
test('the original deadline also terminates a Worker still waiting for public preparation',async t=>{
    t.mock.timers.enable({apis:['setTimeout']});const w=worker(),client=runtimeClient({createWorker:()=>w,prepareModule:()=>new Promise(()=>{})});
    try{const task=client.check(new Blob(['synthetic']),{eligible:true,inputs:[]});t.mock.timers.tick(RUNTIME_LIMITS.timeoutMs+1);const r=await task;assert.equal(r.status,'not-verified');assert.match(r.reason,/30 秒/);assert.equal(w.messages.length,0);assert.equal(w.terminated,1);}finally{client.cancel();t.mock.timers.reset();}
});
test('a superseded pending request cannot send its model when shared preparation later completes',async t=>{
    let ready;const pending=new Promise(resolve=>ready=resolve),workers=[],client=runtimeClient({prepareModule:()=>pending,createWorker:()=>{const w=worker();workers.push(w);return w;}});t.after(()=>client.cancel());
    const old=new Blob(['old']),next=new Blob(['next']),a=client.check(old,{eligible:true,inputs:[]}),b=client.check(next,{eligible:true,inputs:[]});assert.equal((await a).cancelled,true);ready(module);await tick();assert.equal(workers[0].messages.length,0);assert.equal(workers[1].messages.length,1);assert.equal(workers[1].messages[0].blob,next);workers[1].onmessage({data:{result:{status:'passed'}}});assert.equal((await b).status,'passed');assert.ok(workers.every(w=>w.terminated===1));
});
test('preparation and clone errors remain unverified and terminate the owned Worker',async()=>{
    for(const stage of ['prepare','clone']){const w=worker();if(stage==='clone')w.postMessage=()=>{throw Error('DataCloneError');};const client=runtimeClient({createWorker:()=>w,prepareModule:async()=>{if(stage==='prepare')throw Error('digest failure');return module;}}),r=await client.check(new Blob(['synthetic']),{eligible:true,inputs:[]});assert.equal(r.status,'not-verified');assert.equal(r.compiled,false);assert.equal(r.invoked,false);assert.equal(w.terminated,1);assert.equal(w.onmessage,null);assert.equal(w.onerror,null);client.cancel();assert.equal(w.terminated,1);}
});
test('ineligible models do not prepare public assets or create any execution Worker',async()=>{
    const client=runtimeClient({createWorker(){throw Error('must not start');},prepareModule(){throw Error('must not download');}}),r=await client.check(new Blob(['synthetic']),{eligible:false,reason:'unsupported'});assert.equal(r.status,'not-verified');assert.equal(r.reason,'unsupported');
});
test('pinned real CPU runtime instantiates the shared module twice with separate state and exact BIN outputs',()=>{
    const raw=execFileSync(process.execPath,[fileURLToPath(new URL('./helpers/runtime-module-reference.mjs',import.meta.url)),'--runtime-module-reference'],{encoding:'utf8',timeout:20000,windowsHide:true});const r=JSON.parse(raw.trim().split('\n').at(-1));assert.equal(r.status,'passed');assert.equal(r.fetches,1);assert.equal(r.compiles,1);assert.equal(r.instances,2);assert.equal(r.identicalInstances,false);assert.equal(r.identicalMemory,false);assert.deepEqual(r.outputs,[[4,6],[40,60]]);
});

test('cancelling one client cannot stop another client waiting for the same stateless public module',async t=>{
    let ready;const pending=new Promise(resolve=>ready=resolve),a=worker(),b=worker(),one=runtimeClient({createWorker:()=>a,prepareModule:()=>pending}),two=runtimeClient({createWorker:()=>b,prepareModule:()=>pending});t.after(()=>{one.cancel();two.cancel();});
    const first=one.check(new Blob(['A']),{eligible:true,inputs:[]}),second=two.check(new Blob(['B']),{eligible:true,inputs:[]});one.cancel();assert.equal((await first).cancelled,true);ready(module);await tick();assert.equal(a.messages.length,0);assert.equal(b.messages.length,1);b.onmessage({data:{result:{status:'passed'}}});assert.equal((await second).status,'passed');assert.equal(a.terminated,1);assert.equal(b.terminated,1);
});
test('cancellation from construction or progress stops preparation and clears the request synchronously',async()=>{
    for(const phase of ['construction','progress']){const w=worker();let prepares=0,client;client=runtimeClient({createWorker:()=>{if(phase==='construction')client.cancel();return w;},prepareModule:async()=>{prepares++;return module;}});const r=await client.check(new Blob(['synthetic']),{eligible:true,inputs:[]},()=>{if(phase==='progress')client.cancel();});assert.equal(r.cancelled,true);assert.equal(w.messages.length,0);assert.equal(w.terminated,1);assert.equal(prepares,0);}
});
