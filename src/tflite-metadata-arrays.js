// Private to one TFLite reader. Small Int32 metadata vectors keep distinct
// native views over disjoint ranges instead of allocating one buffer per field.
// These buffers are not owned runtime IO: consumers use the view's values and
// byte range, never transfer its backing buffer. Weights/custom options and all
// other vector types retain the pinned reader's original path.
const PAGE_BYTES=64*1024,MAX_VECTOR_BYTES=16*1024,MAX_ARENA_BYTES=8*1024*1024;

export function installTfliteMetadataArrays(reader){
    const original=reader.array,empty=new ArrayBuffer(0);
    let page=null,used=0,allocated=0;
    reader.array=function(position,offset,type){
        if(type!==Int32Array)return original.call(this,position,offset,type);
        const field=this.__offset(position,offset),length=field?this.__vector_len(position+field):0;
        if(length===0)return new Int32Array(empty,0,0);
        const bytes=length*4;
        if(!Number.isSafeInteger(length)||length<0||bytes>MAX_VECTOR_BYTES||typeof this._read!=='function')return original.call(this,position,offset,type);
        if(!page||used+bytes>page.byteLength){
            if(allocated>=MAX_ARENA_BYTES)return original.call(this,position,offset,type);
            page=new ArrayBuffer(PAGE_BYTES);used=0;allocated+=PAGE_BYTES;
        }
        const start=used;
        this._read(new Uint8Array(page,start,bytes),this.__vector(position+field));
        used+=bytes;
        return new Int32Array(page,start,length);
    };
}
