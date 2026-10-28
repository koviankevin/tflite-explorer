import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomTensor} from '../src/tflite-new-ops.js';
import {runtimeInput,littleEndianBytes} from '../src/tflite-runtime-inputs.js';
import {randomRange} from '../src/tensor-random.js';

test('weights and runtime inputs generate legal float and integer values across each supported dtype range',async()=>{
    for(const [type,dtype,Ctor,min,max] of [
        [0,'float32',Float32Array,-3.4028234663852886e38,3.4028234663852886e38],
        [10,'float64',Float64Array,-Number.MAX_VALUE,Number.MAX_VALUE],
        [2,'int32',Int32Array,-2147483648,2147483647],[3,'uint8',Uint8Array,0,255],
        [6,'bool',Uint8Array,0,1],[7,'int16',Int16Array,-32768,32767],
        [9,'int8',Int8Array,-128,127],[15,'uint32',Uint32Array,0,4294967295],
        [16,'uint16',Uint16Array,0,65535],[4,'int64',BigInt64Array,-Number.MAX_SAFE_INTEGER,Number.MAX_SAFE_INTEGER],
        [12,'uint64',BigUint64Array,0,Number.MAX_SAFE_INTEGER]
    ]){
        const spec={seed:123,min,max},bytes=randomTensor({type,shape:[256]},spec),values=await runtimeInput({dtype,shape:[256]},{mode:'random',...spec});
        assert.deepEqual(bytes,littleEndianBytes(values,dtype),dtype);
        assert.ok([...values].every(n=>typeof n==='bigint'?n>=BigInt(min)&&n<=BigInt(max):Number.isFinite(n)&&n>=min&&n<=max),dtype);
        assert.ok(new Set(values).size>1,dtype);
        const fixed=randomTensor({type,shape:[8]},{...spec,min:max});
        const decoded=new Ctor(fixed.buffer,fixed.byteOffset,fixed.byteLength/Ctor.BYTES_PER_ELEMENT);
        assert.ok([...decoded].every(n=>n===(typeof values[0]==='bigint'?BigInt(max):max)),dtype+' constant');
    }
});

test('dtype validation rejects nonfinite floats, overflowing bounds, fractional integers and nonboolean constants',async()=>{
    for(const [type,dtype,min,max]of [[0,'float32',0,3.5e38],[10,'float64',0,Infinity],[9,'int8',0,128],[2,'int32',.5,1],[6,'bool',0,2],[4,'int64',0,Number.MAX_SAFE_INTEGER+1]]){
        const spec={seed:1,min,max};assert.throws(()=>randomTensor({type,shape:[1]},spec));
        await assert.rejects(runtimeInput({dtype,shape:[1]},{mode:'random',...spec}));
    }
});

test('existing xorshift32 draft seeds preserve their exact original small-range weight bytes',async()=>{
    const spec={seed:123,min:-.05,max:.05},golden='4dc749bd0c73323dbee98bbaeea5213d03e945bc';
    assert.equal(Buffer.from(randomTensor({type:0,shape:[5]},spec)).toString('hex'),golden);
    assert.equal(Buffer.from(randomTensor({type:0,shape:[5]},{seed:123})).toString('hex'),golden);
    assert.equal(Buffer.from(littleEndianBytes(await runtimeInput({dtype:'float32',shape:[5]},{mode:'random',...spec}),'float32')).toString('hex'),golden);
});

test('safe defaults and constraints distinguish floats, integers, booleans and unsupported dtypes',()=>{
    assert.deepEqual([randomRange('float32').defaultMin,randomRange('float32').defaultMax,randomRange('float32').step],[-.05,.05,'any']);
    for(const dtype of ['int8','uint8','int64','bool'])assert.deepEqual([randomRange(dtype).defaultMin,randomRange(dtype).defaultMax,randomRange(dtype).step],[0,1,'1']);
    assert.equal(randomRange('float16').max,65504);assert.match(randomRange('int64').description,/精確/);
    for(const dtype of ['bfloat16','string','constructor',undefined])assert.throws(()=>randomRange(dtype),/不支援/);
});
