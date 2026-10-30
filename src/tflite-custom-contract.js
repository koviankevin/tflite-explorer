import {flexScalarMap} from './flex-scalar-map.js';
const plain=x=>x&&typeof x==='object'&&!Array.isArray(x)&&Object.getPrototypeOf(x)===Object.prototype;
const keys=(x,allowed)=>plain(x)&&Object.keys(x).every(k=>allowed.includes(k));
const integer=(n,min,max)=>Number.isSafeInteger(n)&&n>=min&&n<=max;
const freeze=x=>{if(x&&typeof x==='object'){for(const value of Object.values(x))freeze(value);Object.freeze(x);}return x;};
export function validateCustomContracts(contracts){
    if(!Array.isArray(contracts)||contracts.length>256)throw Error('Custom 引用契約必須是最多 256 份的清單。');
    const result=[];
    for(const c of contracts){
        const fail=()=>{throw Error('Custom 引用契約格式、版本或引用欄位無效。');};
        if(!keys(c,['interfaceVersion','customCode','versionMin','versionMax','coverage','inputCount','outputCount','options'])||c.interfaceVersion!==1||typeof c.customCode!=='string'||!c.customCode||c.customCode.length>256||!integer(c.versionMin,1,2147483647)||!integer(c.versionMax,c.versionMin,2147483647)||c.coverage!=='local-ports-options-only'||!keys(c.options,['format','byteLength','prefix','references','fields']))fail();
        for(const n of [c.inputCount,c.outputCount])if(n!==undefined&&!integer(n,0,128))fail();
        if(result.some(x=>x.customCode===c.customCode&&x.versionMin<=c.versionMax&&c.versionMin<=x.versionMax))throw Error('Custom 引用契約的 OP／version 範圍重複。');
        const o=c.options;
        if(o.format==='fixed-u32-le'){
            if(o.fields!==undefined||!integer(o.byteLength,4,65536)||!Array.isArray(o.prefix)||o.prefix.length<4||o.prefix.length>32||o.prefix.length>o.byteLength||o.prefix.some(v=>!integer(v,0,255))||!Array.isArray(o.references)||o.references.length>128)fail();
            const occupied=new Set();for(const r of o.references){if(!keys(r,['offset','kind','optional'])||!integer(r.offset,o.prefix.length,o.byteLength-4)||!['tensor','buffer'].includes(r.kind)||r.optional!==undefined&&typeof r.optional!=='boolean')fail();for(let i=r.offset;i<r.offset+4;i++){if(occupied.has(i))fail();occupied.add(i);}}
        }else if(o.format==='flexbuffers-scalars'){
            if(o.byteLength!==undefined||o.prefix!==undefined||o.references!==undefined||!plain(o.fields)||Object.keys(o.fields).length>64)fail();
            for(const [name,f]of Object.entries(o.fields))if(!/^[A-Za-z][A-Za-z0-9_]{0,63}$/.test(name)||!keys(f,['type','required'])||!['number','integer','boolean'].includes(f.type)||typeof f.required!=='boolean')fail();
        }else fail();
        result.push(freeze(JSON.parse(JSON.stringify(c))));
    }
    return Object.freeze(result);
}
export function customOptionReferences(contract,op){
    const bytes=op.custom_options;
    // Effective external/deferred options remain opaque. Inline precedence is
    // preserved when both forms are present, exactly as in the existing exporter.
    if(op.customOptionsDeferred||!(bytes instanceof Uint8Array)||bytes.length>65536||op.large_custom_options_size&&!op.customOptionsInline)return null;
    const o=contract.options;
    if(o.format==='fixed-u32-le'){
        if(bytes.length!==o.byteLength||o.prefix.some((b,i)=>bytes[i]!==b))return null;
        const view=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength);
        return o.references.flatMap(r=>{const id=view.getUint32(r.offset,true);return r.optional&&id===4294967295?[]:[{kind:r.kind,id}];});
    }
    if(op.custom_options_format!==0)return null;
    const map=flexScalarMap(bytes);if(!map)return null;
    if(Object.keys(map).some(k=>!Object.hasOwn(o.fields,k)))return null;
    for(const [key,field]of Object.entries(o.fields)){
        if(!Object.hasOwn(map,key)){if(field.required)return null;continue;}
        const value=map[key];if(field.type==='boolean'?typeof value!=='boolean':typeof value!=='number'||!Number.isFinite(value)||field.type==='integer'&&!Number.isSafeInteger(value))return null;
    }
    return [];
}
