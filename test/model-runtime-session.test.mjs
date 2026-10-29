import test from 'node:test';
import assert from 'node:assert/strict';
import {modelRuntimeSession} from '../src/model-runtime-session.js';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
import {runtimeFixture} from './runtime-fixture.mjs';
import {runtimePlan} from '../src/tflite-runtime-policy.js';
const deferred=()=>{let resolve;const promise=new Promise(r=>{resolve=r;});return {promise,resolve};};
const tick=()=>new Promise(resolve=>setImmediate(resolve));
function fixture({metadata={eligible:true,inputs:[],outputs:[]},choose=async()=>[],check}={}){
    const source=new File(['original'],'same.tflite'),calls=[];let current=source,format='tflite',runtimeCancelled=0,inputsCancelled=0;
    const session=modelRuntimeSession({getSource:()=>current,getFormat:()=>format,prepare:async()=>{calls.push('metadata');return metadata;},inputs:{choose,cancel(){inputsCancelled++;}},runtime:{cancel(){runtimeCancelled++;},async check(...args){calls.push(args);return check?check(...args):{status:'passed',io:{archive:new Blob(['io'])}};}}});
    return {session,source,calls,switch(value){current=value;},format(value){format=value;},get cancels(){return [runtimeCancelled,inputsCancelled];}};
}
test('inspect is metadata-only; manual execution receives the exact opened File and typed inputs',async()=>{
    const specs=[{mode:'bin',file:new File(['bin'],'input.bin')}],f=fixture({choose:async()=>specs});
    await f.session.inspect();assert.deepEqual(f.calls,['metadata']);assert.equal(f.session.state.validation,null);
    await f.session.run();assert.equal(f.calls.length,2);assert.equal(f.calls[1][0],f.source);assert.equal(f.calls[1][3],specs);assert.equal(f.session.state.validation.status,'passed');assert.ok(f.session.state.io.archive);
    f.session.reset();assert.equal(f.session.state.io,null);assert.equal(f.session.state.plan,null);assert.equal(f.session.state.validation,null);
});
test('a same-named new model invalidates the previous IO and metadata',async()=>{
    const f=fixture();await f.session.run();const next=new File(['edited'],'same.tflite');f.switch(next);await f.session.inspect();assert.equal(f.session.state.io,null);assert.equal(f.session.state.validation,null);assert.equal(f.calls.filter(c=>c==='metadata').length,2);await f.session.run();assert.equal(f.calls.at(-1)[0],next);
});
test('cancelled input selection starts no runtime and returns to idle',async()=>{
    const f=fixture({choose:async()=>null});await f.session.run();assert.deepEqual(f.calls,['metadata']);assert.equal(f.session.state.busy,false);assert.equal(f.session.state.validation,null);assert.match(f.session.state.message,/尚未執行/);
});
test('switch/reset during input selection suppresses its late completion',async()=>{
    const pending=deferred(),f=fixture({choose:()=>pending.promise});const task=f.session.run();await tick();f.session.reset();f.switch(new File(['other'],'other.tflite'));pending.resolve([]);await task;assert.deepEqual(f.calls,['metadata']);assert.equal(f.session.state.validation,null);assert.equal(f.session.state.busy,false);
});
test('cancel then restart rejects stale runtime progress, validation and IO',async()=>{
    const pending=deferred();let progress;const f=fixture({check:async(_b,_p,p)=>{progress=p;return pending.promise;}});const task=f.session.run();await tick();f.session.cancel();const cancellation=f.session.state.validation;progress('stale progress');pending.resolve({status:'passed',io:{archive:new Blob(['old'])}});await task;assert.equal(f.session.state.validation,cancellation);assert.equal(f.session.state.io,null);assert.equal(f.session.state.busy,false);assert.deepEqual(f.cancels,[2,2]);
});
test('ineligible custom models skip input selection and the client reports unverified',async()=>{
    const plan={eligible:false,reason:'custom OP',inputs:[],outputs:[]};const f=fixture({metadata:plan,choose:()=>{throw Error('must not choose');},check:async()=>({status:'not-verified',reason:plan.reason})});await f.session.run();assert.equal(f.calls[1][1],plan);assert.equal(f.session.state.validation.status,'not-verified');assert.equal(f.session.state.io,null);
});
test('MLIR never requests runtime metadata or starts an execution',async()=>{
    const f=fixture();f.format('mlir');await f.session.inspect();await f.session.run();assert.deepEqual(f.calls,[]);
});
test('a late metadata response cannot populate another opened model',async()=>{
    const pending=deferred(),f=fixture({metadata:pending.promise});const task=f.session.inspect();f.session.reset();f.switch(new File(['new'],'same.tflite'));pending.resolve({eligible:true,inputs:[],outputs:[]});await task;assert.equal(f.session.state.plan,null);
});
test('actual Worker metadata RPC works without an editor session and returns no model payload',async()=>{
    const source=await readFile(new URL('../src/model-worker.js',import.meta.url),'utf8'),start=source.indexOf('self.onmessage ='),f=await runtimeFixture(),messages=[];
    const context={self:{},index:{raw:f.model},file:f.blob,assertModelEditAction(){},runtimePolicy:{runtimePlan},send:(id,data)=>messages.push({id,data}),postMessage:m=>messages.push(m)};
    Object.defineProperty(context,'editWorkspace',{get(){throw Error('execution must not access editor state');}});
    vm.runInNewContext(source.slice(start).replaceAll('import.meta.url',JSON.stringify('https://example.invalid/model-worker.js')).replace("await import('./tflite-runtime-policy.js')",'runtimePolicy'),context);
    await context.self.onmessage({data:{id:1,action:'modelRuntimeInfo',args:{}}});assert.equal(messages.length,1);assert.equal(messages[0].data.eligible,true);assert.equal(messages[0].data.blob,undefined);assert.equal(messages[0].data.inputs.length,2);
    context.index={mlir:{}};await context.self.onmessage({data:{id:2,action:'modelRuntimeInfo',args:{}}});assert.match(messages[1].error,/TFLite/);
});
