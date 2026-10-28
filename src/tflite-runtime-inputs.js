import {RUNTIME_LIMITS} from './tflite-runtime-policy.js';
import {validateRandomRange,seededRandom} from './tensor-random.js';
const kinds={float32:[Float32Array,'Float32',4],float64:[Float64Array,'Float64',8],int32:[Int32Array,'Int32',4],uint32:[Uint32Array,'Uint32',4],int16:[Int16Array,'Int16',2],uint16:[Uint16Array,'Uint16',2],uint8:[Uint8Array,'Uint8',1],int8:[Int8Array,'Int8',1],bool:[Uint8Array,'Uint8',1],int64:[BigInt64Array,'BigInt64',8],uint64:[BigUint64Array,'BigUint64',8],float16:[globalThis.Float16Array,'Float16',2]};
export function inputSize(detail){if(!Array.isArray(detail.shape)||detail.shape.length>128||detail.shape.some(d=>!Number.isSafeInteger(d)||d<0))throw Error('測試輸入 shape 無效。');const k=kinds[detail.dtype],n=detail.shape.reduce((a,d)=>a*d,1);if(!k||!Number.isSafeInteger(n)||n<0||n*k[2]>RUNTIME_LIMITS.ioBytes)throw Error('測試輸入 dtype 或大小不支援。');return n*k[2];}
export function validateRuntimeInputs(details,specs){
    if(!Array.isArray(specs)||specs.length!==details.length)throw Error('每個模型 input 都需要指定測試資料。');let total=0;
    details.forEach((t,i)=>{const s=specs[i],bytes=inputSize(t);total+=bytes;if(total>RUNTIME_LIMITS.ioBytes)throw Error('測試輸入合計超過 16 MiB。');if(!s||!['zero','random','bin'].includes(s.mode))throw Error(`輸入 ${i+1} 的資料模式無效。`);if(s.mode==='bin'&&(!(s.file instanceof Blob)||s.file.size!==bytes))throw Error(`輸入 ${i+1} 需要剛好 ${bytes} bytes 的 raw .bin（little-endian）；請依 dtype／shape 產生。`);
        if(s.mode==='random')try{validateRandomRange(t.dtype,s);}catch(error){throw Error(`輸入 ${i+1}：${error.message}`);}
    });return specs;
}
export async function runtimeInput(detail,spec){
    validateRuntimeInputs([detail],[spec]);const [Ctor,method,width]=kinds[detail.dtype];if(!Ctor)throw Error(`此瀏覽器尚不支援 ${detail.dtype} 測試輸入。`);const data=new Ctor(inputSize(detail)/width);
    if(spec.mode==='bin'){const view=new DataView(await spec.file.arrayBuffer());for(let i=0;i<data.length;i++){data[i]=view['get'+method](i*width,true);if(detail.dtype==='bool'&&data[i]!==0&&data[i]!==1)throw Error('boolean raw .bin 只能包含 0 或 1。');}}
    else if(spec.mode==='random'){const next=seededRandom(detail.dtype,spec);for(let i=0;i<data.length;i++){const n=next();data[i]=method.startsWith('Big')?BigInt(n):n;}}
    return data;
}
export function littleEndianBytes(data,dtype){const [,method,width]=kinds[dtype]||[];if(!method||data.byteLength>RUNTIME_LIMITS.ioBytes)throw Error('輸出 dtype 或大小不支援。');const bytes=new Uint8Array(data.length*width),view=new DataView(bytes.buffer);for(let i=0;i<data.length;i++)view['set'+method](i*width,data[i],true);return bytes;}
