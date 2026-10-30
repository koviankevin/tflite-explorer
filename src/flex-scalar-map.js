// Bounded, non-recursive FlexBuffers scalar-map reader for reference contracts.
// No vectors, strings, nested maps or model-supplied callbacks are evaluated.
export function flexScalarMap(bytes){
    if(!(bytes instanceof Uint8Array)||bytes.length<3||bytes.length>65536)return null;
    const view=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength),width=n=>[1,2,4,8].includes(n);
    const bounds=(o,n)=>{if(!Number.isSafeInteger(o)||!Number.isSafeInteger(n)||o<0||n<0||o>bytes.length-n)throw Error('range');};
    const uint=(o,n)=>{bounds(o,n);if(!width(n))throw Error('width');const v=n===1?view.getUint8(o):n===2?view.getUint16(o,true):n===4?view.getUint32(o,true):view.getBigUint64(o,true);if(typeof v==='bigint'&&v>BigInt(Number.MAX_SAFE_INTEGER))throw Error('size');return Number(v);};
    const indirect=(o,n)=>{const d=uint(o,n);if(d<=0)throw Error('offset');return o-d;};
    try{
        const parent=bytes.at(-1),tag=bytes.at(-2),w=1<<(tag&3);if(!width(parent)||(tag>>2)!==9)return null;
        const root=bytes.length-2-parent,map=indirect(root,parent),count=uint(map-w,w);if(count>64)return null;
        const keyMeta=map-3*w,keys=indirect(keyMeta,w),kw=uint(keyMeta+w,w);if(!width(kw)||uint(keys-kw,kw)!==count)return null;
        bounds(map,count*w+count);bounds(keys,count*kw);const result=Object.create(null);
        for(let i=0;i<count;i++){
            const at=keys+i*kw,start=indirect(at,kw);bounds(start,1);const end=bytes.indexOf(0,start);if(end<start||end-start>64)return null;
            const key=new TextDecoder('utf-8',{fatal:true}).decode(bytes.subarray(start,end));if(!/^[A-Za-z][A-Za-z0-9_]{0,63}$/.test(key)||Object.hasOwn(result,key))return null;
            const packed=bytes[map+count*w+i],type=packed>>2,bw=1<<(packed&3),slot=map+i*w;let value;
            const scalar=(o,n,signed=false)=>{if(!signed)return uint(o,n);bounds(o,n);const v=n===1?view.getInt8(o):n===2?view.getInt16(o,true):n===4?view.getInt32(o,true):view.getBigInt64(o,true);if(typeof v==='bigint'&&(v>BigInt(Number.MAX_SAFE_INTEGER)||v<BigInt(Number.MIN_SAFE_INTEGER)))throw Error('integer');return Number(v);};
            const floating=(o,n)=>{bounds(o,n);if(n!==4&&n!==8)throw Error('float width');return n===4?view.getFloat32(o,true):view.getFloat64(o,true);};
            if(type===1||type===2)value=scalar(slot,w,type===1);
            else if(type===3)value=floating(slot,w);
            else if(type>=6&&type<=8){const target=indirect(slot,w);value=type===8?floating(target,bw):scalar(target,bw,type===6);}
            else if(type===26){const n=uint(slot,w);if(n!==0&&n!==1)return null;value=n===1;}
            else return null;
            if(typeof value==='number'&&!Number.isFinite(value))return null;result[key]=value;
        }
        return result;
    }catch{return null;}
}
