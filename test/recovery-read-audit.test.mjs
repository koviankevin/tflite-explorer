import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {installLifecycleAudit,installRecoveryReadAudit} from './browser/lifecycle-audit.mjs';
function realm(recovery){
    class Blob{constructor(size){this.size=size;}async arrayBuffer(){return this.size;}}
    class File extends Blob{}
    const messages=[],listeners=new Map(),self={postMessage:data=>messages.push(structuredClone(data)),addEventListener:(name,callback)=>listeners.set(name,callback)},context={Blob,File,self};
    vm.runInNewContext(`(${(recovery?installRecoveryReadAudit:installLifecycleAudit).toString()})(${recovery?20*1024**2:'true'});`,context);
    return {Blob,File,self,messages,send:file=>listeners.get('message')({data:{file}})};
}
test('dedicated identity audit allows exactly one known full file in bounded chunks; parser realm keeps its original 16 MiB cap',async()=>{
    const identity=realm(true);identity.send(new identity.File(20*1024**2));for(let i=0;i<20;i++)await new identity.Blob(1024**2).arrayBuffer();identity.self.postMessage({fingerprint:'a'.repeat(64),bytes:20*1024**2,elapsedMs:100});const audit=identity.messages.findLast(m=>m.__recoveryAudit)?.__recoveryAudit;assert.equal(audit.complete,true);assert.equal(audit.bytes,20*1024**2);assert.equal(audit.maxRead,1024**2);assert.deepEqual(audit.violations,[]);
    const parser=realm(false);for(let i=0;i<16;i++)await new parser.Blob(1024**2).arrayBuffer();assert.throws(()=>new parser.Blob(1024**2).arrayBuffer(),/guard/);
});
test('identity audit refuses unknown files, oversized calls, excess coverage and incomplete success receipts',async()=>{
    const wrong=realm(true);assert.throws(()=>wrong.send(new wrong.File(20)),/Unexpected/);
    const oversized=realm(true);oversized.send(new oversized.File(20*1024**2));assert.throws(()=>new oversized.Blob(1024**2+1).arrayBuffer(),/guard/);
    const partial=realm(true);partial.send(new partial.File(20*1024**2));await new partial.Blob(1024**2).arrayBuffer();assert.throws(()=>partial.self.postMessage({fingerprint:'a'.repeat(64),bytes:20*1024**2,elapsedMs:10}),/Incomplete/);
});
