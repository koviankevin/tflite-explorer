import {staticTfliteShape} from './tflite-static-shape.js';

// TFL_BatchMatMulOp permits F32/F16/I8/I16 operands, with the
// int8 x int8 -> int32 accumulator exception. CPU support is separate.
const inputTypes=new Set([0,1,7,9]);
const same=(a,b)=>a.length===b.length&&a.every((d,i)=>d===b[i]);
const rank=t=>{
    const s=t.shape;
    return (Array.isArray(s)||ArrayBuffer.isView(s)&&typeof s.length==='number')&&(s.length||t.has_rank!==false)?s.length:null;
};
export function checkBatchMatmulMetadata(inputs,outputs,options={}){
    const fail=reason=>{throw Error(`BATCH_MATMUL ${reason}`);};
    if(inputs.length!==2||outputs.length!==1||inputs.some(t=>!t)||!outputs[0])fail('需要 2 個輸入與 1 個輸出。');
    const [lhs,rhs]=inputs,out=outputs[0];
    for(const [i,t] of inputs.entries())if(!inputTypes.has(t.type))fail(`input ${i} dtype 必須是 float32／float16／int8／int16。`);
    if(out.type!==lhs.type&&!(lhs.type===9&&rhs.type===9&&out.type===2))fail('output dtype 須與 lhs 相同；只有 int8 × int8 可使用 int32 output。');
    // A dynamic dimension does not erase an explicitly known input rank.
    for(const [i,t] of inputs.entries()){const r=rank(t);if(r!==null&&(r<2||r>5))fail(`input ${i} rank 必須介於 2～5。`);}
    const [a,b]=inputs.map(staticTfliteShape),o=staticTfliteShape(out);
    if(!a||!b||!o)return {status:'not-run',reason:'BATCH_MATMUL input／output 是動態或未知 shape，未推測實際尺寸。'};
    const m=a.at(options.adj_x?-1:-2),ka=a.at(options.adj_x?-2:-1),kb=b.at(options.adj_y?-1:-2),n=b.at(options.adj_y?-2:-1);
    if(ka!==kb)fail('兩個 input 的 contracting dimension 不符。');
    const batch=[];
    for(let i=0;i<Math.max(a.length,b.length)-2;i++){
        const x=a.at(-i-3)??1,y=b.at(-i-3)??1;
        if(x!==y&&x!==1&&y!==1)fail('batch 維度無法 broadcast。');
        batch.unshift(x===1?y:x);
    }
    const expected=[...batch,m,n];
    if(!same(o,expected))fail(`output shape 應為 [${expected.join(', ')}]。`);
    if(lhs.type!==rhs.type&&!(lhs.type===0&&rhs.type===9)&&!(lhs.type===7&&rhs.type===9))return {status:'not-run',reason:'BATCH_MATMUL 此混合 dtype 組合尚無完整靜態規則；已核對 output dtype 與 shape，未推測 kernel 支援。'};
    return {status:'passed',reason:'已核對 BATCH_MATMUL dtype、rank／adjoint／broadcast 與 output shape；未執行 kernel，量化運算語意另需驗證。'};
}
