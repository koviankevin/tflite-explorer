import test from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {runtimeArchive} from '../src/tflite-runtime-archive.js';
import {runtimeIOTransfers,prepareRuntimeIOBlob,takeRuntimeIOBuffer,releaseRuntimeIO} from '../src/runtime-io.js';
import {Archive} from '../vendor/netron/zip.js';
const good=(values=[1.25,-2.5])=>({dtype:'float32',shape:[values.length],toTypedArray:()=>Float32Array.from(values)});
const bad=()=>({...good(),toTypedArray:()=>{throw Error('Tensors with strides or padding are not yet supported.');}});
const detail={name:'public tensor',dtype:'float32'},spec=(outputs=[bad(),good([3,4])])=>({validation:{status:'failed',invoked:true,reason:'output contract mismatch'},inputs:[good()],outputs,inputDetails:[detail],outputDetails:outputs.map(()=>detail),specs:[{mode:'zero'}],modelSHA256:'a'.repeat(64),transferable:true});
const open=bytes=>{const z=Archive.open(bytes,'zip');return {z,m:JSON.parse(new TextDecoder().decode(z.entries.get('manifest.json').peek()))};};

test('a missing output preserves other exact BINs and slot numbers with a partial v2 manifest and valid CRC',()=>{
    const io=runtimeArchive(spec([good([8,9]),bad(),good([3,4])])),{z,m}=open(io.archive);
    assert.equal(m.version,2);assert.equal(m.capture.status,'partial');assert.equal(m.capture.saved,3);assert.equal(m.capture.requested,4);assert.equal(m.capture.savedBytes,24);assert.equal(m.validation.status,'failed');assert.equal(m.validation.invoked,true);
    assert.deepEqual([...z.entries.keys()],['inputs-0.bin','outputs-0.bin','outputs-2.bin','manifest.json']);
    assert.deepEqual([...new Float32Array(z.entries.get('inputs-0.bin').peek().slice().buffer)],[1.25,-2.5]);
    assert.deepEqual([...new Float32Array(z.entries.get('outputs-2.bin').peek().slice().buffer)],[3,4]);
    assert.equal(m.outputs[1].file,null);assert.equal(m.outputs[1].status,'not-saved');assert.equal(m.outputs[1].expectedBytes,8);assert.equal(m.outputs[1].bytes,undefined);assert.equal(m.outputs[2].status,'saved');assert.equal(m.outputs[2].file,'outputs-2.bin');
    const python=process.env.PYTHON_BIN||(process.platform==='win32'?'C:/Users/kovia/.cache/codex-runtimes/codex-primary-runtime/dependencies/python/python.exe':'python3');
    assert.equal(execFileSync(python,['-I','-c','import io,sys,zipfile\nz=zipfile.ZipFile(io.BytesIO(sys.stdin.buffer.read()));assert z.testzip() is None;print("CRC-OK")'],{input:io.archive,encoding:'utf8',windowsHide:true}).trim(),'CRC-OK');
});

test('missing inputs and invalid returned lengths are explicit and never turned into BIN values',()=>{
    for(const value of [Float32Array.of(1),new Float64Array(2),new DataView(new ArrayBuffer(8)),null]){
        const f=spec();f.inputs=[bad()];f.outputs=[{...good(),toTypedArray:()=>value},good([6,7])];
        const {z,m}=open(runtimeArchive(f).archive);assert.equal(m.capture.missing.length,2);assert.equal(m.inputs[0].file,null);assert.equal(m.outputs[0].file,null);assert.match(m.outputs[0].reason,/資料長度/);assert.ok(z.entries.has('outputs-1.bin'));assert.ok(!z.entries.has('inputs-0.bin'));assert.ok(!z.entries.has('outputs-0.bin'));
    }
});

test('all unreadable tensors retain metadata only, and error text is bounded',()=>{
    const f=spec([bad()]);f.inputs=[{...bad(),toTypedArray:()=>{throw Error('x'.repeat(4096));}}];const {z,m}=open(runtimeArchive(f).archive);
    assert.deepEqual([...z.entries.keys()],['manifest.json']);assert.equal(m.capture.saved,0);assert.equal(m.capture.savedBytes,0);assert.equal(m.inputs[0].reason.length,512);assert.equal(m.capture.missing[0].reason.length,512);assert.equal(m.validation.status,'failed');
});

test('IO limits are checked before any payload read, even when a tensor would be unreadable',()=>{
    let reads=0;const tensor={dtype:'float32',shape:[2359296],toTypedArray:()=>{reads++;throw Error('unreadable');}},f=spec([tensor]);f.inputs=[tensor];
    assert.throws(()=>runtimeArchive(f),/合計超過 16 MiB/);assert.equal(reads,0);
    f.inputs=Array.from({length:129},()=>good([]));assert.throws(()=>runtimeArchive(f),/最多 128/);assert.equal(reads,0);
});

test('partial archives preserve transfer, one-download conversion, retry-buffer ownership and release',async()=>{
    const first=runtimeArchive(spec()),old=first.archive,next=structuredClone(first,{transfer:runtimeIOTransfers(first)});assert.equal(old.byteLength,0);
    const expected=next.archive.slice(),blob=await prepareRuntimeIOBlob(next);assert.deepEqual(new Uint8Array(await blob.arrayBuffer()),expected);assert.equal(open(expected).m.capture.status,'partial');releaseRuntimeIO(next);assert.equal(next.archive,null);
    const owned=runtimeArchive(spec()),prior=owned.archive,buffer=takeRuntimeIOBuffer(owned);assert.equal(owned.archive,null);assert.equal(prior.byteLength,0);
    const reused=runtimeArchive({...spec(),ioBuffer:buffer});if(buffer.byteLength)assert.equal(reused.archive.buffer,buffer);assert.equal(reused.archive.byteLength,reused.archive.buffer.byteLength);assert.equal(open(reused.archive).m.capture.saved,2);releaseRuntimeIO(reused);assert.equal(reused.archive,null);
});

test('complete captures retain v1, normal BIN layout and scalar or empty tensors',()=>{
    const f=spec([good([3,4])]);f.validation={status:'passed'};let {z,m}=open(runtimeArchive(f).archive);assert.equal(m.version,1);assert.equal(m.capture,undefined);assert.equal(m.outputs[0].status,undefined);assert.ok(z.entries.has('outputs-0.bin'));
    f.inputs=[{...good([2]),shape:[]}];f.outputs=[good([])];({z,m}=open(runtimeArchive(f).archive));assert.equal(m.version,1);assert.equal(z.entries.get('outputs-0.bin').peek().length,0);assert.deepEqual(m.inputs[0].shape,[]);
});
