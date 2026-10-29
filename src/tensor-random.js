// Shared by test inputs and generated weights. Bounds describe representable
// values, not the semantic domains of indices, axes or trained parameters.
const ranges={float16:[-65504,65504],float32:[-3.4028234663852886e38,3.4028234663852886e38],float64:[-Number.MAX_VALUE,Number.MAX_VALUE],
    int8:[-128,127],uint8:[0,255],bool:[0,1],int16:[-32768,32767],uint16:[0,65535],int32:[-2147483648,2147483647],uint32:[0,4294967295],
    int64:[-Number.MAX_SAFE_INTEGER,Number.MAX_SAFE_INTEGER],uint64:[0,Number.MAX_SAFE_INTEGER]};
export const TFLITE_RANDOM_DTYPES=Object.freeze({0:'float32',2:'int32',3:'uint8',4:'int64',6:'bool',7:'int16',9:'int8',10:'float64',12:'uint64',15:'uint32',16:'uint16'});
export const RANDOM_DISTRIBUTIONS=Object.freeze(['uniform','normal','truncated-normal','bernoulli']);
export function randomOptions(spec){
    const distribution=spec.distribution??'uniform',keys=distribution==='uniform'?['min','max']:distribution==='normal'?['mean','std']:distribution==='truncated-normal'?['mean','std','min','max']:distribution==='bernoulli'?['probability']:[];
    if(!RANDOM_DISTRIBUTIONS.includes(distribution))throw Error('亂數分佈不支援。');
    return {seed:spec.seed,...(spec.distribution!==undefined?{distribution}:{}),...Object.fromEntries(keys.map(k=>[k,spec[k]]))};
}
export function randomAlgorithm(spec){return {uniform:'xorshift32-v1',normal:'xorshift32-box-muller-v1','truncated-normal':'xorshift32-truncated-normal-v1',bernoulli:'xorshift32-bernoulli-v1'}[spec.distribution??'uniform'];}
export function randomDefaults(dtype,distribution,role='input'){
    const range=randomRange(dtype),std=role==='weight'?.05:1;
    if(!distribution)distribution=range.integer?(dtype==='bool'?'bernoulli':'uniform'):role==='weight'?'truncated-normal':'normal';
    const values=distribution==='uniform'?{min:range.integer?0:role==='weight'?-.05:0,max:dtype==='uint8'?255:range.integer?1:role==='weight'?.05:1}:distribution==='bernoulli'?{probability:.5}:distribution==='normal'?{mean:0,std}:{mean:0,std,min:-2*std,max:2*std};
    return {seed:1,distribution,...values};
}
export function randomDescription(spec){
    const d=spec.distribution??'uniform';return d==='uniform'?`Uniform：${spec.min}～${spec.max} 之間平均取樣。`:d==='normal'?`Normal：以 ${spec.mean} 為中心，標準差 ${spec.std}；大多數值在平均值附近。`:d==='truncated-normal'?`Truncated Normal：以 ${spec.mean} 為中心、標準差 ${spec.std}，只保留 ${spec.min}～${spec.max} 內的樣本。`:`Bernoulli：產生 0／1，1 的機率為 ${spec.probability}，適合二元 mask。`;
}
export function randomRange(dtype){
    if(!Object.hasOwn(ranges,dtype))throw Error(`尚不支援 ${dtype||'此 dtype'} 的亂數產生。`);
    const [min,max]=ranges[dtype],integer=!dtype.startsWith('float');
    return {dtype,min,max,integer,step:integer?'1':'any',defaultMin:integer?0:-.05,defaultMax:integer?1:.05,
        description:`${dtype}：${integer?'只產生整數':'只產生有限值，不含 NaN／Infinity'}，範圍 ${min}～${max}。${dtype.includes('64')&&integer?'64-bit 亂數以 JavaScript 可精確表示的整數為限。':''}`};
}
export function validateRandomRange(dtype,spec={}){
    const {seed,min,max,mean,std,probability}=spec,distribution=spec.distribution??'uniform';
    const range=randomRange(dtype);
    if(!Number.isInteger(seed)||seed<0||seed>4294967295)throw Error('亂數 seed 必須是 0～4294967295 的整數。');
    if(!RANDOM_DISTRIBUTIONS.includes(distribution))throw Error('亂數分佈不支援。');
    if(distribution==='bernoulli'){if(!Number.isFinite(probability)||probability<0||probability>1)throw Error('Bernoulli 機率必須介於 0～1。');return range;}
    if(distribution==='normal'||distribution==='truncated-normal'){
        if(range.integer)throw Error(`${dtype} 請使用 Uniform 整數或 Bernoulli；Normal 僅支援浮點 tensor，不會暗中四捨五入。`);
        if(!Number.isFinite(mean)||!Number.isFinite(std)||std<=0)throw Error('Normal 平均值需為有限值，標準差必須是大於 0 的有限值。');
        if(distribution==='normal'){
            if(!Number.isFinite(mean-8*std)||!Number.isFinite(mean+8*std)||mean-8*std<range.min||mean+8*std>range.max)throw Error(`Normal 的平均值 ± 8 倍標準差需落在 ${dtype} 可表示範圍，請縮小標準差或改用 Truncated Normal。`);
            return range;
        }
        if(!(min<max)||!Number.isFinite((min-mean)/std)||!Number.isFinite((max-mean)/std))throw Error('Truncated Normal 需要有效的不同上下界及可計算的標準化範圍。');
        const a=(min-mean)/std,b=(max-mean)/std,near=Math.max(a,Math.min(b,0)),far=Math.abs(a)>Math.abs(b)?a:b;
        if(!(a<=0&&b>=0&&b-a>=1)&&(!Number.isFinite((far-near)*(far+near))||(far-near)*(far+near)>16))throw Error('Truncated Normal 範圍取樣效率過低，請縮小遠離平均值的範圍或讓範圍包含平均值。');
    }
    if(!Number.isFinite(min)||!Number.isFinite(max)||min>max||min<range.min||max>range.max||range.integer&&(!Number.isSafeInteger(min)||!Number.isSafeInteger(max)))throw Error(`亂數範圍不合法。${range.description}`);
    return range;
}
export function seededRandom(dtype,spec){
    const range=validateRandomRange(dtype,spec),{min,max}=spec;let state=spec.seed||0x9e3779b9,spare;
    const unit=()=>{state^=state<<13;state^=state>>>17;state^=state<<5;return (state>>>0)/4294967296;};
    const normal=()=>{if(spare!==undefined){const value=spare;spare=undefined;return value;}const radius=Math.sqrt(-2*Math.log(1-unit())),angle=2*Math.PI*unit();spare=radius*Math.sin(angle);return radius*Math.cos(angle);};
    if(spec.distribution==='bernoulli')return ()=>unit()<spec.probability?1:0;
    if(spec.distribution==='normal')return ()=>spec.mean+spec.std*normal();
    if(spec.distribution==='truncated-normal'){
        const a=(min-spec.mean)/spec.std,b=(max-spec.mean)/spec.std,closest=Math.max(a,Math.min(b,0)),useNormal=a<=0&&b>=0&&b-a>=1;
        return ()=>{
            // Conditional sampling, never clipping values onto either bound.
            // Bounded retries protect both Worker generation and manual IO.
            for(let attempt=0;attempt<256;attempt++){
                let z;if(useNormal){z=normal();if(z<a||z>b)continue;}else {const u=unit();z=a*(1-u)+b*u;if(!Number.isFinite(z))throw Error('Truncated Normal 範圍無法計算。');if(unit()>Math.exp(-.5*(z-closest)*(z+closest)))continue;}
                const value=spec.mean+spec.std*z;if(Number.isFinite(value)&&value>=min&&value<=max)return value;
            }
            throw Error('Truncated Normal 範圍取樣效率過低，請讓上下界靠近平均值或放寬範圍；未改用其他分佈。');
        };
    }
    const span=range.integer?max-min+1:max-min;
    return ()=>{
        const u=unit(),bits=state>>>0;
        if(range.integer){
            // Keep small-range v1 draft bytes stable. Large 64-bit intervals
            // need integer arithmetic to avoid rounding beyond either bound.
            return Number.isSafeInteger(span)?min+Math.floor(u*span):Number(BigInt(min)+BigInt(bits)*(BigInt(max)-BigInt(min)+1n)/4294967296n);
        }
        // Opposite large finite endpoints can have an infinite difference.
        const value=Number.isFinite(span)?min+u*span:min*(1-u)+max*u;
        if(!Number.isFinite(value))throw Error('無法產生合法的有限浮點數。');
        return value;
    };
}
