import test from 'node:test';
import assert from 'node:assert/strict';
import {editRecoveryFingerprint} from '../src/edit-recovery-fingerprint.js';
function fixture(){const workers=[],progress=[];const factory=editRecoveryFingerprint({createWorker:()=>{const w={terminated:false,postMessage(data){this.input=data;},terminate(){this.terminated=true;}};workers.push(w);return w;},progress:(...v)=>progress.push(v)});return {factory,workers,progress};}
test('fingerprint runs once for an immutable File, shares pending work, validates replies and terminates its worker',async()=>{
    const f=fixture(),file={size:3};const first=f.factory.read(file),second=f.factory.read(file);assert.equal(first,second);const worker=f.workers[0],id=worker.input.id;worker.onmessage({data:{id,done:3,total:3}});assert.deepEqual(f.progress,[[3,3]]);worker.onmessage({data:{id,fingerprint:'a'.repeat(64),bytes:3}});assert.equal(await first,'a'.repeat(64));assert.equal(worker.terminated,true);assert.equal(await f.factory.read(file),'a'.repeat(64));assert.equal(f.workers.length,1);
});
test('cancel/source changes reject only the old task; late worker responses cannot replace the active identity',async()=>{
    const f=fixture(),first=f.factory.read({size:3}),rejected=assert.rejects(first,{name:'AbortError'}),second=f.factory.read({size:4});await rejected;assert.equal(f.workers[0].terminated,true);f.workers[0].onmessage({data:{id:1,fingerprint:'a'.repeat(64),bytes:3}});f.workers[1].onmessage({data:{id:2,fingerprint:'b'.repeat(64),bytes:4}});assert.equal(await second,'b'.repeat(64));assert.ok(f.workers.every(w=>w.terminated));
});
test('malformed replies and synchronous post failures terminate the worker and never enter the identity cache',async()=>{
    const f=fixture(),file={size:3},pending=f.factory.read(file),rejected=assert.rejects(pending,/不符/);f.workers[0].onmessage({data:{id:1,fingerprint:'a'.repeat(64),bytes:4}});await rejected;assert.equal(f.workers[0].terminated,true);
    const factory=editRecoveryFingerprint({createWorker:()=>({postMessage(){throw Error('clone failed');},terminate(){}})});await assert.rejects(factory.read(file),/clone failed/);
});
