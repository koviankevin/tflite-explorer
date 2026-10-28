import {tflite as schema} from '../vendor/netron/tflite-schema.js';
import {FlatbufferWriter,tableFields} from './flatbuffer-writer.js';
import {builtinSettings,checkBuiltinPorts,randomTensorInfo} from './tflite-new-ops.js';

function optionsPatch(source,changes) {
    if(!source||!changes||typeof changes!=='object'||Array.isArray(changes))throw Error('此 OP 沒有可修改的 builtin options。');
    const fields=new Map(tableFields(source.constructor.name).map(f=>[f.key,f])),result=Object.assign(Object.create(Object.getPrototypeOf(source)),source);
    for(const [key,value] of Object.entries(changes)){
        const field=fields.get(key);if(!field)throw Error('未知的 OP 參數：'+key);
        const ranges={int8_:[-128,127],int32_:[-2147483648,2147483647],uint32_:[0,4294967295]};
        const range=ranges[field.kind];
        if(field.kind==='bool_'?typeof value!=='boolean':range?!Number.isInteger(value)||value<range[0]||value>range[1]:field.kind==='float32_'?!Number.isFinite(value)||Math.abs(value)>3.4028234663852886e38:field.kind==='string_'?typeof value!=='string'||value.length>4096:true)throw Error('OP 參數型別或範圍無效：'+key);
        result[key]=value;
    }
    return result;
}

export function validateTfliteModelGraph(model,graphIndex) {
    const graph=model.subgraphs[graphIndex];if(!graph)throw Error('找不到 TFLite subgraph。');
    const tensor=id=>{if(!Number.isInteger(id)||id<0||!graph.tensors[id])throw Error(`Tensor #${id} 不存在。`);return graph.tensors[id];};
    const available=new Set(),produced=new Set();
    graph.tensors.forEach((t,id)=>{if(!Number.isInteger(t.buffer)||!model.buffers[t.buffer])throw Error(`Tensor #${id} 的 buffer 不存在。`);if(t.is_variable||t.external_buffer||Number(model.buffers[t.buffer].size||0n)||model.buffers[t.buffer].data?.length)available.add(id);});
    for(const id of graph.inputs){tensor(id);available.add(id);}
    for(const [position,op] of graph.operators.entries()){
        if(!Number.isInteger(op.opcode_index)||!model.operator_codes[op.opcode_index])throw Error(`OP #${position} 的 operator code 不存在。`);
        if(op.mutating_variable_inputs?.length&&op.mutating_variable_inputs.length!==op.inputs.length)throw Error(`OP #${position} 的 mutating inputs 數量不符。`);
        for(const id of op.inputs){if(id===-1)continue;tensor(id);if(!available.has(id))throw Error(`OP #${position} 的輸入 tensor #${id} 缺少先前的 producer、模型輸入或權重。`);}
        for(const id of op.intermediates||[])tensor(id);
        for(const id of op.outputs){const t=tensor(id);if(!t.is_variable&&(Number(model.buffers[t.buffer].size||0n)||model.buffers[t.buffer].data?.length))throw Error(`輸出 tensor #${id} 仍指向唯讀權重；請建立新的 result tensor。`);if(produced.has(id)&&!t.is_variable)throw Error(`Tensor #${id} 有多個 producer。`);produced.add(id);available.add(id);}
        for(const options of [op.builtin_options,op.builtin_options_2])if(options)for(const [key,value] of Object.entries(options))if(/subgraph/.test(key))for(const id of typeof value==='number'?[value]:Array.from(value||[]))if(!Number.isInteger(id)||!model.subgraphs[id])throw Error(`OP #${position} 的控制流程 subgraph #${id} 不存在。`);
    }
    for(const id of graph.outputs){tensor(id);if(!available.has(id))throw Error(`模型輸出 tensor #${id} 缺少 producer。`);}
    for(const signature of model.signature_defs||[])if(signature.subgraph_index===graphIndex){
        for(const [key,interfaceIds] of [['inputs',graph.inputs],['outputs',graph.outputs]])for(const mapping of signature[key]||[])if(!interfaceIds.includes(mapping.tensor_index))throw Error(`Signature ${signature.signature_key} 的 ${key} tensor #${mapping.tensor_index} 不在模型介面；請同步修改 signature。`);
    }
    return {passed:true,scope:'Tensor／buffer／operator 索引、執行順序、producer、signature 與控制流程引用；不含 kernel shape inference、custom runtime 或推論語意'};
}

// A declarative plan references immutable original OP templates. Reordering,
// removing, cloning and rewiring them creates a complete new TFLite model.
// New result tensors append to the tensor table; original IDs never change.
export function editTfliteModel(index,file,plans) {
    if(!index?.raw)throw Error('此模型不是 TFLite。');
    if(index.exportUnsupportedReason)throw Error(index.exportUnsupportedReason);
    if(!Array.isArray(plans)||!plans.length||plans.length>index.raw.subgraphs.length)throw Error('請提供有效的模型修改。');
    if(plans.reduce((sum,p)=>sum+(p?.tensors||[]).reduce((n,t)=>n+(t?.data?.byteLength||0),0),0)>32*1024**2)throw Error('新增權重總量超過 32 MiB。');
    const range=(offset,size)=>{offset=Number(offset||0n);size=Number(size||0n);if(!Number.isSafeInteger(offset)||!Number.isSafeInteger(size)||offset<0||size<0||(size&&offset<2)||offset>file.size-size)throw Error('權重或 custom options 超出來源範圍。');return {offset,size};};
    const model={...index.raw,subgraphs:index.raw.subgraphs.slice(),signature_defs:index.raw.signature_defs.slice(),operator_codes:index.raw.operator_codes.slice(),buffers:index.raw.buffers.slice()},changed=new Set(),changes=[];let interfaceChangedAny=false;
    const ids=(value,total,optional=false)=>{
        if(!Array.isArray(value)&&!ArrayBuffer.isView(value))throw Error('Tensor 連線必須是編號清單。');
        if(value.length>65535||Array.from(value).some(id=>!Number.isInteger(id)||(id<0?!(optional&&id===-1):id>=total)))throw Error('Tensor 連線編號超出範圍。');return Int32Array.from(value);
    };
    for(const plan of plans){
        if(!plan||typeof plan!=='object')throw Error('模型修改格式無效。');
        for(const key of Object.keys(plan))if(!['graph','operators','tensors','inputs','outputs','updateSignatures'].includes(key))throw Error('未知的模型修改欄位：'+key);
        const original=index.raw.subgraphs[plan.graph];if(!Number.isInteger(plan.graph)||!original||changed.has(plan.graph))throw Error('Subgraph 不存在或重複修改。');changed.add(plan.graph);
        const tensors=original.tensors.slice();
        if(plan.tensors!==undefined&&(!Array.isArray(plan.tensors)||plan.tensors.length>1024))throw Error('單次最多新增 1024 個 result tensors。');
        for(const fresh of plan.tensors||[]){if(!fresh||typeof fresh!=='object'||Object.keys(fresh).some(key=>!['like','name','data'].includes(key)))throw Error('新 tensor 修改欄位無效。');const source=original.tensors[fresh.like];if(!Number.isInteger(fresh.like)||!source||typeof fresh.name!=='string'||fresh.name.length>256)throw Error('新 tensor 需要有效的參考 tensor 與名稱。');let buffer=0;if(fresh.data!==undefined){if(!(fresh.data instanceof Uint8Array)||fresh.data.length>16*1024**2)throw Error('新權重資料無效或超過 16 MiB。');if(fresh.data.length!==randomTensorInfo(source,{seed:1,min:0,max:0}).bytes)throw Error('新權重資料長度與 dtype／shape 不符。');buffer=model.buffers.length;model.buffers.push({data:fresh.data,offset:0n,size:0n});}tensors.push({...source,name:fresh.name,buffer,external_buffer:0,is_variable:false,sparsity:null});}
        if(plan.operators!==undefined&&!Array.isArray(plan.operators))throw Error('OP 修改必須是清單。');
        if(plan.operators?.length>original.operators.length+4096)throw Error('單次最多新增 4096 個 OP。');
        const entries=plan.operators||original.operators.map((_,template)=>({template}));
        const operators=entries.map(entry=>{
            const source=original.operators[entry.template];if(!Number.isInteger(entry.template)||!source)throw Error('找不到原始 OP 範本。');
            const op={...source,debug_metadata_index:-1};
            for(const key of Object.keys(entry))if(!['template','inputs','outputs','intermediates','options','options2','builtin'].includes(key))throw Error('未知的 OP 修改欄位：'+key);
            for(const key of ['inputs','outputs','intermediates'])if(entry[key]!==undefined)op[key]=ids(entry[key],tensors.length,key==='inputs');
            if(entry.options!==undefined)op.builtin_options=optionsPatch(source.builtin_options,entry.options);
            if(entry.options2!==undefined)op.builtin_options_2=optionsPatch(source.builtin_options_2,entry.options2);
            if(entry.builtin){const {info,options}=builtinSettings(entry.builtin.code,entry.builtin.settings),version=entry.builtin.version;if(!Number.isInteger(version)||version<1||version>100)throw Error('OP version 無效。');let id=model.operator_codes.findIndex(c=>c.builtin_code===info.code&&c.version===version&&!c.custom_code);if(id<0){id=model.operator_codes.length;model.operator_codes.push({builtin_code:info.code,deprecated_builtin_code:Math.min(info.code,127),custom_code:null,version});}Object.assign(op,{opcode_index:id,builtin_options:null,builtin_options_2:null,custom_options:null,large_custom_options_offset:0n,large_custom_options_size:0n,mutating_variable_inputs:[],intermediates:[],customOptionsInline:false,customOptionsDeferred:false,customOptionsRange:null});op[info.group]=options;checkBuiltinPorts(info.code,Array.from(op.inputs,id=>tensors[id]),Array.from(op.outputs,id=>tensors[id]),options);}
            return op;
        });
        const graph={...original,tensors,operators,debug_metadata_index:-1};
        for(const key of ['inputs','outputs'])if(plan[key]!==undefined)graph[key]=ids(plan[key],tensors.length);
        const interfaceChanged=['inputs','outputs'].some(key=>graph[key].length!==original[key].length||graph[key].some((id,i)=>id!==original[key][i]));
        interfaceChangedAny ||= interfaceChanged;
        if(interfaceChanged)model.signature_defs=model.signature_defs.map(signature=>{
            if(signature.subgraph_index!==plan.graph)return signature;
            if(plan.updateSignatures!==true)throw Error('模型介面變更需同步修改 signature；請明確啟用更新 signature。');
            const next={...signature};
            for(const key of ['inputs','outputs']){
                if(graph[key].length===original[key].length&&graph[key].every((id,i)=>id===original[key][i]))continue;
                const old=new Map(signature[key].map(m=>[m.tensor_index,m.name])),used=new Set();
                next[key]=Array.from(graph[key],tensor_index=>{
                    let name=old.get(tensor_index)||`tensor_${tensor_index}`,suffix=1;const base=name;
                    while(used.has(name))name=`${base}_${suffix++}`;used.add(name);return {name,tensor_index};
                });
            }
            return next;
        });
        model.subgraphs[plan.graph]=graph;changes.push({graph:plan.graph,before:original.operators.length,after:operators.length,newTensors:tensors.length-original.tensors.length});
    }
    for(const graph of changed)validateTfliteModelGraph(model,graph);
    const metadataChanges=[];
    if(interfaceChangedAny&&index.raw.metadata.some(m=>m.name==='TFLITE_METADATA')){
        // TFLITE_METADATA describes the old public interface. Its opaque bytes
        // cannot be updated by guessing; remove the stale descriptor, preserve
        // every buffer ID/data and all other custom-runtime metadata.
        const stale=new Set(index.raw.metadata.filter(m=>m.name==='TFLITE_METADATA').map(m=>m.buffer));
        model.metadata=index.raw.metadata.filter(m=>m.name!=='TFLITE_METADATA');const retained=new Set(model.metadata.map(m=>m.buffer));
        model.metadata_buffer=Int32Array.from(index.raw.metadata_buffer.filter(id=>!stale.has(id)||retained.has(id)));
        metadataChanges.push('模型介面已變更，移除描述舊介面的 TFLITE_METADATA；原始 buffer bytes／編號及其他 metadata 保留。');
    }
    // All buffers, metadata, signatures, subgraphs and numbering are retained.
    // Only structural bytes are rebuilt; large data remains source File slices.
    model.buffers=model.buffers.map((source,id)=>{const r=range(source.offset,source.size);return {...source,data:r.size?null:source.data,offset:0n,size:0n,...(r.size?{sourceRange:{...r,kind:'buffer',reference:`buffer:${id}`}}:{})};});
    model.subgraphs=model.subgraphs.map((g,graph)=>({...g,operators:g.operators.map((source,node)=>{
        let op=source;
        if(!op.customOptionsInline&&!op.custom_options?.length)op={...op,custom_options:null};
        if(op.customOptionsInline&&op.custom_options?.length)op={...op,byteSources:{custom_options:{...op.customOptionsRange,kind:'custom-options-inline',reference:`graph:${graph}:operator:${node}`}}};
        if(!op.large_custom_options_size&&!op.customOptionsDeferred)return op;
        const r=op.customOptionsDeferred?range(op.customOptionsRange.offset,op.customOptionsRange.size):range(op.large_custom_options_offset,op.large_custom_options_size),inline=!op.customOptionsDeferred&&op.customOptionsInline;
        return {...op,custom_options:inline?op.custom_options:null,large_custom_options_offset:0n,large_custom_options_size:0n,externalRanges:[{offsetKey:'large_custom_options_offset',sizeKey:'large_custom_options_size',...r,kind:'custom-options-external',reference:`graph:${graph}:operator:${node}`}]};
    })}));
    return {...new FlatbufferWriter().finishArtifact(model,file),changes,metadataChanges,format:'tflite',validation:{passed:true,scope:'本機結構檢查；kernel、shape inference 與 custom runtime 尚未驗證'},verification:'structure-only'};
}
