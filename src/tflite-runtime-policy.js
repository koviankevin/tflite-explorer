// Estimates are admission checks, not a hard cap on native kernel scratch memory.
// Large-file exploration/export does not read or instantiate the WASM runtime.
import {runtimeDiagnosticContext,runtimeLocationSummary} from './tflite-runtime-diagnostics.js';
import {SOFTMAX_OPERATOR_CODES,checkSoftmaxMetadata} from './tflite-softmax-checks.js';
export const RUNTIME_LIMITS=Object.freeze({modelBytes:128*1024**2,estimatedBytes:512*1024**2,ioBytes:16*1024**2,timeoutMs:30000});
export const RUNTIME_ENGINE='LiteRT.js 2.6.0 / CPU WASM';
export const RUNTIME_INTERPRETER_ENGINE='TFLite Interpreter · tfjs-tflite 0.0.1-alpha.10 / CPU WASM (AOT)';
const types={0:['float32',4],1:['float16',2],2:['int32',4],3:['uint8',1],4:['int64',8],6:['bool',1],7:['int16',2],9:['int8',1],10:['float64',8],12:['uint64',8],15:['uint32',4],16:['uint16',2]};
const dims=t=>Array.from(t.shape||[]);
const builtin=code=>Math.max(code?.builtin_code??0,code?.deprecated_builtin_code??0);
export function runtimePlan(model,bytes){
    const result={schemaVersion:1,engine:RUNTIME_ENGINE,runtimeBackend:'compiled',valueDependentShapeOps:[],modelBytes:bytes,eligible:false,reason:'',inputs:[],outputs:[],controlFlow:false};
    const skip=reason=>({...result,reason});
    if(!model?.subgraphs?.length||!Number.isSafeInteger(bytes)||bytes<=0)return skip('缺少有效的 TFLite 模型。');
    if(bytes>RUNTIME_LIMITS.modelBytes)return skip('本機執行檢查限 128 MiB；此限制不影響模型讀取、編輯或匯出。請使用公司 native runtime 驗證大型模型。');
    // LiteRT selects a declared signature, which need not target subgraph 0.
    // Until a signature selector exists, accept only one complete, ordered
    // primary interface. Equal shapes/dtypes cannot prove correct tensor binding.
    const signatures=model.signature_defs||[],primary=model.subgraphs[0];
    if(signatures.length){const s=signatures[0],ordered=(rows,ids)=>Array.isArray(rows)&&rows.length===ids.length&&rows.every((r,i)=>r.tensor_index===ids[i]&&typeof r.name==='string'&&r.name.length>0)&&new Set(rows.map(r=>r.name)).size===rows.length;
        if(signatures.length!==1||s.subgraph_index!==0||typeof s.signature_key!=='string'||!s.signature_key||!ordered(s.inputs,primary.inputs)||!ordered(s.outputs,primary.outputs))return skip('signature 無法唯一對應主 subgraph 的完整 input／output 順序；本版未執行，避免檢查到其他函式或誤配 .bin。');
    }
    let allocation=0;
    for(const [graphIndex,g]of model.subgraphs.entries()){
        const inputs=new Set(g.inputs),produced=new Set(g.operators.flatMap(op=>Array.from(op.outputs)));
        for(const [opIndex,op]of g.operators.entries()){
            const code=builtin(model.operator_codes[op.opcode_index]),prefix=`subgraph ${graphIndex} · OP #${opIndex}`;
            if(code===22&&op.inputs.length<2&&op.builtin_options?.new_shape===undefined)return skip(`${prefix} RESHAPE 缺少 shape tensor 或 new_shape；無法配置 tensors。若為舊示範檔，請重新開啟新版示範模型。`);
            if(code===39&&op.inputs.length!==2)return skip(`${prefix} TRANSPOSE 需要資料與 permutation 兩個 inputs；目前缺少必要參數，無法配置 tensors。`);
            const softmax=!model.operator_codes[op.opcode_index]?.custom_code&&SOFTMAX_OPERATOR_CODES.get(code);
            if(softmax)try{checkSoftmaxMetadata(softmax,Array.from(op.inputs,id=>g.tensors[id]),Array.from(op.outputs,id=>g.tensors[id]),op.builtin_options||{});}catch(error){return skip(`${prefix} ${error.message}`);}
            // CompiledModel's external output buffers can become stale when a
            // transform resizes its result during Invoke. Use the actual
            // Interpreter, reading its refreshed outputs, without rewriting
            // model inputs as constants or trusting the declared output shape.
            if([22,39,70].includes(code)&&op.inputs.length>1&&op.inputs[1]>=0){
                const id=op.inputs[1],t=g.tensors[id],b=model.buffers[t?.buffer],constant=t&&!t.is_variable&&!inputs.has(id)&&!produced.has(id)&&t.buffer>0&&b&&(Number(b.size)>0||b.data?.length>0||dims(t).includes(0));
                if(!constant){result.runtimeBackend='interpreter';result.engine=RUNTIME_INTERPRETER_ENGINE;if(result.valueDependentShapeOps.length<32)result.valueDependentShapeOps.push({graph:graphIndex,node:opIndex,type:{22:'RESHAPE',39:'TRANSPOSE',70:'EXPAND_DIMS'}[code],tensor:id});}
            }
        }
        for(const op of g.operators){const code=model.operator_codes[op.opcode_index];if(code?.custom_code||builtin(code)===32)return skip('模型含 custom OP；此公開 runtime 未註冊對應 kernel，需使用公司 runtime 驗證。');if([118,119].includes(builtin(code)))result.controlFlow=true;}
        for(const t of g.tensors){const type=types[t.type],shape=dims(t);if(!type)return skip('模型包含此執行檢查尚未支援的 tensor dtype。');if(shape.length>128||t.shape_signature?.some(n=>n<0)||shape.some(n=>!Number.isSafeInteger(n)||n<0))return skip('含動態、未知或過高 rank 的 shape；未執行。');const size=shape.reduce((n,d)=>n*d,1)*type[1];if(!Number.isSafeInteger(size)||size>RUNTIME_LIMITS.estimatedBytes)return skip('tensor 配置估算超過本機執行預算。');allocation+=size;if(!Number.isSafeInteger(allocation)||allocation>RUNTIME_LIMITS.estimatedBytes)return skip('tensor 配置估算超過本機執行預算。');}
    }
    const g=model.subgraphs[0],detail=id=>{const t=g.tensors[id];if(!t||!types[t.type])throw Error('執行檢查介面不存在。');return {name:String(t.name||'').slice(0,256),tensor:id,dtype:types[t.type][0],shape:dims(t),quantized:!!t.quantization?.scale?.length};};
    result.inputs=Array.from(g.inputs,detail);result.outputs=Array.from(g.outputs,detail);
    if(result.runtimeBackend==='interpreter'&&[...result.inputs,...result.outputs].some(t=>!['float32','int32','uint8','bool','int16','int8','float64','uint32'].includes(t.dtype)))return skip('此模型含值相依 shape，需使用標準 Interpreter；目前這個瀏覽器 Interpreter 尚不支援其 input／output dtype。未執行，不退回有已知輸出問題的 CompiledModel。');
    if(result.inputs.length>128||result.outputs.length>128)return skip('模型介面過多，未執行。');
    const io=[...result.inputs,...result.outputs].reduce((sum,t)=>sum+t.shape.reduce((n,d)=>n*d,1)*Object.values(types).find(v=>v[0]===t.dtype)[1],0);
    if(io>RUNTIME_LIMITS.ioBytes)return skip('模型輸入／輸出合計超過 16 MiB，未執行。');
    result.estimatedBytes=bytes*3+allocation*2+64*1024**2;
    if(result.estimatedBytes>RUNTIME_LIMITS.estimatedBytes)return skip('模型與 tensor 的保守配置估算超過 512 MiB，未執行。');
    return {...result,eligible:true,diagnosticContext:runtimeDiagnosticContext(model)};
}
export function runtimeSkipped(reason,engine=RUNTIME_ENGINE){return {schemaVersion:1,engine,status:'not-verified',stage:'preflight',reason,compiled:false,invoked:false,scope:'主 subgraph；未執行時不代表通過。'};}
export function runtimeSummary(result){const status={passed:'通過',failed:'失敗','not-verified':'未能驗證'}[result.status]||'未能驗證',locations=runtimeLocationSummary(result.failureLocations);return `本機執行檢查：${status}。${result.reason}${result.engine?'\n執行引擎：'+result.engine:''}${locations?'\n'+locations:''}`;}
