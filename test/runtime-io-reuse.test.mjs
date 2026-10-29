import {test} from 'node:test';
import assert from 'node:assert/strict';
import {Worker} from 'node:worker_threads';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {runtimeArchive} from '../src/tflite-runtime-archive.js';
import {runtimeClient} from '../src/tflite-runtime-client.js';
import {modelRuntimeSession} from '../src/model-runtime-session.js';
import {Archive} from '../vendor/netron/zip.js';
const module=new WebAssembly.Module(Uint8Array.of(0,97,115,109,1,0,0,0));
const tick=()=>new Promise(r=>setImmediate(r)),deferred=()=>{let resolve;return {promise:new Promise(r=>resolve=r),resolve:v=>resolve(v)};};
const tensor={dtype:'float32',shape:[2],toTypedArray:()=>Float32Array.of(4,6)},detail={dtype:'float32',name:'public'};
const spec={validation:{status:'passed'},inputs:[tensor],outputs:[tensor],inputDetails:[detail],outputDetails:[detail],specs:[{mode:'zero'}],modelSHA256:'a'.repeat(64),transferable:true};
const io=()=>({archive:Uint8Array.of(1,2,3,4)});

test('archive writes into the supplied same-size owned buffer instead of allocating another ZIP',()=>{
    const first=runtimeArchive(spec),buffer=new ArrayBuffer(first.archive.byteLength),next=runtimeArchive({...spec,ioBuffer:buffer});
    assert.equal(next.archive.buffer===buffer,true,'The previous ZIP backing allocation must be reused');
    const zip=Archive.open(next.archive,'zip');assert.deepEqual([...new Float32Array(zip.entries.get('outputs-0.bin').peek().slice().buffer)],[4,6]);
});

test('recycling clears data before real ownership transfer and preserves download fallback',async()=>{
    const {takeRuntimeIOBuffer,releaseRuntimeIOBuffer,runtimeIOBlob}=await import('../src/runtime-io.js'),old=io(),view=old.archive,buffer=takeRuntimeIOBuffer(old);
    assert.equal(old.archive,null);assert.equal(view.byteLength,0);assert.deepEqual([...new Uint8Array(buffer)],[0,0,0,0]);releaseRuntimeIOBuffer(buffer);assert.equal(buffer.byteLength,0);
    const completed=runtimeArchive(spec),blob=runtimeIOBlob(completed);assert.equal(takeRuntimeIOBuffer(completed),null);assert.equal(completed.archive,null);assert.ok((await blob.arrayBuffer()).byteLength>0);
});

test('resized and no-transfer fallback buffers retain complete valid ZIP data within the cap',async()=>{
    const {takeRuntimeIOBuffer,releaseRuntimeIOBuffer,RUNTIME_IO_ARCHIVE_BYTES}=await import('../src/runtime-io.js');
    for(const size of [1,4096]){const buffer=new ArrayBuffer(size),result=runtimeArchive({...spec,ioBuffer:buffer});assert.equal(buffer.byteLength,0);assert.equal(result.archive.byteOffset,0);assert.equal(result.archive.byteLength,result.archive.buffer.byteLength);assert.ok(Archive.open(result.archive,'zip').entries.has('manifest.json'));}
    for(const buffer of [new ArrayBuffer(0),new SharedArrayBuffer(4),new Uint8Array(4),new ArrayBuffer(RUNTIME_IO_ARCHIVE_BYTES+1)])assert.throws(()=>runtimeArchive({...spec,ioBuffer:buffer}));
    assert.throws(()=>runtimeArchive({...spec,transferable:false,ioBuffer:new ArrayBuffer(8)}));
    const descriptor=Object.getOwnPropertyDescriptor(ArrayBuffer.prototype,'transfer');
    try{Object.defineProperty(ArrayBuffer.prototype,'transfer',{value:undefined,configurable:true});const prior=io(),old=prior.archive,buffer=takeRuntimeIOBuffer(prior);assert.equal(old.byteLength,0);assert.ok(new Uint8Array(buffer).every(n=>n===0));const result=runtimeArchive({...spec,ioBuffer:buffer});assert.ok(Archive.open(result.archive,'zip').entries.has('outputs-0.bin'));releaseRuntimeIOBuffer(result.archive.buffer);assert.ok(result.archive.every(n=>n===0));}
    finally{if(descriptor)Object.defineProperty(ArrayBuffer.prototype,'transfer',descriptor);else delete ArrayBuffer.prototype.transfer;}
});

test('cancel, preparation failure, clone failure and ineligible plans retire unsent scratch',async()=>{
    for(const mode of ['cancel','prepare','clone','ineligible','construct']){
        const pending=deferred(),buffer=new ArrayBuffer(32),w={sent:0,closed:0,postMessage(){this.sent++;if(mode==='clone')throw Error('clone');},terminate(){this.closed++;}},client=runtimeClient({createWorker:()=>{if(mode==='construct')throw Error('construct');return w;},prepareModule:()=>mode==='prepare'?Promise.reject(Error('prepare')):pending.promise});
        const task=client.check(new File(['model'],'public.tflite'),{eligible:mode!=='ineligible',inputs:[]},()=>{},[],buffer);
        if(mode==='cancel')client.cancel();else if(mode==='clone')pending.resolve(module);
        const result=await task;assert.equal(result.status,'not-verified');assert.equal(buffer.byteLength,0,mode);pending.resolve(module);await tick();assert.equal(w.sent,mode==='clone'?1:0);assert.equal(w.closed,['ineligible','construct'].includes(mode)?0:1);
    }
});

test('session passes only zeroed detached prior IO to the next manual execution',async()=>{
    const {releaseRuntimeIOBuffer}=await import('../src/runtime-io.js'),first=io(),old=first.archive,source=new File(['model'],'public.tflite');let calls=0;
    const session=modelRuntimeSession({getSource:()=>source,getFormat:()=> 'tflite',prepare:async()=>({eligible:true}),inputs:{choose:async()=>[],cancel(){}},runtime:{cancel(){},check(_file,_plan,_progress,_specs,buffer){calls++;if(calls===1){assert.equal(buffer,null);return Promise.resolve({status:'passed',io:first});}assert.equal(old.byteLength,0);assert.ok(buffer instanceof ArrayBuffer);assert.ok(new Uint8Array(buffer).every(n=>n===0));releaseRuntimeIOBuffer(buffer);return Promise.resolve({status:'passed',io:io()});}}});
    await session.run();await session.run();assert.equal(first.archive,null);assert.equal(session.state.validation.status,'passed');session.reset();
});

test('session cancellation during input selection and a synchronous client error release scratch',async()=>{
    const descriptor=Object.getOwnPropertyDescriptor(ArrayBuffer.prototype,'transfer'),moves=[];
    try{Object.defineProperty(ArrayBuffer.prototype,'transfer',{...descriptor,value:function(...args){const result=descriptor.value.apply(this,args);moves.push({buffer:result,size:result.byteLength});return result;}});
        for(const action of ['cancel','reset','source','throw']){
            const first=io(),source=new File(['model'],'public.tflite'),pending=deferred();let chooses=0,checks=0,current=source;
            const session=modelRuntimeSession({getSource:()=>current,getFormat:()=> 'tflite',prepare:async()=>({eligible:true}),inputs:{choose:()=>++chooses===1||action==='throw'?[]:pending.promise,cancel(){}},runtime:{cancel(){},check(){if(++checks===1)return Promise.resolve({status:'passed',io:first});throw Error('synchronous client error');}}});
            await session.run();const before=moves.length,task=session.run();await tick();const buffer=moves.slice(before).find(m=>m.size===4)?.buffer;assert.ok(buffer);if(action==='throw'){await task;assert.match(session.state.message,/synchronous/);}else{if(action==='source'){current=new File(['new'],'public.tflite');await session.inspect();}else session[action]();pending.resolve(null);await task;}assert.equal(buffer.byteLength,0,action);session.reset();
        }
    }finally{Object.defineProperty(ArrayBuffer.prototype,'transfer',descriptor);}
});

test('three fresh real Workers reuse full8MiB ZIP storage with zeroed handoff and exact output bytes',async()=>{
    const {takeRuntimeIOBuffer,runtimeIOBlob}=await import('../src/runtime-io.js'),workers=[];let current=null;
    const client=runtimeClient({prepareModule:async()=>module,createWorker:()=>{const native=new Worker(new URL('./helpers/runtime-io-reuse-worker.mjs',import.meta.url)),row={native,closed:false};row.exit=new Promise(resolve=>native.once('exit',code=>{row.closed=true;resolve(code);}));const wrapper={postMessage:(m,t)=>native.postMessage(m,t),terminate:()=>native.terminate()};native.on('message',data=>wrapper.onmessage?.({data}));native.on('error',error=>wrapper.onerror?.({message:error.message,preventDefault(){}}));workers.push(row);return wrapper;}});
    try{for(let round=1;round<=3;round++){const buffer=current?takeRuntimeIOBuffer(current.io):null,task=client.check(new File(['public'],'public.tflite'),{eligible:true,inputs:[],round},()=>{},[],buffer);current=await task;await workers.at(-1).exit;assert.equal(current.status,'passed');assert.equal(current.scratch.provided,round>1);assert.equal(current.scratch.zeroBefore,true);assert.equal(current.scratch.reused,round>1);if(buffer)assert.equal(buffer.byteLength,0);const zip=Archive.open(current.io.archive,'zip'),expected=createHash('sha256').update(new Uint8Array(new Float32Array(1048576).fill(round).buffer)).digest('hex');for(const name of ['inputs-0.bin','outputs-0.bin'])assert.equal(createHash('sha256').update(zip.entries.get(name).peek()).digest('hex'),expected);}
        const old=current.io.archive,blob=runtimeIOBlob(current.io);assert.equal(old.byteLength,0);const bytes=new Uint8Array(await blob.arrayBuffer()),python=process.env.PYTHON_BIN||(process.platform==='win32'?'python':'python3');assert.equal(execFileSync(python,['-I','-c',"import io,sys,zipfile\nz=zipfile.ZipFile(io.BytesIO(sys.stdin.buffer.read()));assert z.testzip() is None;assert len(z.read('outputs-0.bin'))==4194304;print('CRC-OK')"],{input:bytes,encoding:'utf8',windowsHide:true,timeout:10000}).trim(),'CRC-OK');assert.equal(workers.length,3);assert.ok(workers.every(w=>w.closed));
    }finally{client.cancel();await Promise.all(workers.map(w=>w.native.terminate()));}
});

test('real CPU execution accepts recycled IO across fresh Instances and retains exact numerical outputs',()=>{
    const raw=execFileSync(process.execPath,[fileURLToPath(new URL('./helpers/runtime-module-reference.mjs',import.meta.url)),'--runtime-module-reference','--binary-io','--reuse-io'],{encoding:'utf8',timeout:20000,windowsHide:true}),r=JSON.parse(raw.trim().split('\n').at(-1));assert.equal(r.status,'passed');assert.equal(r.reuseIO,true);assert.equal(r.recycledHandoffs,1);assert.equal(r.identicalInstances,false);assert.equal(r.identicalMemory,false);assert.deepEqual(r.outputs,[[4,6],[40,60]]);
});
