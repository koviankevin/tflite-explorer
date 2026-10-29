import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {runtimeInput} from '../src/tflite-runtime-inputs.js';
const hash=b=>createHash('sha256').update(new Uint8Array(b)).digest('hex');
const nativeLittleEndian=new Uint8Array(Uint16Array.of(1).buffer)[0]===1;

test('real raw input path avoids a second full4MiB tensor allocation on little-endian hosts',async()=>{
    const raw=new Float32Array(1048576).fill(7).buffer,before=hash(raw);let reads=0;
    class PublicInput extends File{async arrayBuffer(){reads++;return raw;}}
    const result=await runtimeInput({dtype:'float32',shape:[1,1024,1024]},{mode:'bin',file:new PublicInput([raw],'public.bin')});
    assert.equal(reads,1);assert.equal(result.byteLength,4194304);assert.equal(hash(result.buffer),before);assert.equal(hash(raw),before);
    assert.equal(result.buffer===raw,nativeLittleEndian,'Do not duplicate the private File.arrayBuffer on a little-endian host');
});

test('direct and endian-conversion paths preserve all supported numeric types and source bytes',async()=>{
    const {runtimeBinInput}=await import('../src/tflite-runtime-inputs.js');
    const rows=[['float32',Float32Array,'Float32',[1.25,-2.5]],['float64',Float64Array,'Float64',[Math.PI,-1e40]],['int8',Int8Array,'Int8',[-128,127]],['uint8',Uint8Array,'Uint8',[0,255]],['bool',Uint8Array,'Uint8',[0,1]],['int16',Int16Array,'Int16',[-32768,32767]],['uint16',Uint16Array,'Uint16',[0,65535]],['int32',Int32Array,'Int32',[-2147483648,2147483647]],['uint32',Uint32Array,'Uint32',[0,4294967295]],['int64',BigInt64Array,'BigInt64',[-9007199254740993n,9223372036854775807n]],['uint64',BigUint64Array,'BigUint64',[0n,18446744073709551615n]]];
    if(globalThis.Float16Array&&typeof DataView.prototype.setFloat16==='function')rows.push(['float16',Float16Array,'Float16',[1.25,-2.5]]);
    for(const [dtype,Ctor,method,values]of rows){const raw=new ArrayBuffer(values.length*Ctor.BYTES_PER_ELEMENT),view=new DataView(raw);values.forEach((n,i)=>view['set'+method](i*Ctor.BYTES_PER_ELEMENT,n,true));const before=hash(raw);
        for(const littleEndian of [nativeLittleEndian,false]){const result=runtimeBinInput({dtype,shape:[values.length]},raw,littleEndian);assert.equal(result.constructor,Ctor);assert.deepEqual([...result],values);assert.equal(hash(raw),before);assert.equal(result.buffer===raw,littleEndian||Ctor.BYTES_PER_ELEMENT===1);}
    }
});

test('invalid bool, size, shared buffers and missing constructors still fail before execution',async()=>{
    const {runtimeBinInput}=await import('../src/tflite-runtime-inputs.js');
    assert.throws(()=>runtimeBinInput({dtype:'bool',shape:[1]},Uint8Array.of(2).buffer),/0.*1/);
    for(const raw of [new ArrayBuffer(3),new SharedArrayBuffer(4),new Uint8Array(4)])assert.throws(()=>runtimeBinInput({dtype:'float32',shape:[1]},raw),/bytes|buffer/);
    assert.throws(()=>runtimeBinInput({dtype:'float32',shape:[1]},new ArrayBuffer(4),'yes'),/endian/);
    if(!globalThis.Float16Array)assert.throws(()=>runtimeBinInput({dtype:'float16',shape:[1]},new ArrayBuffer(2)),/尚不支援/);
    for(const littleEndian of [true,false])assert.equal(runtimeBinInput({dtype:'int32',shape:[0]},new ArrayBuffer(0),littleEndian).length,0);
});

test('the async raw File path rejects an inconsistent returned buffer and preserves bool validation',async()=>{
    class WrongFile extends File{async arrayBuffer(){return new ArrayBuffer(3);}}
    await assert.rejects(runtimeInput({dtype:'float32',shape:[1]},{mode:'bin',file:new WrongFile([new Uint8Array(4)],'wrong.bin')}));
    await assert.rejects(runtimeInput({dtype:'bool',shape:[1]},{mode:'bin',file:new File([Uint8Array.of(2)],'bool.bin')}),/0.*1/);
});
