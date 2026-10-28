// Shared by test inputs and generated weights. Bounds describe representable
// values, not the semantic domains of indices, axes or trained parameters.
const ranges={float16:[-65504,65504],float32:[-3.4028234663852886e38,3.4028234663852886e38],float64:[-Number.MAX_VALUE,Number.MAX_VALUE],
    int8:[-128,127],uint8:[0,255],bool:[0,1],int16:[-32768,32767],uint16:[0,65535],int32:[-2147483648,2147483647],uint32:[0,4294967295],
    int64:[-Number.MAX_SAFE_INTEGER,Number.MAX_SAFE_INTEGER],uint64:[0,Number.MAX_SAFE_INTEGER]};
export const TFLITE_RANDOM_DTYPES=Object.freeze({0:'float32',2:'int32',3:'uint8',4:'int64',6:'bool',7:'int16',9:'int8',10:'float64',12:'uint64',15:'uint32',16:'uint16'});
export function randomRange(dtype){
    if(!Object.hasOwn(ranges,dtype))throw Error(`尚不支援 ${dtype||'此 dtype'} 的亂數產生。`);
    const [min,max]=ranges[dtype],integer=!dtype.startsWith('float');
    return {dtype,min,max,integer,step:integer?'1':'any',defaultMin:integer?0:-.05,defaultMax:integer?1:.05,
        description:`${dtype}：${integer?'只產生整數':'只產生有限值，不含 NaN／Infinity'}，範圍 ${min}～${max}。${dtype.includes('64')&&integer?'64-bit 亂數以 JavaScript 可精確表示的整數為限。':''}`};
}
export function validateRandomRange(dtype,{seed,min,max}={}){
    const range=randomRange(dtype);
    if(!Number.isInteger(seed)||seed<0||seed>4294967295)throw Error('亂數 seed 必須是 0～4294967295 的整數。');
    if(!Number.isFinite(min)||!Number.isFinite(max)||min>max||min<range.min||max>range.max||range.integer&&(!Number.isSafeInteger(min)||!Number.isSafeInteger(max)))throw Error(`亂數範圍不合法。${range.description}`);
    return range;
}
export function seededRandom(dtype,spec){
    const range=validateRandomRange(dtype,spec),{min,max}=spec;let state=spec.seed||0x9e3779b9;
    const span=range.integer?max-min+1:max-min;
    return ()=>{
        state^=state<<13;state^=state>>>17;state^=state<<5;const bits=state>>>0,unit=bits/4294967296;
        if(range.integer){
            // Keep small-range v1 draft bytes stable. Large 64-bit intervals
            // need integer arithmetic to avoid rounding beyond either bound.
            return Number.isSafeInteger(span)?min+Math.floor(unit*span):Number(BigInt(min)+BigInt(bits)*(BigInt(max)-BigInt(min)+1n)/4294967296n);
        }
        // Opposite large finite endpoints can have an infinite difference.
        const value=Number.isFinite(span)?min+unit*span:min*(1-unit)+max*unit;
        if(!Number.isFinite(value))throw Error('無法產生合法的有限浮點數。');
        return value;
    };
}
