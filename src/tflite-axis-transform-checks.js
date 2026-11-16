// Shared metadata constraints from TensorFlow 7bc5d217d3bd79426527d0055fd3b54812f52e93
// tensorflow/lite/kernels/{transpose,expand_dims}.cc. No payload reads or inference.
const rank=t=>{
    const s=t?.shape;
    if(!s||!Array.isArray(s)&&!ArrayBuffer.isView(s)||!Number.isInteger(s.length)||s.length>128||!s.length&&t.has_rank===false)return null;
    return s.length;
};
const extent=(t,axis)=>{
    const value=t.shape[axis],signature=t.shape_signature;
    if(signature?.length&&(signature.length!==t.shape.length||signature[axis]!==value))return null;
    return Number.isInteger(value)&&value>=0&&value<=2147483647?value:null;
};
export function checkAxisTransformMetadata(name,inputs,outputs){
    if(name!=='TRANSPOSE'&&name!=='EXPAND_DIMS')return;
    const [input,operand]=inputs,[output]=outputs,fail=message=>{throw Error(name+' '+message);};
    if(inputs.length!==2||outputs.length!==1||!input||!operand||!output)fail('需要 2 個完整輸入與 1 個完整輸出。');
    if(input.type!==output.type)fail('input／output dtype 必須相同。');
    const inputRank=rank(input),operandRank=rank(operand),outputRank=rank(output);
    if(name==='TRANSPOSE'){
        if(operand.type!==2)fail('permutation tensor 必須是 int32。');
        if(operandRank!==null&&operandRank!==1)fail('permutation tensor 必須是一維向量。');
        if(operandRank===1&&inputRank!==null){const length=extent(operand,0);if(length!==null&&length!==inputRank)fail('permutation 向量長度必須等於 input rank。');}
        if(inputRank!==null&&outputRank!==null&&outputRank!==inputRank)fail('output rank 必須等於 input rank。');
    }else{
        if(operand.type!==2&&operand.type!==4)fail('axis tensor 必須是 int32 或 int64。');
        // The kernel accepts a scalar or any tensor containing one element,
        // including [1,1]. Dynamic dimensions are not interpreted as constants.
        if(operandRank!==null)for(let i=0;i<operandRank;i++){const n=extent(operand,i);if(n!==null&&n!==1)fail('axis tensor 必須只有 1 個元素。');}
        if(inputRank!==null&&outputRank!==null&&outputRank!==inputRank+1)fail('output rank 必須等於 input rank + 1。');
    }
}
