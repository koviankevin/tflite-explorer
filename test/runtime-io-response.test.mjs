import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {runtimeArchive} from '../src/tflite-runtime-archive.js';
import {Archive} from '../vendor/netron/zip.js';

const spec=()=>{const tensor={dtype:'float32',shape:[1048576],toTypedArray:()=>new Float32Array(1048576).fill(7)},detail={dtype:'float32',name:'public/io'};return {validation:{status:'passed'},inputs:[tensor],outputs:[tensor],inputDetails:[detail],outputDetails:[detail],specs:[{mode:'zero'}],modelSHA256:'a'.repeat(64),transferable:true};};
const digest=bytes=>createHash('sha256').update(bytes).digest('hex');
function deferred(){const calls=[];class DeferredResponse{constructor(bytes,options){this.copy=bytes.slice();this.options=options;calls.push(this);}blob(){return new Promise((resolve,reject)=>{this.resolve=()=>resolve(new Blob([this.copy],{type:'application/zip'}));this.reject=reject;});}}return {calls,ResponseType:DeferredResponse};}

test('explicit local Response conversion preserves full8MiB ZIP and retires owned bytes only after validation',async()=>{
    const {prepareRuntimeIOBlob}=await import('../src/runtime-io.js'),io=runtimeArchive(spec()),old=io.archive,expected=old.slice();assert.ok(old.length>8*1024**2);
    const blob=await prepareRuntimeIOBlob(io);assert.ok(blob instanceof Blob);assert.equal(blob.type,'application/zip');assert.equal(blob.size,expected.length);assert.equal(digest(new Uint8Array(await blob.arrayBuffer())),digest(expected));assert.equal(old.byteLength,0);assert.equal(io.archive,blob);assert.equal(await prepareRuntimeIOBlob(io,null),blob);
    const zip=Archive.open(new Uint8Array(await blob.arrayBuffer()),'zip');assert.equal(zip.entries.get('inputs-0.bin').peek().length,4194304);assert.equal(zip.entries.get('outputs-0.bin').peek().length,4194304);
    const python=process.env.PYTHON_BIN||(process.platform==='win32'?'C:/Users/kovia/.cache/codex-runtimes/codex-primary-runtime/dependencies/python/python.exe':'python3');assert.equal(execFileSync(python,['-I','-c','import io,sys,zipfile\nz=zipfile.ZipFile(io.BytesIO(sys.stdin.buffer.read()));assert z.testzip() is None;assert len(z.namelist())==3;print("CRC-OK")'],{input:expected,encoding:'utf8',windowsHide:true}).trim(),'CRC-OK');
});

test('one in-flight conversion is shared; cancel or IO-buffer reuse cannot restore a retired result',async()=>{
    const {prepareRuntimeIOBlob,releaseRuntimeIO,takeRuntimeIOBuffer}=await import('../src/runtime-io.js');
    for(const reuse of [false,true]){const io={archive:Uint8Array.of(1,2,3,4)},f=deferred(),promise=prepareRuntimeIOBlob(io,f.ResponseType);assert.equal(prepareRuntimeIOBlob(io,f.ResponseType),promise);assert.equal(f.calls.length,1);if(reuse){const buffer=takeRuntimeIOBuffer(io);assert.deepEqual([...new Uint8Array(buffer)],[0,0,0,0]);}else releaseRuntimeIO(io);f.calls[0].resolve();assert.equal(await promise,null);assert.equal(io.archive,null);}
});

test('conversion failure keeps bytes retryable, checks capacity/type/length and does not retain a failed request',async()=>{
    const {prepareRuntimeIOBlob,RUNTIME_IO_ARCHIVE_BYTES}=await import('../src/runtime-io.js');
    for(const ResponseType of [null,class {constructor(){throw Error('Response unavailable');}},class {async blob(){return new Blob(['x']);}},class {async blob(){throw Error('Read failed');}}]){const io={archive:Uint8Array.of(1,2,3)},old=io.archive;await assert.rejects(prepareRuntimeIOBlob(io,ResponseType));assert.equal(io.archive,old);assert.deepEqual([...old],[1,2,3]);const blob=await prepareRuntimeIOBlob(io);assert.deepEqual([...new Uint8Array(await blob.arrayBuffer())],[1,2,3]);}
    for(const archive of [new Uint8Array(),new Uint8Array(new ArrayBuffer(8),1,4),new Uint8Array(new SharedArrayBuffer(4)),new Uint8Array(RUNTIME_IO_ARCHIVE_BYTES+1)])await assert.rejects(prepareRuntimeIOBlob({archive}));
});

test('an older cancelled conversion cannot clear or publish a newer request on the same IO object',async()=>{
    const {prepareRuntimeIOBlob,releaseRuntimeIO}=await import('../src/runtime-io.js'),io={archive:Uint8Array.of(1)},f=deferred(),old=prepareRuntimeIOBlob(io,f.ResponseType);releaseRuntimeIO(io);io.archive=Uint8Array.of(2);const current=prepareRuntimeIOBlob(io,f.ResponseType);f.calls[0].resolve();assert.equal(await old,null);assert.equal(prepareRuntimeIOBlob(io,f.ResponseType),current);f.calls[1].resolve();assert.deepEqual([...new Uint8Array(await (await current).arrayBuffer())],[2]);
});

test('download action suppresses duplicate/stale clicks and retries an explicit failure without rerunning inference',async()=>{
    const {runtimeIODownload}=await import('../src/runtime-io-download.js');let io={archive:Uint8Array.of(1)},source={name:'public.tflite'},busy=false,finish,prepareCalls=0,saves=[];
    const action=runtimeIODownload({getState:()=>({io,busy}),getSource:()=>source,saveFile:async(name,blob)=>saves.push({name,blob}),prepare:()=>{prepareCalls++;return new Promise(resolve=>{finish=resolve;});}});
    const first=action.download();assert.equal(action.state.pending,true);assert.equal(await action.download(),false);assert.equal(prepareCalls,1);source={name:'other.tflite'};finish(new Blob(['old']));assert.equal(await first,false);assert.equal(saves.length,0);assert.equal(action.state.pending,false);
    const second=action.download();action.reset();finish(new Blob(['reset']));assert.equal(await second,false);assert.equal(saves.length,0);
    const third=action.download();finish(new Blob(['new']));assert.equal(await third,true);assert.equal(saves.length,1);assert.equal(saves[0].name,'other-runtime-io.zip');assert.equal(action.state.error,'');
    let attempts=0;const retry=runtimeIODownload({getState:()=>({io,busy}),getSource:()=>source,saveFile:async()=>{},prepare:async()=>{if(!attempts++)throw Error('Local conversion failed');return new Blob(['good']);}});assert.equal(await retry.download(),false);assert.match(retry.state.error,/Local conversion failed/);assert.equal(await retry.download(),true);assert.equal(retry.state.error,'');assert.equal(attempts,2);busy=true;assert.equal(await retry.download(),false);
});
