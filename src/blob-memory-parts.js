// Bound individual metadata allocations. Splitting memory parts alone did not
// eliminate Firefox's mixed-body allocation; prepareExportResult converts the
// freshly serialized prefix before it crosses the Worker/download boundary.
const prefixSizes=new WeakMap();
export function memoryBlobParts(bytes,BlobType=Blob){
    if(!(bytes instanceof Uint8Array)||bytes.byteLength>64*1024**2)throw Error('Blob 結構資料無效或超過 64 MiB。');
    const size=65536;
    if(bytes.byteLength<=size)return [bytes];
    const parts=[];
    for(let offset=0;offset<bytes.byteLength;offset+=size)parts.push(new BlobType([bytes.subarray(offset,Math.min(bytes.byteLength,offset+size))]));
    return parts;
}

export function exportMemoryBlob(bytes,parts,BlobType=Blob){
    const blob=new BlobType([...memoryBlobParts(bytes,BlobType),...parts],{type:'application/octet-stream'});
    prefixSizes.set(blob,bytes.byteLength);return blob;
}

export async function prepareExportResult(result,ResponseType=globalThis.Response){
    const prefix=prefixSizes.get(result.blob);
    if(!prefix||prefix<=65536)return result;
    if(typeof ResponseType!=='function')throw Error('此瀏覽器缺少本機 Blob 轉換功能，無法安全準備大型匯出。');
    // Response consumes only fresh metadata, never the opaque source weights.
    // No fetch, OPFS, application cache or full-model ArrayBuffer is involved.
    const header=await new ResponseType(result.blob.slice(0,prefix)).blob();
    if(header.size!==prefix)throw Error('本機匯出結構轉換不完整，請重試。');
    return {...result,blob:new Blob([header,result.blob.slice(prefix)],{type:result.blob.type})};
}
