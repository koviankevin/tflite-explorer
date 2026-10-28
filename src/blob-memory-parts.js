// In the pinned Firefox 142 measurement, large memory prefixes materialized a
// mixed File/Blob body at object URL creation. Keep memory Blob components small;
// leave the source File slices and every serialized byte unchanged.
export function memoryBlobParts(bytes,BlobType=Blob){
    if(!(bytes instanceof Uint8Array)||bytes.byteLength>64*1024**2)throw Error('Blob 結構資料無效或超過 64 MiB。');
    const size=65536;
    if(bytes.byteLength<=size)return [bytes];
    const parts=[];
    for(let offset=0;offset<bytes.byteLength;offset+=size)parts.push(new BlobType([bytes.subarray(offset,Math.min(bytes.byteLength,offset+size))]));
    return parts;
}
