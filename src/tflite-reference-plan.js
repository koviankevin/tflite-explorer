import {tflite as schema} from '../vendor/netron/tflite-schema.js';
import {validateCustomContracts,customOptionReferences} from './tflite-custom-contract.js';
import {tfliteCustomContracts} from './tflite-custom-registry.js';
export function planTfliteReferences(model,graphIndex,nodes,{customContracts=tfliteCustomContracts,extraTensors=[]}={}){
    const graph=model?.subgraphs?.[graphIndex];if(!graph)throw Error('Subgraph 不存在。');
    const contracts=validateCustomContracts(customContracts),selected=[...new Set(nodes)],used=new Set(extraTensors),implicit=new Set(),buffers=new Set([0]),custom=[],matched=[],reasons=[];
    for(const node of selected){
        const op=graph.operators[node],code=model.operator_codes[op?.opcode_index];if(!op||!code)throw Error('選取 OP 或 operator code 不存在。');
        for(const id of [...op.inputs,...op.outputs,...op.intermediates||[]])if(id>=0)used.add(id);
        if(Math.max(code.builtin_code,code.deprecated_builtin_code||0)!==schema.BuiltinOperator.CUSTOM)continue;
        const name=code.custom_code||'Custom';custom.push(name);
        const c=contracts.find(c=>c.customCode===name&&code.version>=c.versionMin&&code.version<=c.versionMax);
        const refs=c&&customOptionReferences(c,op);
        if(!c||refs===null||c.inputCount!==undefined&&op.inputs.length!==c.inputCount||c.outputCount!==undefined&&op.outputs.length!==c.outputCount){reasons.push(`${name} 的版本或 options 未符合已註冊契約。`);continue;}
        for(const ref of refs){
            const table=ref.kind==='tensor'?graph.tensors:model.buffers;
            if(!integerId(ref.id)||!table[ref.id])throw Error(`Subgraph #${graphIndex} · OP #${node} ${name} 的契約 ${ref.kind} #${ref.id} 引用不存在。`);
            (ref.kind==='tensor'?used:buffers).add(ref.id);
            if(ref.kind==='tensor')implicit.add(ref.id);
        }
        matched.push({customCode:name,version:code.version,node});
    }
    for(const id of used){
        const t=graph.tensors[id];if(!integerId(id)||!t)throw Error('契約或 OP 的 tensor 引用無效。');
        if(!integerId(t.buffer)||!model.buffers[t.buffer])throw Error(`Tensor #${id} 的 buffer 不存在。`);buffers.add(t.buffer);
        const details=t.quantization?.details;for(const key of ['scales','zero_points'])if(details?.[key]>=0)used.add(details[key]);
    }
    if(custom.length){
        const standard=new Set(['min_runtime_version','TFLITE_METADATA']);
        if((model.metadata||[]).some(m=>!standard.has(m.name)))reasons.push('模型含不明 metadata 引用，保留全部原始資料。');
        const named=new Set((model.metadata||[]).map(m=>m.buffer));if(Array.from(model.metadata_buffer||[]).some(id=>!named.has(id)))reasons.push('legacy metadata buffer 的引用範圍不明，保留全部原始資料。');
        for(const id of [...named,...model.metadata_buffer||[]]){if(!integerId(id)||!model.buffers[id])throw Error('Metadata buffer 引用無效。');buffers.add(id);}
    }
    const mode=!custom.length?'builtin-compact':reasons.length?'custom-opaque':'custom-contract';
    const all=model.buffers.map((_,id)=>id),retained=mode==='custom-opaque'?all:[...buffers];
    return {mode,preservedIds:custom.length>0,usedTensors:[...used],implicitTensors:[...implicit],bufferDataIds:retained,customOperators:[...new Set(custom)],contracts:matched,reasons:[...new Set(reasons)],elidedBuffers:mode==='custom-contract'?all.filter(id=>!buffers.has(id)):[],scope:'只依受信任建置契約裁切資料；保留 custom tensor／buffer 編號。未知格式、外部 options 或 metadata 引用不明時完整保留；不驗證 custom kernel。'};
}
export function referencePlanSummary(plan){
    return {mode:plan.mode,contracts:[...new Map(plan.contracts.map(c=>[c.customCode+':'+c.version,{customCode:c.customCode,version:c.version}])).values()],matchedOperators:plan.contracts.length,reasons:plan.reasons.slice(0,16),elidedBufferCount:plan.elidedBuffers.length,elidedBuffers:plan.elidedBuffers.slice(0,256),elidedListTruncated:plan.elidedBuffers.length>256,scope:plan.scope};
}
const integerId=n=>Number.isSafeInteger(n)&&n>=0;
