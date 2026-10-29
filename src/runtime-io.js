import {RUNTIME_LIMITS} from './tflite-runtime-policy.js';
export const RUNTIME_IO_ARCHIVE_BYTES=RUNTIME_LIMITS.ioBytes+1024**2;
function bytes(io){
    const value=io?.archive;
    if(!(value instanceof Uint8Array)||!(value.buffer instanceof ArrayBuffer)||value.byteOffset!==0||value.byteLength!==value.buffer.byteLength||value.byteLength===0||value.byteLength>RUNTIME_IO_ARCHIVE_BYTES)throw Error('本機 IO archive 必須是完整、有界且可移交的 bytes。');
    return value;
}
// A fresh owned buffer moves out of the execution Worker, never a model/WASM
// view or shared memory. No Blob, object URL or persistent cache is created.
export function runtimeIOTransfers(io){return io?[bytes(io).buffer]:[];}
// Called only from the explicit download action. Direct Node callers may keep
// the legacy Blob archive; browser execution keeps bytes until this point.
export function runtimeIOBlob(io){if(io?.archive instanceof Blob){if(io.archive.size===0||io.archive.size>RUNTIME_IO_ARCHIVE_BYTES)throw Error('本機 IO archive Blob 大小無效。');return io.archive;}return new Blob([bytes(io)],{type:'application/zip'});}
