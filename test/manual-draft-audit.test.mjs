import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {installManualDraftReadAudit} from './browser/manual-draft-audit.mjs';
import {installLifecycleAudit} from './browser/lifecycle-audit.mjs';

function realm(){
    class Blob{constructor(size){this.size=size;}async arrayBuffer(){return {byteLength:this.size};}}
    class File extends Blob{slice(start,end){return new Blob(end-start);}}
    const messages=[],self={postMessage:data=>messages.push(structuredClone(data))},context={Blob,File,self,performance};
    vm.runInNewContext(`(${installManualDraftReadAudit.toString()})(20*1024**2);(${installLifecycleAudit.toString()})(true);`,context);
    return {Blob,File,self,messages};
}
test('manual draft identity reads all bytes in order while parser keeps its original realm cap',async()=>{
    const r=realm(),file=r.self.__auditManualDraftFile(new r.File(20*1024**2));
    for(let at=0;at<file.size;at+=1024**2)await file.slice(at,at+1024**2).arrayBuffer();
    const audit=r.messages.findLast(m=>m.__manualDraftAudit).__manualDraftAudit;
    assert.equal(audit.coverageComplete,true);assert.equal(audit.bytes,file.size);assert.equal(audit.calls,20);assert.equal(audit.maxRead,1024**2);assert.deepEqual(audit.violations,[]);
    for(let i=0;i<16;i++)await new r.Blob(1024**2).arrayBuffer();assert.throws(()=>new r.Blob(1).arrayBuffer(),/guard/);
});
test('manual draft identity refuses unknown files, skipped/repeated/oversized slices and duplicate consumption',async()=>{
    const r=realm();assert.throws(()=>r.self.__auditManualDraftFile(new r.File(20)),/Unexpected/);
    for(const [start,end] of [[1,1024],[0,1024**2+1],[-1,1],[0,0]]){
        const f=r.self.__auditManualDraftFile(new r.File(20*1024**2));assert.throws(()=>f.slice(start,end),/coverage/);
    }
    const f=r.self.__auditManualDraftFile(new r.File(20*1024**2)),part=f.slice(0,1024);await part.arrayBuffer();await assert.rejects(part.arrayBuffer(),/Repeated/);assert.throws(()=>f.slice(0,1024),/coverage/);
});
