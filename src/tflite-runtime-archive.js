import {littleEndianBytes,inputSize} from './tflite-runtime-inputs.js';
import {RUNTIME_LIMITS} from './tflite-runtime-policy.js';
import {randomOptions,randomAlgorithm} from './tensor-random.js';
const crcTable=Uint32Array.from({length:256},(_,n)=>{for(let k=0;k<8;k++)n=n&1?0xedb88320^(n>>>1):n>>>1;return n>>>0;});
const crc=bytes=>{let n=0xffffffff;for(const b of bytes)n=crcTable[(n^b)&255]^(n>>>8);return(n^0xffffffff)>>>0;};
// ZIP store only; controlled flat filenames, <=257 entries, <=17 MiB. No ZIP64,
// compression Worker, object URLs or external library lifetime to retain.
export function runtimeArchive({validation,inputs,outputs,inputDetails,outputDetails,specs,modelSHA256}){
    const files=[],rows={inputs:[],outputs:[]};let bytes=0;
    for(const [side,values,details] of [['inputs',inputs,inputDetails],['outputs',outputs,outputDetails]])values.forEach((tensor,i)=>{const detail=details[i];bytes+=inputSize({dtype:detail.dtype,shape:Array.from(tensor.shape)});if(bytes>RUNTIME_LIMITS.ioBytes)throw Error('輸入／輸出保存合計超過 16 MiB。');const data=littleEndianBytes(tensor.toTypedArray(),detail.dtype),name=`${side}-${i}.bin`;files.push({name,data});const s=specs[i];rows[side].push({file:name,name:String(detail.name||'').slice(0,256),shape:Array.from(tensor.shape),dtype:detail.dtype,bytes:data.length,...(side==='inputs'?{source:s.mode,...(s.mode==='bin'?{sourceFile:s.file.name?String(s.file.name).slice(0,1024):null}:s.mode==='random'?{...randomOptions(s),distribution:s.distribution??'uniform',algorithm:randomAlgorithm(s)}:{})}:{})});});
    const manifest={format:'model-lens-runtime-io',version:1,createdAt:new Date().toISOString(),byteOrder:'little-endian',modelSHA256,...rows,validation:{...validation}};
    files.push({name:'manifest.json',data:new TextEncoder().encode(JSON.stringify(manifest,null,2)+'\n')});
    const parts=[],central=[];let offset=0;
    for(const f of files){const name=new TextEncoder().encode(f.name),sum=crc(f.data),header=new Uint8Array(30+name.length),h=new DataView(header.buffer);h.setUint32(0,0x04034b50,true);h.setUint16(4,20,true);h.setUint16(6,0x800,true);h.setUint16(12,0x21,true);h.setUint32(14,sum,true);h.setUint32(18,f.data.length,true);h.setUint32(22,f.data.length,true);h.setUint16(26,name.length,true);header.set(name,30);parts.push(header,f.data);
        const directory=new Uint8Array(46+name.length),d=new DataView(directory.buffer);d.setUint32(0,0x02014b50,true);d.setUint16(4,20,true);d.setUint16(6,20,true);d.setUint16(8,0x800,true);d.setUint16(14,0x21,true);d.setUint32(16,sum,true);d.setUint32(20,f.data.length,true);d.setUint32(24,f.data.length,true);d.setUint16(28,name.length,true);d.setUint32(42,offset,true);directory.set(name,46);central.push(directory);offset+=header.length+f.data.length;
    }
    const end=new Uint8Array(22),e=new DataView(end.buffer);e.setUint32(0,0x06054b50,true);e.setUint16(8,files.length,true);e.setUint16(10,files.length,true);e.setUint32(12,central.reduce((n,a)=>n+a.length,0),true);e.setUint32(16,offset,true);
    return {archive:new Blob([...parts,...central,end],{type:'application/zip'}),manifest};
}
