import {RUNTIME_LIMITS} from './tflite-runtime-policy.js';
export const RUNTIME_IO_ARCHIVE_BYTES=RUNTIME_LIMITS.ioBytes+1024**2;
function owned(value){return value instanceof Uint8Array&&value.buffer instanceof ArrayBuffer&&value.byteOffset===0&&value.byteLength===value.buffer.byteLength&&value.byteLength>0&&value.byteLength<=RUNTIME_IO_ARCHIVE_BYTES;}
function bytes(io){if(!owned(io?.archive))throw Error('本機 IO archive 必須是完整、有界且可移交的 bytes。');return io.archive;}
function retire(value){
    if(!owned(value))return;
    // Release backing storage where supported; the fallback wipes retained
    // views and drops our reference. Neither path requests garbage collection.
    if(typeof ArrayBuffer.prototype.transfer==='function')ArrayBuffer.prototype.transfer.call(value.buffer,0);
    else value.fill(0);
}
// A fresh owned buffer moves out of the execution Worker, never a model/WASM
// view or shared memory. No Blob, object URL or persistent cache is created.
export function runtimeIOTransfers(io){return io?[bytes(io).buffer]:[];}
// One snapshot on the first explicit download. Repeated clicks reuse it; the
// previous transferred bytes no longer coexist with the retained download Blob.
export function runtimeIOBlob(io){if(io?.archive instanceof Blob){if(io.archive.size===0||io.archive.size>RUNTIME_IO_ARCHIVE_BYTES)throw Error('本機 IO archive Blob 大小無效。');return io.archive;}const value=bytes(io),blob=new Blob([value],{type:'application/zip'});io.archive=blob;retire(value);return blob;}
// Object URLs keep their independent, existing expiry. Only retire the session's
// owned bytes/Blob; never detach partial views, shared memory or model buffers.
export function releaseRuntimeIO(io){if(!io)return;const value=io.archive;io.archive=null;retire(value);}
