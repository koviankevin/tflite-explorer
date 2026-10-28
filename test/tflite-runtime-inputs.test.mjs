import {test} from 'node:test';
import assert from 'node:assert/strict';
import {runtimeInput,validateRuntimeInputs,littleEndianBytes} from '../src/tflite-runtime-inputs.js';
import {runtimeArchive} from '../src/tflite-runtime-archive.js';
import {Archive} from '../vendor/netron/zip.js';
test('raw bin input validates exact bytes and decodes little-endian values without conversion of dtype',async()=>{
    const detail={dtype:'float32',shape:[1,2]},data=new Uint8Array(8),view=new DataView(data.buffer);view.setFloat32(0,1.25,true);view.setFloat32(4,-2.5,true);
    assert.deepEqual([...await runtimeInput(detail,{mode:'bin',file:new File([data],'input.bin')})],[1.25,-2.5]);
    assert.throws(()=>validateRuntimeInputs([detail],[{mode:'bin',file:new Blob([data.subarray(1)])}]),/8 bytes/);assert.throws(()=>validateRuntimeInputs([detail],[]),/每個/);
    assert.deepEqual(littleEndianBytes(Float32Array.of(1.25,-2.5),'float32'),data);
    const int=new Uint8Array(8);new DataView(int.buffer).setBigInt64(0,-9007199254740993n,true);assert.equal((await runtimeInput({dtype:'int64',shape:[1]},{mode:'bin',file:new Blob([int])}))[0],-9007199254740993n);
});
test('zero and seeded random inputs retain scalar/empty shape and enforce integer ranges',async()=>{
    assert.deepEqual([...await runtimeInput({dtype:'int32',shape:[]},{mode:'zero'})],[0]);assert.equal((await runtimeInput({dtype:'float32',shape:[0,2]},{mode:'zero'})).length,0);
    const d={dtype:'int8',shape:[20]},spec={mode:'random',seed:7,min:-3,max:5};assert.deepEqual(await runtimeInput(d,spec),await runtimeInput(d,spec));assert.ok([...await runtimeInput(d,spec)].every(n=>n>=-3&&n<=5));
    for(const s of [{...spec,min:-129},{...spec,max:.5},{...spec,seed:-1}])assert.throws(()=>validateRuntimeInputs([d],[s]),/亂數/);
});
test('I/O archive contains exact raw tensors and a noncircular manifest with truthful partial results',async()=>{
    const tensor={dtype:'float32',shape:[1,2],toTypedArray:()=>Float32Array.of(4,6)},detail={dtype:'float32',name:'原始/輸出'},validation={status:'passed',compiled:true,invoked:true},bundle=runtimeArchive({validation,inputs:[tensor],outputs:[tensor],inputDetails:[detail],outputDetails:[detail],specs:[{mode:'zero'}],modelSHA256:'a'.repeat(64)});
    validation.io=bundle;assert.doesNotThrow(()=>JSON.stringify(bundle.manifest));
    const zip=Archive.open(new Uint8Array(await bundle.archive.arrayBuffer()),'zip');assert.deepEqual([...zip.entries.keys()].sort(),['inputs-0.bin','manifest.json','outputs-0.bin']);assert.deepEqual([...new Float32Array(zip.entries.get('outputs-0.bin').peek().slice().buffer)],[4,6]);
    const manifest=JSON.parse(new TextDecoder().decode(zip.entries.get('manifest.json').peek()));assert.equal(manifest.byteOrder,'little-endian');assert.deepEqual(manifest.outputs[0].shape,[1,2]);assert.equal(manifest.outputs[0].name,detail.name);assert.equal(manifest.validation.status,'passed');assert.equal(manifest.modelSHA256,'a'.repeat(64));assert.equal(manifest.validation.io,undefined);
});
