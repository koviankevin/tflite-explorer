import {tflite as schema} from '../vendor/netron/tflite-schema.js';
export const QUANTIZATION_VALUE_LIMIT=262144;
export const QUANTIZATION_TENSOR_LIMIT=65536;
const ranges={2:[-2147483648n,2147483647n],3:[0n,255n],7:[-32768n,32767n],9:[-128n,127n]};
const verdict=(status,reason)=>({status,reason});
// Inspect metadata only. Nonempty shape supplies a rank even in legacy files
// whose has_rank flag defaults to false. QuantizationDetails overrides affine
// fields; an unknown codec is not an affine failure or a verified codec.
export function inspectTensorQuantization(tensor,budget){
    const q=tensor?.quantization;
    if(!q)return null;
    if(q.details)return verdict('not-run','QuantizationDetails 使用其他量化編碼；affine 欄位不適用，此編碼尚未驗證。');
    const count=q.scale?.length||0;
    if(!count)return null;
    if(q.zero_point?.length!==count)return verdict('failed','affine scale／zero point 數量不符。');
    const axis=q.quantized_dimension??0,rank=tensor.shape?.length||0;
    if(!Number.isInteger(axis)||axis<0||rank&&axis>=rank)return verdict('failed','quantized_dimension 超出非空 shape 的 rank 範圍，或不是非負整數。');
    const channels=rank?tensor.shape[axis]:null;
    if(count>1&&Number.isSafeInteger(channels)&&channels>=0&&channels!==count)return verdict('failed','per-axis 量化維度與 scale 數量不符。');
    if(budget&&count*2>budget.remaining)return verdict('not-run','超過本輪量化 metadata 的值檢查預算；未讀取權重或推測數值。');
    const inspected=()=>{if(budget){budget.remaining--;budget.inspected++;}};
    for(let i=0;i<count;i++){inspected();if(!Number.isFinite(q.scale[i])||q.scale[i]<=0)return verdict('failed','量化 scale 必須是有限正數。');}
    const range=ranges[tensor.type];
    for(let i=0;i<count;i++){
        inspected();const zero=q.zero_point[i];
        if(typeof zero!=='bigint'&&!Number.isSafeInteger(zero))return verdict('failed','zero point 必須是可精確表示的整數。');
        if(range&&(BigInt(zero)<range[0]||BigInt(zero)>range[1]))return verdict('failed','zero point 超出 dtype 範圍。');
    }
    if(!range)return verdict('not-run','此 dtype 的 zero point 範圍尚未實作；其餘 affine 欄位已檢查，kernel 仍未驗證。');
    if(!rank&&(count>1||tensor.has_rank!==true)||count>1&&(!Number.isSafeInteger(channels)||channels<0))return verdict('not-run','已核對 affine 值與數量，但 rank／channel 未知，無法完成 per-axis 維度檢查。');
    return verdict('passed','已核對 affine 值、數量、非空 shape 的量化軸及已支援 dtype 的 zero point 範圍；不含 kernel 或數值等價。');
}
export function inspectTfliteQuantization(model,graphs,{valueLimit=QUANTIZATION_VALUE_LIMIT,tensorLimit=QUANTIZATION_TENSOR_LIMIT}={}){
    for(const [value,max]of [[valueLimit,QUANTIZATION_VALUE_LIMIT],[tensorLimit,QUANTIZATION_TENSOR_LIMIT]])if(!Number.isInteger(value)||value<0||value>max)throw Error('量化 metadata 檢查上限無效。');
    const budget={remaining:valueLimit,inspected:0},tensors=[];let total=0,checked=0,failed=0,unchecked=0,omitted=0;
    for(const graph of new Set(graphs)){
        const g=model.subgraphs[graph];if(!Number.isInteger(graph)||!g)throw Error('量化 metadata 檢查的 subgraph 不存在。');
        for(const [tensor,t]of g.tensors.entries()){
            const q=t.quantization;if(!q?.details&&!q?.scale?.length)continue;
            total++;
            if(tensors.length>=tensorLimit){unchecked++;omitted++;continue;}
            const result=inspectTensorQuantization(t,budget);
            if(result.status==='passed')checked++;else if(result.status==='failed')failed++;else unchecked++;
            tensors.push({graph,tensor,dtype:schema.TensorType[t.type]||String(t.type),rank:t.shape?.length||0,scaleCount:q.scale?.length||0,zeroPointCount:q.zero_point?.length||0,dimension:Number.isInteger(q.quantized_dimension??0)?q.quantized_dimension??0:null,...result});
        }
    }
    return {tensors,total,checked,failed,unchecked,omitted,inspectedValues:budget.inspected,valueLimit,tensorLimit,scope:'編號屬匯出結果，只檢查本次輸出的 subgraphs；非空 shape 的量化軸、affine scale／zero point 及已支援 dtype 範圍。每輪最多 262,144 個值、65,536 筆 tensor；超限或其他量化編碼明列未驗證。不讀權重，不執行 interpreter，不代表 kernel 相容或數值等價。'};
}

