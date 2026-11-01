import {littleEndianBytes,inputSize} from './tflite-runtime-inputs.js';
import {RUNTIME_LIMITS} from './tflite-runtime-policy.js';
import {randomOptions,randomAlgorithm} from './tensor-random.js';
import {RUNTIME_IO_ARCHIVE_BYTES,runtimeIOBufferTransfers,reuseRuntimeIOBuffer} from './runtime-io.js';
const crcTable=Uint32Array.from({length:256},(_,n)=>{for(let k=0;k<8;k++)n=n&1?0xedb88320^(n>>>1):n>>>1;return n>>>0;});
const crc=bytes=>{let n=0xffffffff;for(const b of bytes)n=crcTable[(n^b)&255]^(n>>>8);return(n^0xffffffff)>>>0;};
// ZIP store only; controlled flat filenames, <=257 entries, <=17 MiB. No ZIP64,
// compression Worker, object URLs or external library lifetime to retain.
export function runtimeArchive({validation,inputs,outputs,inputDetails,outputDetails,specs,modelSHA256,transferable=false,ioBuffer=null}){
    if(typeof transferable!=='boolean')throw Error('IO archive 傳送模式無效。');
    if(!Array.isArray(inputs)||!Array.isArray(outputs)||inputs.length>128||outputs.length>128)throw Error('IO archive 每側最多 128 個 tensors。');
    if(ioBuffer!==null){if(!transferable)throw Error('只有 transferable IO 可重用暫存 buffer。');runtimeIOBufferTransfers(ioBuffer);}
    const files=[],rows={inputs:[],outputs:[]},missing=[],pending=[];let bytes=0;
    // Admit the entire declared capture before reading any payload. A failed
    // tensor must not bypass the unchanged total or per-tensor IO budget.
    for(const [side,values,details] of [['inputs',inputs,inputDetails],['outputs',outputs,outputDetails]]){
        if(!Array.isArray(details)||details.length>128)throw Error('IO archive 介面 metadata 無效。');
        for(let i=0;i<Math.max(values.length,details.length);i++){
            const tensor=values[i],detail=details[i]??tensor,shape=Array.from(tensor?.shape??detail.shape),expectedBytes=inputSize({dtype:detail.dtype,shape});
            bytes+=expectedBytes;if(bytes>RUNTIME_LIMITS.ioBytes)throw Error('輸入／輸出保存合計超過 16 MiB。');
            const s=specs[i],row={name:String(detail.name||'').slice(0,256),shape,dtype:detail.dtype,...(side==='inputs'?{source:s.mode,...(s.mode==='bin'?{sourceFile:s.file.name?String(s.file.name).slice(0,1024):null}:s.mode==='random'?{...randomOptions(s),distribution:s.distribution??'uniform',algorithm:randomAlgorithm(s)}:{})}:{})};
            pending.push({side,index:i,tensor,row,expectedBytes});
        }
    }
    for(const {side,index,tensor,row,expectedBytes} of pending){
        try{
            if(!tensor)throw Error('runtime 未提供此 tensor 的資料；保留介面 metadata。');
            const value=tensor.toTypedArray(),elements=row.shape.reduce((n,d)=>n*d,1);
            if(!ArrayBuffer.isView(value)||value.length!==elements||value.byteLength!==expectedBytes)throw Error('runtime tensor 資料長度與 shape／dtype 不符，未保存此 tensor。');
            const data=littleEndianBytes(value,row.dtype),name=`${side}-${index}.bin`;
            files.push({name,data});rows[side].push({file:name,...row,bytes:data.length});
        }catch(error){
            const reason=String(error?.message||error).slice(0,512);
            rows[side].push({file:null,...row,expectedBytes,status:'not-saved',reason});missing.push({side,index,reason});
        }
    }
    // Complete captures preserve the existing v1 format. Only partial captures
    // use v2, with explicit missing slots and no fabricated or repacked bytes.
    if(missing.length)for(const side of ['inputs','outputs'])for(const row of rows[side])if(row.file)row.status='saved';
    const manifest={format:'model-lens-runtime-io',version:missing.length?2:1,createdAt:new Date().toISOString(),byteOrder:'little-endian',modelSHA256,...rows,validation:{...validation},...(missing.length?{capture:{status:'partial',requested:pending.length,saved:files.length,missing,savedBytes:files.reduce((n,f)=>n+f.data.length,0)}}:{})};
    files.push({name:'manifest.json',data:new TextEncoder().encode(JSON.stringify(manifest,null,2)+'\n')});
    const parts=[],central=[];let offset=0;
    for(const f of files){const name=new TextEncoder().encode(f.name),sum=crc(f.data),header=new Uint8Array(30+name.length),h=new DataView(header.buffer);h.setUint32(0,0x04034b50,true);h.setUint16(4,20,true);h.setUint16(6,0x800,true);h.setUint16(12,0x21,true);h.setUint32(14,sum,true);h.setUint32(18,f.data.length,true);h.setUint32(22,f.data.length,true);h.setUint16(26,name.length,true);header.set(name,30);parts.push(header,f.data);
        const directory=new Uint8Array(46+name.length),d=new DataView(directory.buffer);d.setUint32(0,0x02014b50,true);d.setUint16(4,20,true);d.setUint16(6,20,true);d.setUint16(8,0x800,true);d.setUint16(14,0x21,true);d.setUint32(16,sum,true);d.setUint32(20,f.data.length,true);d.setUint32(24,f.data.length,true);d.setUint16(28,name.length,true);d.setUint32(42,offset,true);directory.set(name,46);central.push(directory);offset+=header.length+f.data.length;
    }
    const end=new Uint8Array(22),e=new DataView(end.buffer);e.setUint32(0,0x06054b50,true);e.setUint16(8,files.length,true);e.setUint16(10,files.length,true);e.setUint32(12,central.reduce((n,a)=>n+a.length,0),true);e.setUint32(16,offset,true);
    const all=[...parts,...central,end],total=all.reduce((n,p)=>n+p.byteLength,0);if(total>RUNTIME_IO_ARCHIVE_BYTES)throw Error('IO archive 超過 17 MiB。');
    if(!transferable)return {archive:new Blob(all,{type:'application/zip'}),manifest};
    const archive=reuseRuntimeIOBuffer(ioBuffer,total);let at=0;for(const part of all){archive.set(part,at);at+=part.byteLength;}return {archive,manifest};
}
