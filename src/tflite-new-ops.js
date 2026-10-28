import {tflite as schema} from '../vendor/netron/tflite-schema.js';
import {tableFields} from './flatbuffer-writer.js';
import {TFLITE_OPTIONS,TFLITE_PORTS} from './tflite-op-options.js';
const normalize=s=>s.toLowerCase().replace(/[^a-z0-9]/g,'');
const optionNames=Object.keys(schema).filter(k=>k.endsWith('Options')&&schema[k].decode);
const types2=new Set([...schema.BuiltinOptions2.decode.toString().matchAll(/tflite\.(\w+)\.decode/g)].map(m=>m[1]));
export function builtinInfo(code){
    const name=schema.BuiltinOperator[code];if(!Number.isInteger(code)||typeof name!=='string'||['CUSTOM','PLACEHOLDER_FOR_GREATER_OP_CODES','DELEGATE'].includes(name))throw Error('請選擇有效的 TFLite 內建 OP；CUSTOM 請從原始 custom OP 複製。');
    const type=TFLITE_OPTIONS[name]||optionNames.find(k=>normalize(k)===normalize(name+'Options'))||null;
    const enums=new Map(type?[...schema[type].decodeText.toString().matchAll(/\$\.(\w+)\s*=\s*tflite\.(\w+)\[json\.\1\]/g)].map(m=>[m[1],m[2]]):[]);
    return {code,name,optionType:type,group:type&&types2.has(type)?'builtin_options_2':'builtin_options',fields:type?tableFields(type).map(f=>({...f,...(enums.has(f.key)?{enum:enums.get(f.key)}:{})})):[]};
}
const scalarRanges={int8_:[-128,127],int32_:[-2147483648,2147483647],uint32_:[0,4294967295]};
export function builtinSettings(code,settings={}){
    const info=builtinInfo(code),fields=new Map(info.fields.map(f=>[f.key,f]));
    if(!settings||typeof settings!=='object'||Array.isArray(settings)||JSON.stringify(settings).length>16384||Object.keys(settings).some(k=>!fields.has(k)))throw Error('OP 參數欄位無效或過大。');
    const options=info.optionType?new schema[info.optionType]():null;
    for(const f of info.fields){let v=settings[f.key];
        if(v===undefined){if(f.kind==='array'||['int64s_','bools_'].includes(f.kind))v=[];else if(f.kind==='string_')v=null;else if(f.kind==='bool_')v=f.args==='true';else if(['table','union','tables','strings_'].includes(f.kind))v=null;else v=Number(String(f.args||'0').replace(/n$/,''));}
        if(v===null){if(!['string_','table','union','tables','strings_'].includes(f.kind))throw Error(f.key+' 不可為 null。');options[f.key]=null;continue;}
        if(f.kind==='bool_'){if(typeof v!=='boolean')throw Error(f.key+' 必須為 boolean。');}
        else if(f.kind==='array'||['int64s_','bools_'].includes(f.kind)){
            if(!Array.isArray(v)||v.length>1024)throw Error(f.key+' 必須為最多 1024 個元素的陣列。');
            const type=f.kind==='array'?f.args:f.kind;
            if(type==='int64s_')v=v.map(x=>{if(!/^-?\d+$/.test(String(x)))throw Error(f.key+' 必須為 int64 陣列。');const b=BigInt(x);if(b<-(1n<<63n)||b>=(1n<<63n))throw Error(f.key+' 超出 int64。');return b;});
            else if(type==='bools_'){if(v.some(x=>typeof x!=='boolean'))throw Error(f.key+' 必須為 boolean 陣列。');}
            else {const r=/Uint8/.test(type)?[0,255]:/Int8/.test(type)?[-128,127]:/Uint16/.test(type)?[0,65535]:/Int16/.test(type)?[-32768,32767]:/Uint32/.test(type)?[0,4294967295]:[-2147483648,2147483647],float=/Float/.test(type);if(v.some(x=>float?!Number.isFinite(x)||Math.abs(x)>3.4028234663852886e38:!Number.isInteger(x)||x<r[0]||x>r[1]))throw Error(f.key+' 陣列值超出範圍。');v=Array.from(v);}
        }else if(['int64_','uint64_'].includes(f.kind)){if(!/^-?\d+$/.test(String(v)))throw Error(f.key+' 必須為整數文字。');v=BigInt(v);if(v<(f.kind==='uint64_'?0n:-(1n<<63n))||v>=(f.kind==='uint64_'?1n<<64n:1n<<63n))throw Error(f.key+' 超出範圍。');}
        else if(f.kind==='string_'){if(typeof v!=='string'||v.length>4096)throw Error(f.key+' 必須為短文字。');}
        else {const r=scalarRanges[f.kind];if(r?(!Number.isInteger(v)||v<r[0]||v>r[1]):(!Number.isFinite(v)||Math.abs(v)>3.4028234663852886e38))throw Error(f.key+' 型別或範圍無效。');}
        if(f.enum&&!Object.values(schema[f.enum]).includes(v))throw Error(f.key+' 不在 '+f.enum+' 列舉範圍。');options[f.key]=v;
    }
    return {info,options};
}
export function builtinCatalog(metadata=[]){
    const byName=new Map(metadata.map(m=>[normalize(m.name),m]));
    return Object.values(schema.BuiltinOperator).filter(Number.isInteger).flatMap(code=>{try{const {info,options}=builtinSettings(code),m=byName.get(normalize(info.name));return [{...info,fields:info.fields.map(f=>({key:f.key,kind:f.kind,value:typeof options[f.key]==='bigint'?String(options[f.key]):options[f.key]})),inputs:m?.inputs?.map(p=>({name:p.name,optional:p.option==='optional',list:p.option==='list',type:p.type}))||null,outputs:m?.outputs?.map(p=>({name:p.name,list:p.option==='list',type:p.type}))||null}];}catch{return [];}});
}
export function checkBuiltinPorts(code,inputs,outputs,options){
    const {name}=builtinInfo(code);
    const ports=TFLITE_PORTS[normalize(name)];
    for(const [side,actual] of [['inputs',inputs],['outputs',outputs]]){const expected=ports?.[side];if(expected?.length){const min=expected.filter(p=>!p.optional&&!p.list).length;if(actual.length<min||!expected.some(p=>p.list)&&actual.length>expected.length)throw Error(`${name} ${side} 數量不符合 OP 定義。`);}if(actual.some((t,i)=>!t&&!expected?.[i]?.optional))throw Error('請補齊所有必要輸入與輸出型別。');}
    for(const [k,v] of Object.entries(options||{}))if(/(?:stride|dilation|filter_(?:width|height)|num_splits|block_size)/.test(k)&&(!Number.isInteger(v)||v<=0))throw Error(k+' 必須是正整數。');
    const shapes=t=>Array.from(t.shape||[]),sameType=(a,b)=>a.type===b.type;
    if(['ADD','MUL','SUB','DIV','MAXIMUM','MINIMUM','POW','SQUARED_DIFFERENCE'].includes(name)){
        if(inputs.length!==2||outputs.length!==1)throw Error(name+' 需要 2 個輸入與 1 個輸出。');
        if(!sameType(inputs[0],inputs[1])||!sameType(inputs[0],outputs[0]))throw Error(name+' 輸入／輸出 dtype 不符。');
        const a=shapes(inputs[0]),b=shapes(inputs[1]),expected=[];for(let i=0;i<Math.max(a.length,b.length);i++){const x=a.at(-1-i)??1,y=b.at(-1-i)??1;if(x>=0&&y>=0&&x!==y&&x!==1&&y!==1)throw Error(name+' 的 shape 無法 broadcast。');expected.unshift(x<0||y<0?-1:x===1?y:x);}const out=shapes(outputs[0]);if(out.length!==expected.length||out.some((n,i)=>n>=0&&expected[i]>=0&&n!==expected[i]))throw Error(name+' 的輸出 shape 不符合 broadcast 結果。');
    }
    if(['RESHAPE','SQUEEZE','EXPAND_DIMS'].includes(name)&&inputs[0]&&outputs[0]){const a=shapes(inputs[0]),b=shapes(outputs[0]);if(a.every(n=>n>=0)&&b.every(n=>n>=0)&&a.reduce((n,x)=>n*x,1)!==b.reduce((n,x)=>n*x,1))throw Error(name+' 前後元素數不同。');}
    if(['IF','WHILE'].includes(name)&&!options)throw Error(name+' 需要控制流程 subgraph 設定。');
    return {scope:'索引／型別／資料長度／已實作的 shape 與參數規則；不代表全部 kernel／runtime 語意已驗證'};
}
export const RANDOM_TENSOR_LIMIT=16*1024*1024;
const numeric={0:['Float32Array',4],2:['Int32Array',4],3:['Uint8Array',1],4:['BigInt64Array',8],6:['Uint8Array',1],7:['Int16Array',2],9:['Int8Array',1],10:['Float64Array',8],12:['BigUint64Array',8],15:['Uint32Array',4],16:['Uint16Array',2]};
export function randomTensorInfo(tensor,{seed,min=-.05,max=.05}){
    const kind=numeric[tensor?.type],dims=Array.from(tensor?.shape||[]);if(!kind||tensor.sparsity||tensor.shape_signature?.some(n=>n<0)||dims.some(n=>!Number.isSafeInteger(n)||n<0))throw Error('亂數需要已知 shape 的數值／boolean dense tensor；不支援動態維度或 sparse。');
    const count=dims.reduce((n,x)=>n*x,1);if(!Number.isSafeInteger(count)||count*kind[1]>RANDOM_TENSOR_LIMIT)throw Error('單個亂數 tensor 超過 16 MiB，請縮小 shape 或沿用現有權重。');
    if(!Number.isInteger(seed)||seed<0||seed>4294967295||!Number.isFinite(min)||!Number.isFinite(max)||min>max||Math.abs(min)>1e6||Math.abs(max)>1e6)throw Error('亂數 seed／範圍無效。');
    const q=tensor.quantization;if(q){if(q.scale?.some(x=>!Number.isFinite(x)||x<=0)||q.scale?.length>1&&q.scale.length!==dims[q.quantized_dimension]||q.zero_point?.length&&q.zero_point.length!==q.scale?.length)throw Error('量化 scale、zero point 或 channel 維度不合法。');}
    const ranges={2:[-2147483648,2147483647],3:[0,255],6:[0,1],7:[-32768,32767],9:[-128,127],12:[0,Number.MAX_SAFE_INTEGER],15:[0,4294967295],16:[0,65535],4:[Number.MIN_SAFE_INTEGER,Number.MAX_SAFE_INTEGER]};
    const r=ranges[tensor.type];if(r&&(min<r[0]||max>r[1]||!Number.isInteger(min)||!Number.isInteger(max)))throw Error('整數／量化 tensor 的亂數範圍需為 dtype 可表示的整數。');
    if(q?.zero_point?.some(x=>!r||BigInt(x)<BigInt(r[0])||BigInt(x)>BigInt(r[1])))throw Error('量化 zero point 超出 dtype 範圍。');
    return {count,kind,range:r,bytes:count*kind[1],seed,min,max};
}
export function randomTensor(tensor,spec){
    const {count,kind,range:r,seed,min,max}=randomTensorInfo(tensor,spec),bytes=new Uint8Array(count*kind[1]),view=new DataView(bytes.buffer);let state=seed||0x9e3779b9;
    const setters={0:'setFloat32',2:'setInt32',3:'setUint8',4:'setBigInt64',6:'setUint8',7:'setInt16',9:'setInt8',10:'setFloat64',12:'setBigUint64',15:'setUint32',16:'setUint16'};
    for(let i=0;i<count;i++){state^=state<<13;state^=state>>>17;state^=state<<5;const unit=(state>>>0)/4294967296,v=r?Math.floor(min+unit*(max-min+1)):min+unit*(max-min);view[setters[tensor.type]](i*kind[1],kind[0].includes('Big')?BigInt(v):v,true);}
    return bytes;
}
