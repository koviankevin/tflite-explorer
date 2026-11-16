import {staticTfliteShape} from './tflite-static-shape.js';
// TensorFlow 7bc5d217d3bd79426527d0055fd3b54812f52e93:
// activations.cc and tfl_ops.td. The CPU also admits U8/I8 -> I16 Softmax,
// despite the MLIR same-element-type trait; preserve those as unverified.
export const SOFTMAX_OPERATORS=new Set(['SOFTMAX','LOG_SOFTMAX']);
export const SOFTMAX_OPERATOR_CODES=new Map([[25,'SOFTMAX'],[50,'LOG_SOFTMAX']]);
const rank=t=>{const s=t?.shape;return (Array.isArray(s)||ArrayBuffer.isView(s)&&typeof s.length==='number')&&s.length<=128&&(s.length||t.has_rank!==false)?s.length:null;};
const extent=(t,i,dynamic)=>{
    const value=t.shape?.[i],signature=t.shape_signature;
    if(dynamic&&(signature.length!==t.shape.length||signature[i]<0||signature[i]!==value))return null;
    return Number.isInteger(value)&&value>=0&&value<=2147483647?value:null;
};
export function checkSoftmaxMetadata(name,inputs,outputs,options={}){
    if(!SOFTMAX_OPERATORS.has(name))return null;
    const fail=reason=>{throw Error(name+' '+reason);},skip=reason=>({status:'not-run',reason:name+' '+reason});
    if(inputs.length!==1||outputs.length!==1||!inputs[0]||!outputs[0])fail('需要 1 個完整輸入與 1 個完整輸出。');
    const input=inputs[0],out=outputs[0],allowed=name==='SOFTMAX'?[0,1,3,7,9]:[0,3,9];
    if(!allowed.includes(input.type)||!allowed.includes(out.type))fail('input／output dtype 不在已定義的浮點或量化型別範圍。');
    const mixed=name==='SOFTMAX'&&[3,9].includes(input.type)&&out.type===7;
    if(input.type!==out.type&&!mixed)fail('input／output dtype 不符；僅 SOFTMAX 的 uint8／int8 → int16 是已知混合路徑。');
    const aRank=rank(input),oRank=rank(out);
    if(name==='SOFTMAX'&&aRank===0)fail('input rank 必須至少為 1。');
    if(aRank!==null&&oRank!==null&&aRank!==oRank)fail('output rank 必須與 input 相同。');
    if(aRank!==null&&aRank===oRank){
        const aDynamic=input.shape_signature?.some(n=>n<0),oDynamic=out.shape_signature?.some(n=>n<0);
        for(let i=0;i<aRank;i++){const a=extent(input,i,aDynamic),o=extent(out,i,oDynamic);if(a!==null&&o!==null&&a!==o)fail(`output shape 的 axis ${i} 必須與 input 相同。`);}
    }
    if(name==='SOFTMAX'&&options.beta!==undefined&&typeof options.beta!=='number')fail('beta 必須是數值。');
    const a=staticTfliteShape(input),o=staticTfliteShape(out);
    if(!a||!o)return skip('含動態或未知 shape；已核對可確定的 dtype／rank／維度，未推測完整尺寸。');
    if(name==='LOG_SOFTMAX'&&aRank===0)return skip('scalar 的 kernel 路徑尚未驗證，保留已核對的 dtype 與 shape 關係。');
    if(name==='SOFTMAX'&&(options.beta===undefined||!Number.isFinite(Math.fround(options.beta))))return skip('beta 缺少或不是有限 float32；保留 dtype／rank／shape 檢查，未判定完整參數語意。');
    if(input.type!==0||out.type!==0)return skip('已核對 dtype／rank／靜態 output shape；float16、量化與混合 encoding 的完整 kernel／數值契約尚未驗證。');
    return {status:'passed',reason:`已核對 ${name} dtype、rank、靜態 output shape${name==='SOFTMAX'?' 與有限 float32 beta':''}；未讀 payload、執行 kernel 或驗證數值等價。`};
}
