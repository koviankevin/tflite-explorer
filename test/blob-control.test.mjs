import {test} from 'node:test';
import assert from 'node:assert/strict';
import {runInNewContext} from 'node:vm';
import {installBlobControlWorker,installBlobControlPage,blobControlSettings} from './browser/blob-control-program.mjs';
import {PHYSICAL_SOURCE_BYTES} from './physical-tflite-fixture.mjs';

function virtualFile(){
    const reads=[],constructors=[];
    class Blob{
        constructor(parts,options={}){this.size=parts.reduce((n,p)=>n+(p.byteLength??p.size),0);this.type=options.type||'';constructors.push(parts);}
        slice(start=0,end=this.size){assert.ok(start>=0&&end>=start&&end<=this.size);return {start,end,size:end-start};}
        arrayBuffer(){throw Error('A full virtual body must never be read.');}
    }
    class File extends Blob{constructor(parts,name,options={}){super(parts,options);this.name=name;}}
    class FileReaderSync{readAsArrayBuffer(slice){reads.push([slice.start,slice.end]);assert.ok(slice.size<=1024**2);return new ArrayBuffer(slice.size);}}
    const file=Object.assign(Object.create(File.prototype),{size:PHYSICAL_SOURCE_BYTES,name:'physical.tflite',type:'application/octet-stream'});
    return {Blob,File,FileReaderSync,file,reads,constructors};
}
const env={GITHUB_ACTIONS:'true',GITHUB_REPOSITORY:'koviankevin/tflite-explorer',GITHUB_WORKFLOW:'Physical File Blob control',GITHUB_REF:'refs/heads/main',GITHUB_EVENT_NAME:'workflow_dispatch',DESKTOP_ENGINE:'firefox'};

test('boundary probe reads exactly sixty-four bytes across the typed-prefix/File boundary, once and before sharing',()=>{
    const v=virtualFile(),messages=[],scope={...v,postMessage:m=>messages.push(m)};installBlobControlWorker(scope);
    scope.onmessage({data:{action:'build',file:v.file}});scope.onmessage({data:{action:'readback'}});
    scope.onmessage({data:{action:'boundary'}});
    assert.equal(messages.at(-1).stage,'boundary');
    assert.deepEqual(v.reads,[[0,65536],[0,64],[PHYSICAL_SOURCE_BYTES-64,PHYSICAL_SOURCE_BYTES],[65504,65568]]);
    assert.equal(messages.at(-1).stats.boundaryReads,1);assert.equal(messages.at(-1).stats.readBytes,65728);
    scope.onmessage({data:{action:'boundary'}});assert.equal(messages.at(-1).stage,'error');assert.equal(v.reads.length,4);
    scope.onmessage({data:{action:'share'}});assert.equal(messages.at(-1).stage,'shared');
    const other=virtualFile(),early=[],s={...other,postMessage:m=>early.push(m)};installBlobControlWorker(s);
    s.onmessage({data:{action:'build',file:other.file}});s.onmessage({data:{action:'boundary'}});
    assert.equal(early.at(-1).stage,'error');assert.deepEqual(other.reads,[[0,65536]]);
    s.onmessage({data:{action:'readback'}});s.onmessage({data:{action:'share'}});assert.equal(early.at(-1).stage,'error');
});

test('standalone Blob control rejects non-hosted, non-main, non-manual and unknown engine execution',()=>{
    assert.deepEqual(blobControlSettings(env,'linux'),{engine:'firefox'});assert.equal(blobControlSettings({...env,DESKTOP_ENGINE:'webkit'},'linux').engine,'webkit');
    for(const [name,value] of Object.entries({GITHUB_ACTIONS:'false',GITHUB_REPOSITORY:'other/repo',GITHUB_WORKFLOW:'other',GITHUB_REF:'refs/pull/1/merge',GITHUB_EVENT_NAME:'push',DESKTOP_ENGINE:'chromium'}))assert.throws(()=>blobControlSettings({...env,[name]:value},'linux'));
    for(const platform of ['win32','darwin'])assert.throws(()=>blobControlSettings(env,platform));
});

test('real control worker preserves a virtual >1 GiB range and bounds the prefix, endpoints and boundary read',()=>{
    const v=virtualFile(),messages=[],scope={...v,postMessage:m=>messages.push(m)};installBlobControlWorker(scope);
    scope.onmessage({data:{action:'build',file:v.file}});scope.onmessage({data:{action:'readback'}});scope.onmessage({data:{action:'boundary'}});scope.onmessage({data:{action:'share'}});
    assert.deepEqual(messages.map(m=>m.stage),['built','readback','boundary','shared']);assert.equal(messages[3].blob.size,PHYSICAL_SOURCE_BYTES);assert.deepEqual(v.reads,[[0,65536],[0,64],[PHYSICAL_SOURCE_BYTES-64,PHYSICAL_SOURCE_BYTES],[65504,65568]]);
    assert.equal(v.constructors[0][0].byteLength,65536);assert.equal(v.constructors[0][1].size,PHYSICAL_SOURCE_BYTES-65536);assert.equal(v.constructors[1][0],messages[3].blob);
    assert.deepEqual(messages[3].stats,{inputBytes:PHYSICAL_SOURCE_BYTES,blobBytes:PHYSICAL_SOURCE_BYTES,readBytes:65728,maxRead:65536,builds:1,readbacks:1,boundaryReads:1,shares:1});
    assert.equal(messages.slice(0,3).some(m=>Object.hasOwn(m,'blob')),false);
});

test('control worker refuses small or invalid sources, duplicate build/share and out-of-order actions',()=>{
    for(const data of [{action:'readback'},{action:'share'},{action:'unknown'},{action:'build',file:{size:1024**3}},{action:'build',file:{size:NaN}}]){
        const v=virtualFile(),messages=[],scope={...v,postMessage:m=>messages.push(m)};installBlobControlWorker(scope);scope.onmessage({data});assert.equal(messages[0].stage,'error');assert.deepEqual(v.reads,[]);
    }
    const v=virtualFile(),messages=[],scope={...v,postMessage:m=>messages.push(m)};installBlobControlWorker(scope);scope.onmessage({data:{action:'build',file:v.file}});scope.onmessage({data:{action:'build',file:v.file}});assert.equal(messages.at(-1).stage,'error');assert.equal(v.reads.length,1);
    scope.onmessage({data:{action:'readback'}});scope.onmessage({data:{action:'boundary'}});scope.onmessage({data:{action:'share'}});scope.onmessage({data:{action:'share'}});assert.equal(messages.at(-1).stage,'error');assert.equal(v.reads.length,4);
});

test('actual page and worker callbacks drive native-control order and retain the natural sixty-second URL timer',()=>{
    const v=virtualFile(),elements=new Map(['choose','file','build','readback','boundary','share','url','download','wrap','clear','state'].map(id=>[id,{id,disabled:false,textContent:'',value:'',files:[]}])) ,timers=[],downloads=[],revokes=[],workers=[];let now=0;
    class Worker{
        constructor(url,options){assert.equal(url,'/worker.js');assert.equal(options.type,'module');workers.push(this);this.scope={...v,postMessage:data=>this.onmessage({data})};installBlobControlWorker(this.scope);}
        postMessage(data){this.scope.onmessage({data});}terminate(){this.terminated=true;}
    }
    const document={getElementById:id=>elements.get(id),createElement:()=>({click(){downloads.push({href:this.href,name:this.download});},remove(){}}),body:{append(){}}};
    runInNewContext('('+installBlobControlPage.toString()+')()',{document,Worker,File:v.File,URL:{createObjectURL:()=> 'blob:control',revokeObjectURL:url=>revokes.push(url)},performance:{now:()=>now},setTimeout:(fn,ms)=>timers.push({fn,ms})});
    const state=()=>JSON.parse(elements.get('state').textContent);assert.equal(state().stage,'initial');elements.get('file').files=[v.file];elements.get('file').value='physical.tflite';elements.get('file').onchange();
    const stages=[['build','built'],['readback','readback'],['boundary','boundary'],['share','shared'],['url','url'],['download','downloaded'],['wrap','wrapped'],['clear','cleared']];
    for(const [action,expected] of stages){assert.equal(elements.get(action).disabled,false);elements.get(action).onclick();assert.equal(state().stage,expected);}
    assert.deepEqual(downloads,[{href:'blob:control',name:'blob-control.tflite'}]);assert.equal(workers[0].terminated,true);assert.equal(state().bytes,0);assert.equal(elements.get('file').value,'');assert.deepEqual(revokes,[]);assert.equal(timers.length,1);assert.equal(timers[0].ms,60000);
    now=60000;timers[0].fn();assert.deepEqual(revokes,['blob:control']);assert.equal(state().stage,'revoked');assert.equal(state().urlRevokedAt-state().urlCreatedAt,60000);assert.equal(state().stats.readBytes,65728);
});
