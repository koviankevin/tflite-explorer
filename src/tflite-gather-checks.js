import {staticTfliteShape} from './tflite-static-shape.js';

// The pinned TFL Gather contract and CPU Prepare agree on integer indices,
// equal params/result element types, and rank/axis/batch relationships. Some
// encodings depend on the kernel build; metadata never proves execution.
const understoodParams=new Set([0,1,2,3,4,5,6,7,9,17,18,21,22]);
const rank=t=>{
    const s=t.shape;
    return (Array.isArray(s)||ArrayBuffer.isView(s)&&typeof s.length==='number')&&(s.length||t.has_rank!==false)?s.length:null;
};
const same=(a,b)=>a.length===b.length&&a.every((d,i)=>d===b[i]);

export function checkGatherMetadata(inputs,outputs,options={}){
    const fail=reason=>{throw Error(`GATHER ${reason}`);};
    if(inputs.length!==2||outputs.length!==1||inputs.some(t=>!t)||!outputs[0])fail('需要 2 個輸入與 1 個輸出。');
    const [params,indices]=inputs,out=outputs[0];
    if(![2,4,7].includes(indices.type))fail('indices dtype 必須是 int16／int32／int64。');
    if(params.type!==out.type)fail('params／output dtype 必須相同。');
    const pr=rank(params),ir=rank(indices),or=rank(out);
    if(pr!==null&&pr<1)fail('params rank 至少為 1。');
    const rawAxis=options.axis??0,rawBatch=options.batch_dims??0;
    for(const [key,value] of [['axis',rawAxis],['batch_dims',rawBatch]])if(!Number.isInteger(value)||value< -2147483648||value>2147483647)fail(`${key} 必須是 int32 整數。`);
    const axis=rawAxis<0?(pr===null?null:rawAxis+pr):rawAxis;
    const batch=rawBatch<0?(ir===null?null:rawBatch+ir):rawBatch;
    if(axis!==null&&pr!==null&&(axis<0||axis>=pr))fail('axis 超出 params rank 範圍。');
    if(batch!==null&&(batch<0||ir!==null&&batch>ir||pr!==null&&batch>=pr||axis!==null&&batch>axis))fail('batch_dims 超出 rank／axis 範圍。');
    if(pr!==null&&ir!==null&&or!==null&&batch!==null&&or!==pr+ir-1-batch)fail(`output rank 應為 ${pr+ir-1-batch}。`);
    const a=staticTfliteShape(params),i=staticTfliteShape(indices),o=staticTfliteShape(out);
    if(a&&i&&batch!==null&&a.slice(0,batch).some((d,j)=>d!==i[j]))fail('batch_dims 指定的 batch 維度不符。');
    if(a&&i&&axis!==null&&batch!==null&&o){
        const expected=[...a.slice(0,axis),...i.slice(batch),...a.slice(axis+1)];
        if(!same(o,expected))fail(`output shape 應為 [${expected.join(', ')}]。`);
    }
    if(!understoodParams.has(params.type))return {status:'not-run',reason:'GATHER 此 params dtype 尚無完整靜態規則；已核對 dtype 關係與已知 rank，未推測 kernel 支援。'};
    if(!a||!i||!o||axis===null||batch===null)return {status:'not-run',reason:'GATHER input／output 是動態或未知 shape；已核對 dtype 與已知 rank／選項，未推測實際尺寸。'};
    return {status:'passed',reason:'已核對 GATHER dtype 關係、rank／axis／batch_dims 與 output shape；未執行 kernel 或驗證數值等價。',paramsShape:a,axis};
}
