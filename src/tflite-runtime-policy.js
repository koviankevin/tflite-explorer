// Estimates are admission checks, not a hard cap on native kernel scratch memory.
// Large-file exploration/export does not read or instantiate the WASM runtime.
export const RUNTIME_LIMITS=Object.freeze({modelBytes:128*1024**2,estimatedBytes:512*1024**2,ioBytes:16*1024**2,timeoutMs:30000});
export const RUNTIME_ENGINE='LiteRT.js 2.6.0 / CPU WASM';
const types={0:['float32',4],1:['float16',2],2:['int32',4],3:['uint8',1],4:['int64',8],6:['bool',1],7:['int16',2],9:['int8',1],10:['float64',8],12:['uint64',8],15:['uint32',4],16:['uint16',2]};
const dims=t=>Array.from(t.shape||[]);
export function runtimePlan(model,bytes){
    const result={schemaVersion:1,engine:RUNTIME_ENGINE,modelBytes:bytes,eligible:false,reason:'',inputs:[],outputs:[],controlFlow:false};
    const skip=reason=>({...result,reason});
    if(!model?.subgraphs?.length||!Number.isSafeInteger(bytes)||bytes<=0)return skip('缺少有效的 TFLite 模型。');
    if(bytes>RUNTIME_LIMITS.modelBytes)return skip('本機執行檢查限 128 MiB；此限制不影響模型讀取、編輯或匯出。請使用公司 native runtime 驗證大型模型。');
    let allocation=0;
    for(const g of model.subgraphs){
        for(const op of g.operators){const code=model.operator_codes[op.opcode_index];if(code?.custom_code||code?.builtin_code===32)return skip('模型含 custom OP；此公開 runtime 未註冊對應 kernel，需使用公司 runtime 驗證。');if([118,119].includes(code?.builtin_code))result.controlFlow=true;}
        for(const t of g.tensors){const type=types[t.type],shape=dims(t);if(!type)return skip('模型包含此執行檢查尚未支援的 tensor dtype。');if(shape.length>128||t.shape_signature?.some(n=>n<0)||shape.some(n=>!Number.isSafeInteger(n)||n<0))return skip('含動態、未知或過高 rank 的 shape；未執行。');const size=shape.reduce((n,d)=>n*d,1)*type[1];if(!Number.isSafeInteger(size)||size>RUNTIME_LIMITS.estimatedBytes)return skip('tensor 配置估算超過本機執行預算。');allocation+=size;if(!Number.isSafeInteger(allocation)||allocation>RUNTIME_LIMITS.estimatedBytes)return skip('tensor 配置估算超過本機執行預算。');}
    }
    const g=model.subgraphs[0],detail=id=>{const t=g.tensors[id];if(!t||!types[t.type])throw Error('執行檢查介面不存在。');return {name:String(t.name||'').slice(0,256),tensor:id,dtype:types[t.type][0],shape:dims(t),quantized:!!t.quantization?.scale?.length};};
    result.inputs=Array.from(g.inputs,detail);result.outputs=Array.from(g.outputs,detail);
    if(result.inputs.length>128||result.outputs.length>128)return skip('模型介面過多，未執行。');
    const io=[...result.inputs,...result.outputs].reduce((sum,t)=>sum+t.shape.reduce((n,d)=>n*d,1)*Object.values(types).find(v=>v[0]===t.dtype)[1],0);
    if(io>RUNTIME_LIMITS.ioBytes)return skip('模型輸入／輸出合計超過 16 MiB，未執行。');
    result.estimatedBytes=bytes*3+allocation*2+64*1024**2;
    if(result.estimatedBytes>RUNTIME_LIMITS.estimatedBytes)return skip('模型與 tensor 的保守配置估算超過 512 MiB，未執行。');
    return {...result,eligible:true};
}
export function runtimeSkipped(reason){return {schemaVersion:1,engine:RUNTIME_ENGINE,status:'not-verified',stage:'preflight',reason,compiled:false,invoked:false,scope:'主 subgraph；未執行時不代表通過。'};}
export function runtimeSummary(result){const status={passed:'通過',failed:'失敗','not-verified':'未能驗證'}[result.status]||'未能驗證';return `LiteRT 本機檢查：${status}。${result.reason}`;}
