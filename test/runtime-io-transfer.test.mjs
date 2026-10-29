import {test} from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {Worker} from 'node:worker_threads';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {runtimeArchive} from '../src/tflite-runtime-archive.js';
import {Archive} from '../vendor/netron/zip.js';

const tensor={dtype:'float32',shape:[2],toTypedArray:()=>Float32Array.of(4,6)},detail={dtype:'float32',name:'public/input'},spec={validation:{status:'passed',compiled:true,invoked:true},inputs:[tensor],outputs:[tensor],inputDetails:[detail],outputDetails:[detail],specs:[{mode:'zero'}],modelSHA256:'a'.repeat(64)};
function verify(bytes){const zip=Archive.open(bytes,'zip');assert.deepEqual([...zip.entries.keys()].sort(),['inputs-0.bin','manifest.json','outputs-0.bin']);for(const name of ['inputs-0.bin','outputs-0.bin'])assert.deepEqual([...new Float32Array(zip.entries.get(name).peek().slice().buffer)],[4,6]);const m=JSON.parse(new TextDecoder().decode(zip.entries.get('manifest.json').peek()));assert.equal(m.modelSHA256,'a'.repeat(64));assert.equal(m.byteOrder,'little-endian');assert.equal(m.validation.status,'passed');return m;}
test('explicit transferable archive mode creates an owned byte buffer with exact ZIP data and independent CRC',()=>{
    const bundle=runtimeArchive({...spec,transferable:true});assert.ok(bundle.archive instanceof Uint8Array,'Browser execution must not build a Blob before explicit download');assert.equal(bundle.archive.byteOffset,0);assert.equal(bundle.archive.byteLength,bundle.archive.buffer.byteLength);verify(bundle.archive);
    const python=process.env.PYTHON_BIN||(process.platform==='win32'?'python':'python3'),out=execFileSync(python,['-I','-c',"import io,sys,zipfile,struct\nz=zipfile.ZipFile(io.BytesIO(sys.stdin.buffer.read()));assert z.testzip() is None;assert len(z.namelist())==3;assert struct.unpack('<2f',z.read('outputs-0.bin'))==(4,6);print('CRC-OK')"],{input:bundle.archive,encoding:'utf8',windowsHide:true,timeout:10000});assert.equal(out.trim(),'CRC-OK');
});
test('download Blob is created only on request; real structured transfer detaches old ownership',async()=>{
    const {runtimeIOTransfers,runtimeIOBlob}=await import('../src/runtime-io.js'),NativeBlob=globalThis.Blob;let blobs=0;globalThis.Blob=class extends NativeBlob{constructor(...args){super(...args);blobs++;}};
    try{const io=runtimeArchive({...spec,transferable:true});assert.equal(blobs,0);const list=runtimeIOTransfers(io);assert.deepEqual(list,[io.archive.buffer]);const received=structuredClone(io,{transfer:list});assert.equal(io.archive.byteLength,0);assert.ok(received.archive.byteLength>0);assert.equal(blobs,0);verify(received.archive);const blob=runtimeIOBlob(received);assert.equal(blobs,1);assert.equal(blob.type,'application/zip');assert.deepEqual(new Uint8Array(await blob.arrayBuffer()),received.archive);assert.equal(runtimeIOBlob({archive:blob}),blob);assert.equal(blobs,1);}
    finally{globalThis.Blob=NativeBlob;}
});
test('transport rejects empty, partial, shared, oversized or Blob archives before sending',async()=>{
    const {runtimeIOTransfers,runtimeIOBlob,RUNTIME_IO_ARCHIVE_BYTES}=await import('../src/runtime-io.js');assert.deepEqual(runtimeIOTransfers(null),[]);
    for(const archive of [new Uint8Array(),new Uint8Array(new ArrayBuffer(8),1,4),new Uint8Array(new SharedArrayBuffer(8)),new Uint8Array(RUNTIME_IO_ARCHIVE_BYTES+1),{},'zip']){assert.throws(()=>runtimeIOTransfers({archive}));assert.throws(()=>runtimeIOBlob({archive}));}
    assert.throws(()=>runtimeIOTransfers({archive:new Blob(['legacy'])}));const legacy=runtimeArchive(spec);assert.ok(legacy.archive instanceof Blob);verify(new Uint8Array(await legacy.archive.arrayBuffer()));
    for(const archive of [new Blob(),new Blob([new Uint8Array(RUNTIME_IO_ARCHIVE_BYTES+1)])])assert.throws(()=>runtimeIOBlob({archive}));
});
test('a real Worker transfers full8MiB tensor IO with exact hashes and ZIP CRC without Blob messaging',async()=>{
    const worker=new Worker(new URL('./helpers/runtime-io-worker.mjs',import.meta.url),{workerData:{large:true}}),messages=[];let timer;
    try{await new Promise((resolve,reject)=>{timer=setTimeout(()=>reject(Error('Large IO Worker did not exit')),10000);worker.on('message',m=>messages.push(m));worker.once('error',reject);worker.once('exit',code=>code===0?resolve():reject(Error('Large IO Worker exit '+code)));});assert.equal(messages.length,2);const bytes=messages[0].archive;assert.ok(bytes instanceof Uint8Array&&bytes.byteLength>8*1024**2);assert.deepEqual(messages[1],{detached:true,bytes:0});const zip=Archive.open(bytes,'zip'),hash=b=>createHash('sha256').update(b).digest('hex'),expected=hash(new Uint8Array(new Float32Array(1048576).fill(7).buffer));for(const name of ['inputs-0.bin','outputs-0.bin'])assert.equal(hash(zip.entries.get(name).peek()),expected);const python=process.env.PYTHON_BIN||(process.platform==='win32'?'python':'python3');assert.equal(execFileSync(python,['-I','-c',"import io,sys,zipfile\nz=zipfile.ZipFile(io.BytesIO(sys.stdin.buffer.read()));assert z.testzip() is None;assert len(z.read('outputs-0.bin'))==4194304;print('CRC-OK')"],{input:bytes,encoding:'utf8',windowsHide:true,timeout:10000}).trim(),'CRC-OK');}
    finally{clearTimeout(timer);await worker.terminate();}
});
test('a real Node Worker sends archive ownership, reports actual detachment and exits normally',async()=>{
    const worker=new Worker(new URL('./helpers/runtime-io-worker.mjs',import.meta.url)),messages=[];let timer;
    try{await new Promise((resolve,reject)=>{timer=setTimeout(()=>reject(Error('IO Worker did not exit')),5000);worker.on('message',m=>messages.push(m));worker.once('error',reject);worker.once('exit',code=>code===0?resolve():reject(Error('IO Worker exit '+code)));});assert.equal(messages.length,2);assert.ok(messages[0].archive instanceof Uint8Array);verify(messages[0].archive);assert.deepEqual(messages[1],{detached:true,bytes:0});}
    finally{clearTimeout(timer);await worker.terminate();}
});
test('real finite CPU reference preserves exact outputs with binary IO and separate fresh runtime memory',()=>{
    const raw=execFileSync(process.execPath,[fileURLToPath(new URL('./helpers/runtime-module-reference.mjs',import.meta.url)),'--runtime-module-reference','--binary-io'],{encoding:'utf8',timeout:20000,windowsHide:true}),r=JSON.parse(raw.trim().split('\n').at(-1));assert.equal(r.status,'passed');assert.equal(r.binaryIO,true);assert.equal(r.fetches,1);assert.equal(r.compiles,1);assert.equal(r.identicalInstances,false);assert.equal(r.identicalMemory,false);assert.deepEqual(r.outputs,[[4,6],[40,60]]);
});
