import test from 'node:test';
import assert from 'node:assert/strict';
import {editRecoveryFingerprint} from '../src/edit-recovery-fingerprint.js';
import {editRecoverySession} from '../src/edit-recovery-session.js';
function fixture(){const workers=[],progress=[];const factory=editRecoveryFingerprint({createWorker:()=>{const w={terminated:false,postMessage(data){this.input=data;},terminate(){this.terminated=true;}};workers.push(w);return w;},progress:(...v)=>progress.push(v)});return {factory,workers,progress};}
test('fingerprint runs once for an immutable File, shares pending work, validates replies and terminates its worker',async()=>{
    const f=fixture(),file={size:3};const first=f.factory.read(file),second=f.factory.read(file);assert.equal(first,second);await Promise.resolve();const worker=f.workers[0],id=worker.input.id;worker.onmessage({data:{id,done:3,total:3}});assert.deepEqual(f.progress,[[3,3]]);worker.onmessage({data:{id,fingerprint:'a'.repeat(64),bytes:3}});assert.equal(await first,'a'.repeat(64));assert.equal(worker.terminated,true);assert.equal(await f.factory.read(file),'a'.repeat(64));assert.equal(f.workers.length,1);
});
test('cancel/source changes reject only the old task; late worker responses cannot replace the active identity',async()=>{
    const f=fixture(),first=f.factory.read({size:3}),rejected=assert.rejects(first,{name:'AbortError'});await Promise.resolve();const late=f.workers[0].onmessage,second=f.factory.read({size:4});await rejected;assert.equal(f.workers[0].terminated,true);assert.equal(f.workers[0].onmessage,null);assert.equal(f.workers[0].onerror,null);late({data:{id:1,fingerprint:'a'.repeat(64),bytes:3}});f.workers[1].onmessage({data:{id:2,fingerprint:'b'.repeat(64),bytes:4}});assert.equal(await second,'b'.repeat(64));assert.ok(f.workers.every(w=>w.terminated));
});
test('malformed replies and synchronous post failures terminate the worker and never enter the identity cache',async()=>{
    const f=fixture(),file={size:3},pending=f.factory.read(file),rejected=assert.rejects(pending,/不符/);await Promise.resolve();f.workers[0].onmessage({data:{id:1,fingerprint:'a'.repeat(64),bytes:4}});await rejected;assert.equal(f.workers[0].terminated,true);
    const factory=editRecoveryFingerprint({createWorker:()=>({postMessage(){throw Error('clone failed');},terminate(){}})});await assert.rejects(factory.read(file),/clone failed/);
});
test('detaching a changed edit session cancels its same-turn preparation before creating a Worker',async()=>{
    const f=fixture(),session=editRecoverySession({store:{save(){assert.fail('cancelled preparation must not persist');}},capture:()=>f.factory.read({size:3}),delay:60000});
    session.attach();session.change();const pending=session.detach();f.factory.cancel();await pending;await Promise.resolve();assert.equal(f.workers.length,0);
});
test('native Worker construction failure rejects the identity promise without leaving a task active',async()=>{
    let attempts=0;const factory=editRecoveryFingerprint({createWorker:()=>{attempts++;throw Error('constructor failed');}}),file={size:3};
    await assert.rejects(()=>factory.read(file),/constructor failed/);await assert.rejects(()=>factory.read(file),/constructor failed/);factory.cancel();assert.equal(attempts,2);
});
test('completion removes File-capturing callbacks before native termination',async()=>{
    let worker;const factory=editRecoveryFingerprint({createWorker:()=>worker={postMessage(data){this.id=data.id;},terminate(){assert.equal(this.onmessage,null);assert.equal(this.onerror,null);}}});
    const pending=factory.read({size:3});await Promise.resolve();worker.onmessage({data:{id:worker.id,fingerprint:'a'.repeat(64),bytes:3}});assert.equal(await pending,'a'.repeat(64));
});
test('replacing queued work skips only the cancelled source and still computes the latest identity',async()=>{
    const f=fixture(),first=f.factory.read({size:3}),cancelled=assert.rejects(first,{name:'AbortError'}),latest=f.factory.read({size:4});await cancelled;assert.equal(f.workers.length,1);assert.equal(f.workers[0].input.file.size,4);f.workers[0].onmessage({data:{id:2,fingerprint:'b'.repeat(64),bytes:4}});assert.equal(await latest,'b'.repeat(64));
});
test('native error cleanup clears callbacks and rejects only once, then permits a fresh retry',async()=>{
    const f=fixture(),file={size:3},pending=f.factory.read(file),rejected=assert.rejects(pending,/native failure/);await Promise.resolve();const fail=f.workers[0].onerror;let prevented=false;fail({message:'native failure',preventDefault(){prevented=true;}});await rejected;assert.equal(prevented,true);assert.equal(f.workers[0].onmessage,null);assert.equal(f.workers[0].onerror,null);assert.equal(f.workers[0].terminated,true);fail({message:'stale'});
    const retry=f.factory.read(file);await Promise.resolve();assert.equal(f.workers.length,2);f.workers[1].onmessage({data:{id:2,fingerprint:'c'.repeat(64),bytes:3}});assert.equal(await retry,'c'.repeat(64));
});
