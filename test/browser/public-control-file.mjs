import assert from 'node:assert/strict';
import {mkdtemp,writeFile,readFile,lstat,unlink,rmdir} from 'node:fs/promises';
import {randomBytes} from 'node:crypto';
import os from 'node:os';
import path from 'node:path';
import {buildEvent,sha256} from '../../scripts/lib/release-artifact.mjs';

// Only a verified public diagnostic asset, never a user-selected model. Closure
// paths/identity remain authoritative even if a caller modifies report metadata.
export async function publicControlFile(bytes,{expectedBytes,expectedSHA256,name='public-runtime.wasm',log=buildEvent,parent=os.tmpdir()}={}){
    assert.ok(['public-runtime.wasm','warm-cancel.tflite','guide-busy.tflite'].includes(name),'Only fixed public diagnostic asset names are allowed.');
    assert.ok(bytes instanceof Uint8Array&&bytes.byteLength>0&&bytes.byteLength<=16*1024**2);
    assert.equal(bytes.byteLength,expectedBytes);assert.match(expectedSHA256,/^[a-f0-9]{64}$/);assert.equal(sha256(bytes),expectedSHA256);
    const id='network-file-'+randomBytes(8).toString('hex'),prefix=path.join(path.resolve(parent),'model-lens-network-file-');
    const record={id,directory:null,path:null,bytes:expectedBytes,sha256:expectedSHA256,status:'planned',directoryRemoved:false,identity:null,events:[]};
    const event=async(kind,target,extra={})=>{const value={schema_version:1,task_id:name==='public-runtime.wasm'?'firefox-network-control':name==='guide-busy.tflite'?'usage-guide-busy':'runtime-warm-cancel',operation_id:id+'-'+target+'-'+kind,artifact_id:id+'-'+target,event:kind,path:target==='directory'?directory??prefix+'<unique>':file,kind:'temporary',purpose:'Verified public diagnostic fixture; never a user-selected model',producer:'test/browser/public-control-file.mjs',inputs:{bytes:expectedBytes,sha256:expectedSHA256},cleanup_condition:'Native consumers finished; unchanged exact file identity and SHA, then empty-directory removal only',retain_until:'bounded diagnostic cleanup',...extra};await log(value);record.events.push({...value,timestamp:new Date().toISOString()});};
    let directory,file,identity,fileRemoved=false,directoryRemoved=false;
    try{
        await event('create_intent','directory');directory=path.resolve(await mkdtemp(prefix));record.directory=directory;await event('created','directory');
        file=path.resolve(directory,name);assert.equal(path.dirname(file),directory);record.path=file;await event('create_intent','file');await writeFile(file,bytes,{flag:'wx'});
        const info=await lstat(file);assert.ok(info.isFile()&&!info.isSymbolicLink());assert.equal(info.size,expectedBytes);assert.equal(sha256(await readFile(file)),expectedSHA256);identity={dev:info.dev,ino:info.ino,size:info.size,mtimeMs:info.mtimeMs};record.identity={...identity};record.status='created';await event('created','file',{size_bytes:info.size,mtime:info.mtime.toISOString(),sha256:expectedSHA256});
    }catch(error){record.error=String(error.message);throw Object.assign(error,{controlAsset:record});}
    return {path:file,record,async cleanup(){
        if(!fileRemoved){
            const info=await lstat(file);assert.ok(info.isFile()&&!info.isSymbolicLink(),'Control file changed kind.');assert.deepEqual({dev:info.dev,ino:info.ino,size:info.size,mtimeMs:info.mtimeMs},identity,'Control file identity changed; retained.');assert.equal(sha256(await readFile(file)),expectedSHA256,'Control file bytes changed; retained.');
            await event('delete_intent','file');await unlink(file);fileRemoved=true;record.status='removed';await event('removed','file');
        }
        if(!directoryRemoved){assert.equal(path.dirname(file),directory);await event('delete_intent','directory');await rmdir(directory);directoryRemoved=true;record.directoryRemoved=true;await event('removed','directory');}
    }};
}
