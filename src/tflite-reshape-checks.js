import {staticTfliteShape} from './tflite-static-shape.js';

const maxDimension=2147483647;
const unverified=reason=>({status:'not-run',reason});
const fail=message=>{throw Error(`RESHAPE ${message}`);};
const elements=shape=>{
    const size=shape.reduce((count,dim)=>count*dim,1);
    return Number.isSafeInteger(size)?BigInt(size):shape.reduce((count,dim)=>count*BigInt(dim),1n);
};
const sameShape=(a,b)=>a.length===b.length&&a.every((d,i)=>d===b[i]);

// TensorFlow Lite's RESHAPE kernel uses only rank-one int32 shape tensors.
// For legacy options it interprets [0] as scalar, unlike a tensor value [0].
function resolveShape(shape,dims,source){
    if(dims.some(d=>!Number.isInteger(d)||d< -1||d>maxDimension)||dims.filter(d=>d===-1).length>1){
        fail(`${source} 只能包含非負 int32 維度與最多一個 -1。`);
    }
    const stretch=dims.indexOf(-1);
    if(!shape)return unverified(`${source} 已核對格式，input 是動態或未知 shape。`);
    if(stretch>=0&&dims.includes(0))return unverified(`${source} 同時包含 0 與 -1，未驗證零維度的推導。`);
    const count=elements(shape),specified=elements(stretch<0?dims:dims.filter(d=>d!==-1));
    if(stretch<0?count!==specified:count%specified!==0n)fail(`${source} 與 input 元素數不符。`);
    if(stretch>=0&&count/specified>BigInt(maxDimension))fail(`${source} 推導維度超出 int32 範圍。`);
    if(stretch>=0)dims[stretch]=Number(count/specified);
    return {status:'passed',shape:dims};
}

export function checkReshapeMetadata(inputs,outputs,options={},readShape){
    if(![1,2].includes(inputs.length)||!inputs[0]||outputs.length!==1||!outputs[0])fail('需要 1 或 2 個輸入與 1 個輸出。');
    const [input,operand]=inputs,[output]=outputs;
    if(input.type!==output.type)fail('input／output dtype 必須相同。');
    const inputShape=staticTfliteShape(input),outputShape=staticTfliteShape(output);
    if(operand?.type===2&&(!operand.shape||!operand.shape.length&&operand.has_rank===false)){
        return unverified('shape tensor rank 未知，無法判定會使用 shape tensor 或 new_shape。');
    }
    const usesTensor=operand?.type===2&&operand.shape.length===1;
    const source=usesTensor?'shape tensor':'options new_shape';
    let proof;
    if(usesTensor){
        if(!inputShape||!outputShape)return unverified('input／output 是動態或未知 shape，未讀取 shape tensor。');
        const values=readShape?.();
        if(!values){
            if(elements(inputShape)!==elements(outputShape))fail('input／output 元素數不同。');
            return unverified('shape tensor 不是已讀取的靜態常數。');
        }
        proof=resolveShape(inputShape,values.map(Number),source);
    }else{
        proof=resolveOptions(inputShape,options);
    }
    if(proof.status!=='passed')return proof;
    if(!outputShape)return unverified(`${source} 已核對，但 output 是動態或未知 shape。`);
    if(!sameShape(proof.shape,outputShape)){
        fail(`${source} 推導的 output shape 應為 [${proof.shape.join(', ')}]。`);
    }
    if(operand?.type===2&&!usesTensor){
        return unverified('已核對 options new_shape；非向量 int32 shape tensor 的 runtime 行為需另外執行驗證。');
    }
    const fallback=options.new_shape;
    if(usesTensor&&fallback?.length&&(!sameShape(fallback,proof.shape)||fallback.length===1&&fallback[0]===0)){
        // A contradictory fallback leaves the result dependent on how the
        // runtime interprets both sources. Preserve the original options.
        try{
            const alternate=resolveOptions(inputShape,options);
            if(alternate.status!=='passed'||!sameShape(alternate.shape,proof.shape)){
                return unverified('shape tensor 與 options new_shape 無法確認一致；輸出 shape 需另外執行驗證。');
            }
        }catch{
            return unverified('shape tensor 已核對，但 options new_shape 無效；輸出 shape 需另外執行驗證。');
        }
    }
    return {status:'passed',reason:`已核對 ${source}、dtype、元素數與 output shape；未執行 kernel 或驗證數值等價。`};
}

function resolveOptions(inputShape,options){
    const raw=options.new_shape;
    // Decoded metadata cannot distinguish an absent vector from an empty one.
    if(!raw?.length)return unverified('需要可確認的 options new_shape。');
    return resolveShape(inputShape,raw.length===1&&raw[0]===0?[]:Array.from(raw),'options new_shape');
}

export function inferReshapeOptions(input,options){
    return resolveOptions(staticTfliteShape(input),options);
}
