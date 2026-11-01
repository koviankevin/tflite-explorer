// Shared metadata rules for draft inference and export validation. No weights
// or interpreter are read. Kernel facts: TensorFlow 7bc5d217d3bd79426527d0055fd3b54812f52e93
// tensorflow/lite/kernels/{squeeze,concatenation}.cc
import {staticTfliteShape} from './tflite-static-shape.js';
export const STATIC_TRANSFORM_OPERATORS=new Set(['SQUEEZE','CONCATENATION']);
const dimensions=t=>t?.shape!==undefined&&(Array.isArray(t.shape)||ArrayBuffer.isView(t.shape))?Array.from(t.shape):null;
const known=t=>staticTfliteShape(t)!==null;
const rank=t=>{const s=t?.shape;return s&&(Array.isArray(s)||ArrayBuffer.isView(s)&&typeof s.length==='number')&&s.length<=128&&(s.length||t.has_rank!==false)?s.length:null;};
const extent=(t,axis,dynamic)=>{
    const n=t.shape[axis],signature=t.shape_signature;
    if(dynamic&&(signature.length!==t.shape.length||signature[axis]<0||signature[axis]!==n))return null;
    return Number.isInteger(n)&&n>=0&&n<=2147483647?n:null;
};
export function inferStaticTransform(name,inputs,options={}){
    if(!STATIC_TRANSFORM_OPERATORS.has(name))return null;
    const invalid=reason=>({status:'invalid',reason:`${name} ${reason}`}),manual=(reason,outputRank,outputRankRange)=>({status:'manual',reason,...(outputRank===undefined?{}:{outputRank}),...(outputRankRange?{outputRankRange}:{})});
    if(name==='SQUEEZE'?inputs.length!==1:inputs.length<1)return invalid(name==='SQUEEZE'?'需要 1 個輸入。':'至少需要 1 個輸入。');
    if(inputs.some(t=>!t))return manual('請補齊所有輸入 tensor。');
    if(name==='CONCATENATION'&&inputs.some(t=>t.type!==inputs[0].type))return invalid('輸入 dtype 必須相同。');
    const ranks=inputs.map(rank),dynamic=inputs.map(t=>t.shape_signature?.some(d=>d<0)||false),inputRank=ranks[0];let axes,set,axis,outputRank,outputRankRange;
    if(name==='SQUEEZE'){
        axes=options.squeeze_dims??[];set=new Set();
        if(!Array.isArray(axes)&&!(ArrayBuffer.isView(axes)&&typeof axes.length==='number'))return invalid('squeeze_dims 必須為整數陣列。');
        for(const value of axes){
            if(!Number.isInteger(value)||value< -2147483648||value>2147483647)return invalid('squeeze_dims 必須為 int32 整數陣列。');
            if(inputRank===null)continue;
            const current=value<0?value+inputRank:value;
            if(current<0||current>=inputRank)return invalid('squeeze_dims axis 超出 input rank。');
            const n=extent(inputs[0],current,dynamic[0]);if(n!==null&&n!==1)return invalid('squeeze_dims 只能指定已知大小為 1 的維度。');
            set.add(current);
        }
        if(axes.length&&inputRank!==null)outputRank=inputRank-set.size;
        if(!axes.length&&inputRank!==null){
            const sizes=Array.from({length:inputRank},(_,i)=>extent(inputs[0],i,dynamic[0])),units=sizes.filter(n=>n===1).length,unknown=sizes.filter(n=>n===null).length;
            outputRankRange=[inputRank-units-unknown,inputRank-units];
        }
    }else{
        const anchor=ranks.find(n=>n!==null);
        if(ranks.some(n=>n!==null&&n!==anchor))return invalid('所有輸入 rank 必須相同。');
        const value=options.axis??0;if(!Number.isInteger(value)||value< -2147483648||value>2147483647)return invalid('axis 必須是 int32 整數。');
        if(anchor!==undefined){
            axis=value<0?value+anchor:value;
            if(axis<0||(anchor===0?axis!==0:axis>=anchor))return invalid('axis 超出輸入 rank。');
            if(anchor===0)return manual('scalar CONCATENATION 的常數條件需由 runtime 檢查，未自動推導。');
            outputRank=anchor;
            const sizes=Array(anchor).fill(null);let lowerBound=0n;
            for(const [j,t]of inputs.entries())if(ranks[j]===anchor){
                for(let i=0;i<anchor;i++)if(i!==axis){
                    const n=extent(t,i,dynamic[j]);if(n===null)continue;
                    if(sizes[i]!==null&&n!==sizes[i])return invalid('非 axis 的已知維度必須相同。');sizes[i]=n;
                }
                lowerBound+=BigInt(extent(t,axis,dynamic[j])??0);
            }
            if(lowerBound>2147483647n)return invalid('axis 維度總和超出 int32 範圍。');
        }
    }
    if(!inputs.every(known))return manual('動態或未知 shape 需明確指定；已核對可確定的 axis／rank，未自動推測完整尺寸。',outputRank,outputRankRange);
    const shapes=inputs.map(dimensions),first=shapes[0];let shape;
    if(name==='SQUEEZE'){
        // Kernel accepts duplicate/aliased axes and removes each dimension once.
        shape=first.filter((d,i)=>axes.length?!set.has(i):d!==1);
    }else{
        shape=[...first];shape[axis]=0;
        for(const dims of shapes){
            if(dims.length!==first.length)return invalid('所有輸入 rank 必須相同。');
            if(dims.some((d,i)=>i!==axis&&d!==first[i]))return invalid('非 axis 維度必須相同。');
            shape[axis]+=dims[axis];if(shape[axis]>2147483647)return invalid('axis 維度總和超出 int32 範圍。');
        }
    }
    return {status:'inferred',shapes:[shape],outputRank:shape.length};
}
export function checkStaticTransform(name,inputs,outputs,options){
    const result=inferStaticTransform(name,inputs,options);if(!result)return;
    if(result.status==='invalid')throw Error(result.reason);
    if(inputs.some(t=>!t))throw Error(name+' 請補齊所有必要輸入 tensor。');
    if(outputs.length!==1||!outputs[0])throw Error(name+' 需要 1 個完整輸出。');
    if(inputs[0]&&outputs[0]&&inputs[0].type!==outputs[0].type)throw Error(name+' 輸入／輸出 dtype 不符。');
    if(result.status==='inferred'&&known(outputs[0])){const actual=dimensions(outputs[0]),expected=result.shapes[0];if(actual.length!==expected.length||actual.some((d,i)=>d!==expected[i]))throw Error(name+' 輸出 shape 不符合參數與輸入維度。');}
    const outRank=rank(outputs[0]);
    if(outRank!==null&&result.outputRank!==undefined&&outRank!==result.outputRank)throw Error(`${name} output rank 應為 ${result.outputRank}。`);
    if(outRank!==null&&result.outputRankRange&&(outRank<result.outputRankRange[0]||outRank>result.outputRankRange[1]))throw Error(`${name} output rank 應位於 ${result.outputRankRange.join('～')}。`);
    if(name==='SQUEEZE'&&outRank!==null&&rank(inputs[0])!==null&&outRank>rank(inputs[0]))throw Error('SQUEEZE output rank 不可大於 input rank。');
    if(result.status!=='inferred'||!known(outputs[0]))return {status:'not-run',reason:`${name} ${result.reason||'output 為動態或未知 shape，未推測完整尺寸。'}`};
    const types=name==='CONCATENATION'?[0,1,2,3,4,6,7,9,15,18]:[0,1,2,3,4,5,6,7,8,9,10,11,12,15,16,18];
    if(!types.includes(inputs[0].type)||name==='SQUEEZE'&&rank(inputs[0])>8)return {status:'not-run',reason:`${name} 已核對 axis／rank／靜態 shape；此 dtype／packing 或高 rank kernel 契約尚未完整驗證。`};
    if(name==='CONCATENATION'&&(options?.fused_activation_function??0)!==0)return {status:'not-run',reason:'CONCATENATION 非 NONE activation 的 kernel 契約尚未驗證；僅核對 axis／rank／靜態 shape。'};
    return {status:'passed',reason:`已核對 ${name} dtype 關係、axis／rank 與靜態 output shape；未讀 payload、執行 kernel 或驗證量化數值。`};
}
