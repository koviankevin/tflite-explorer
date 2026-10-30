import {RUNTIME_LIMITS} from './tflite-runtime-policy.js';
export const RUNTIME_IO_ARCHIVE_BYTES=RUNTIME_LIMITS.ioBytes+1024**2;
const preparing=new WeakMap();
function cancelPreparation(io){const record=io&&preparing.get(io);if(record){record.cancelled=true;preparing.delete(io);}}
function owned(value){return value instanceof Uint8Array&&value.buffer instanceof ArrayBuffer&&value.byteOffset===0&&value.byteLength===value.buffer.byteLength&&value.byteLength>0&&value.byteLength<=RUNTIME_IO_ARCHIVE_BYTES;}
function bytes(io){if(!owned(io?.archive))throw Error('本機 IO archive 必須是完整、有界且可移交的 bytes。');return io.archive;}
function retire(value){
    if(!owned(value))return;
    // Release backing storage where supported; the fallback wipes retained
    // views and drops our reference. Neither path requests garbage collection.
    if(typeof ArrayBuffer.prototype.transfer==='function')ArrayBuffer.prototype.transfer.call(value.buffer,0);
    else value.fill(0);
}
// One owned buffer moves out of the execution Worker, never a model/WASM
// view or shared memory. No Blob, object URL or persistent cache is created.
export function runtimeIOTransfers(io){return io?[bytes(io).buffer]:[];}
// One snapshot on the first explicit download. Repeated clicks reuse it; the
// previous transferred bytes no longer coexist with the retained download Blob.
export function runtimeIOBlob(io){cancelPreparation(io);if(io?.archive instanceof Blob){if(io.archive.size===0||io.archive.size>RUNTIME_IO_ARCHIVE_BYTES)throw Error('本機 IO archive Blob 大小無效。');return io.archive;}const value=bytes(io),blob=new Blob([value],{type:'application/zip'});io.archive=blob;retire(value);return blob;}
// Consume a local body on explicit download, allowing the browser's bounded
// Blob storage to spill large IO to its managed temporary file implementation.
// This never fetches a URL or stores data in OPFS/application persistence. The
// WeakMap holds only in-flight work and is cleared on every terminal path.
export function prepareRuntimeIOBlob(io,ResponseType=globalThis.Response){
    try{
        if(io?.archive instanceof Blob)return Promise.resolve(runtimeIOBlob(io));
        const pending=io&&preparing.get(io);if(pending)return pending.promise;
        const value=bytes(io),size=value.byteLength;if(typeof ResponseType!=='function')throw Error('此瀏覽器缺少本機 Response 轉換功能，無法準備 IO 下載。');
        const response=new ResponseType(value,{headers:{'Content-Type':'application/zip'}}),record={cancelled:false,promise:null};
        record.promise=Promise.resolve(response.blob()).then(blob=>{
            if(record.cancelled||io.archive!==value)return null;
            if(!(blob instanceof Blob)||blob.size!==size||blob.size>RUNTIME_IO_ARCHIVE_BYTES||blob.type!=='application/zip')throw Error('本機 IO 下載轉換的型別或長度不符，請重試。');
            io.archive=blob;retire(value);return blob;
        }).finally(()=>{if(preparing.get(io)===record)preparing.delete(io);});
        preparing.set(io,record);return record.promise;
    }catch(error){return Promise.reject(error);}
}
// Object URLs keep their independent, existing expiry. Only retire the session's
// owned bytes/Blob; never detach partial views, shared memory or model buffers.
export function releaseRuntimeIO(io){if(!io)return;cancelPreparation(io);const value=io.archive;io.archive=null;retire(value);}
export function releaseRuntimeIOBuffer(buffer){if(buffer instanceof ArrayBuffer&&buffer.byteLength>0)retire(new Uint8Array(buffer));}
export function runtimeIOBufferTransfers(buffer){if(buffer==null)return [];if(!(buffer instanceof ArrayBuffer)||buffer.byteLength===0||buffer.byteLength>RUNTIME_IO_ARCHIVE_BYTES)throw Error('IO 暫存 buffer 必須是完整、有界且可移交的 ArrayBuffer。');return [buffer];}
// Only the previous result in this model session is eligible. Wipe it before
// moving ownership; neither the old IO object nor its views keep readable data.
export function takeRuntimeIOBuffer(io){
    cancelPreparation(io);
    if(!owned(io?.archive)){releaseRuntimeIO(io);return null;}
    const value=io.archive;io.archive=null;value.fill(0);
    if(typeof ArrayBuffer.prototype.transfer==='function')return ArrayBuffer.prototype.transfer.call(value.buffer);
    if(typeof structuredClone==='function')return structuredClone(value.buffer,{transfer:[value.buffer]});
    return null;
}
export function reuseRuntimeIOBuffer(buffer,size){
    if(!Number.isSafeInteger(size)||size<=0||size>RUNTIME_IO_ARCHIVE_BYTES)throw Error('IO archive 大小無效。');
    if(buffer==null)return new Uint8Array(size);runtimeIOBufferTransfers(buffer);
    if(buffer.byteLength===size)return new Uint8Array(buffer);
    if(typeof ArrayBuffer.prototype.transfer==='function')return new Uint8Array(ArrayBuffer.prototype.transfer.call(buffer,size));
    releaseRuntimeIOBuffer(buffer);return new Uint8Array(size);
}
