// Worker-side static shape propagation. Preview and export derive the same
// graph from original metadata and replayed commands, never from supplied shapes.
import {tflite as schema} from '../vendor/netron/tflite-schema.js';
import {tfliteWorkspacePlans} from './tflite-workspace-plan.js';
import {builtinSettings,checkBuiltinPorts} from './tflite-new-ops.js';
import {inferTfliteOutputs} from './tflite-shape-inference.js';
import {inferReshapeOptions,inferReshapeOperand} from './tflite-reshape-checks.js';
import {staticTfliteShape} from './tflite-static-shape.js';
import {checkOperandValues,OPERAND_OPERATORS} from './tflite-operand-checks.js';
import {checkFullyConnectedMetadata} from './tflite-fully-connected-checks.js';
import {checkBatchMatmulMetadata} from './tflite-matmul-checks.js';
import {replayEditDraft,editDeletePreview} from './model-edit-draft.js';

export const DELETE_INFERENCE_ALGORITHM='tflite-static-v1';
const same=(a,b)=>Array.isArray(a)&&Array.isArray(b)&&a.length===b.length&&a.every((n,i)=>n===b[i]);
const dims=t=>staticTfliteShape(t);
const sameMetaShape=(a,b)=>a===b||same(dims(a),dims(b));
const shaped=(t,shape)=>({...t,shape:[...shape],shape_signature:t.shape_signature?.length?[...shape]:[],has_rank:true});
const maxDimension=2147483647;
const checkedShape=shape=>{if(!Array.isArray(shape)||shape.length>128||shape.some(d=>!Number.isInteger(d)||d<0||d>maxDimension))throw Error('推導的維度超出支援範圍。');return shape;};
const unaryData=new Set(['RESHAPE','TRANSPOSE','SQUEEZE','EXPAND_DIMS','TILE','PAD','PADV2','SLICE','STRIDED_SLICE','FULLY_CONNECTED','CONV_2D','DEPTHWISE_CONV_2D','AVERAGE_POOL_2D','MAX_POOL_2D','L2_POOL_2D','SOFTMAX','LOG_SOFTMAX','ABS','NEG','EXP','LOG','SQRT','RSQRT','SQUARE','FLOOR','CEIL','ROUND','RELU','RELU6','RELU_N1_TO_1','LOGISTIC','TANH','ELU','LEAKY_RELU','HARD_SWISH','GELU','SIN','COS','ADD','MUL','SUB','DIV','MAXIMUM','MINIMUM','POW','SQUARED_DIFFERENCE','BATCH_MATMUL','CONCATENATION','MEAN','SUM','REDUCE_PROD','REDUCE_MIN','REDUCE_MAX','REDUCE_ANY','REDUCE_ALL']);
const parameterOps=new Set(['RESHAPE','TRANSPOSE','EXPAND_DIMS',...OPERAND_OPERATORS]);

function inferOperation(name,inputs,outputs,options,constant){
    if(inputs.some(t=>t&&!dims(t)))throw Error('輸入是動態或未知 shape，無法可靠推導。');
    if(outputs.some(t=>!dims(t)))throw Error('輸出是動態或未知 shape，未覆寫其動態契約。');
    if(name==='RESHAPE'){
        let result;
        if(inputs.length===2&&inputs[1]){if(inputs[1].type!==2||inputs[1].shape.length!==1)throw Error('RESHAPE shape 參數必須是靜態 int32 向量。');result=inferReshapeOperand(inputs[0],constant(1,[2]));}
        else result=inferReshapeOptions(inputs[0],options);
        if(result.status!=='passed')throw Error(result.reason);return [result.shape];
    }
    if(name==='TRANSPOSE'||name==='EXPAND_DIMS'){
        const a=dims(inputs[0]),v=constant(1,name==='TRANSPOSE'?[2]:[2,4]).map(Number);
        if(name==='TRANSPOSE'){
            const axes=v.map(n=>n<0?n+a.length:n);if(axes.length!==a.length||new Set(axes).size!==a.length||axes.some(n=>n<0||n>=a.length))throw Error('permutation 需包含每個 axis 一次，且長度須符合新的 input rank。');
            return [axes.map(n=>a[n])];
        }
        if(v.length!==1||v[0]<-a.length-1||v[0]>a.length)throw Error('EXPAND_DIMS axis 超出新的 input rank。');const axis=v[0]<0?v[0]+a.length+1:v[0];return [[...a.slice(0,axis),1,...a.slice(axis)]];
    }
    if(OPERAND_OPERATORS.has(name)){const result=checkOperandValues(name,inputs,outputs,options,slot=>constant(slot,[2,4,7,9,6]),{inferOnly:true});if(result.status!=='passed')throw Error(result.reason);return result.shapes;}
    if(name==='FULLY_CONNECTED'){
        if((options.weights_format??0)!==0||options.quant_spec?.length)throw Error('此 FC weights_format／quant_spec 尚無可自動推導的契約。');
        const a=dims(inputs[0]),w=dims(inputs[1]);if(!a||!w||w.length!==2||w[1]<=0)throw Error('FC 需要靜態 [units, input_size] 權重。');
        const count=a.reduce((n,d)=>n*BigInt(d),1n),cols=BigInt(w[1]);if(count%cols||options.keep_num_dims&&a.at(-1)!==w[1])throw Error(`FC input 元素數／最後一維與 weights input_size ${w[1]} 不相容；不會修改權重。`);
        const batch=count/cols;if(batch>BigInt(maxDimension))throw Error('FC batch 超出維度範圍。');const shape=options.keep_num_dims?[...a.slice(0,-1),w[0]]:[Number(batch),w[0]];
        checkFullyConnectedMetadata(inputs,[shaped(outputs[0],shape)],options);return [shape];
    }
    if(name==='BATCH_MATMUL'){
        const [a,b]=inputs.map(dims);if(!a||!b||a.length<2||b.length<2)throw Error('BATCH_MATMUL 需要已知且至少二維的輸入。');
        const m=a.at(options.adj_x?-1:-2),ka=a.at(options.adj_x?-2:-1),kb=b.at(options.adj_y?-1:-2),n=b.at(options.adj_y?-2:-1),batch=[];if(ka!==kb)throw Error(`BATCH_MATMUL contracting dimensions 不符（${ka}、${kb}）。`);
        for(let i=0;i<Math.max(a.length,b.length)-2;i++){const x=a.at(-3-i)??1,y=b.at(-3-i)??1;if(x!==y&&x!==1&&y!==1)throw Error('BATCH_MATMUL batch 維度無法 broadcast。');batch.unshift(x===1?y:x);}
        const shape=[...batch,m,n];checkBatchMatmulMetadata(inputs,[shaped(outputs[0],shape)],options);return [shape];
    }
    const normalized=inputs.map(t=>t?{...t,shape:dims(t)}:null),result=inferTfliteOutputs(name,normalized,outputs.map(t=>({...t,shape:dims(t)})),options);
    if(result.status!=='inferred')throw Error(result.reason||`${name} 尚無推導規則。`);return result.shapes;
}

export async function inferDeletedGraph(index,state,readAt,{verifyLocal=false,cancelled=()=>false}={}){
    if(cancelled())throw Error('已取消 shape 推導。');
    const graphs=new Set(state.nodes.filter(n=>n.removed&&n.autoShape).map(n=>n.source.graph)),shapePatches=[],localShapes=[],rows=[];
    if([...graphs].some(g=>index.raw.subgraphs[g].operators.length>200000))throw Error('模型超過本次 200,000 個 OP 的推導掃描上限。');
    let work=0,affected=0,changedTensors=0,readBytes=0,inspectedBytes=0;
    const plans=tfliteWorkspacePlans(index,state,state.nodes.filter(n=>n.removed&&n.autoShape).map(n=>({node:n.id})),{metadataOnly:true});
    for(const plan of plans){
        if(!graphs.has(plan.graph))continue;
        const raw=index.raw.subgraphs[plan.graph],tensors=raw.tensors.slice(),originalCount=tensors.length,ids=new Map(plan.valueIds),byNode=new Map(state.nodes.map(n=>[n.id,n]));
        for(const spec of plan.tensors)tensors.push({...raw.tensors[spec.like],name:spec.name,buffer:0,sparsity:null,is_variable:false,external_buffer:0,generated:!!spec.generated});
        const entries=plan.operators.map((entry,i)=>{const source=raw.operators[entry.template],node=byNode.get(plan.editNodes[i]),builtin=entry.builtin?builtinSettings(entry.builtin.code,entry.builtin.settings):null,code=index.raw.operator_codes[source.opcode_index];return {entry,source,node,name:builtin?.info.name||code.custom_code||schema.BuiltinOperator[Math.max(code.builtin_code,code.deprecated_builtin_code||0)],custom:!builtin&&!!code.custom_code,options:builtin?.options||source.builtin_options||source.builtin_options_2||{},inputs:Array.from(entry.inputs||source.inputs),outputs:Array.from(entry.outputs||source.outputs)};});
        const produced=new Set(entries.flatMap(e=>e.outputs)),modelInputs=new Set(plan.inputs),cache=new Map();
        const values=async(id,types)=>{
            const t=tensors[id],shape=dims(t),b=index.raw.buffers[t?.buffer],width={2:4,4:8,7:2,9:1,6:1}[t?.type];
            if(!t||!shape||!types.includes(t.type)||!width||t.generated||t.is_variable||t.external_buffer||produced.has(id)||modelInputs.has(id)||!b||!t.buffer)throw Error(`參數 tensor #${id} 不是可讀取的靜態整數常數。`);
            if(cache.has(id))return cache.get(id);
            const count=shape.reduce((n,d)=>n*d,1),bytes=count*width;if(!Number.isSafeInteger(bytes)||bytes>65536||inspectedBytes+bytes>1024**2)throw Error('shape 參數超過單 tensor 64 KiB／本次 1 MiB 的讀取預算。');
            if(Number(b.size||b.data?.length||0)!==bytes)throw Error(`參數 tensor #${id} 的 buffer 長度與 dtype／shape 不符。`);
            const data=b.size?await readAt(Number(b.offset),bytes):b.data;if(!(data instanceof Uint8Array)||data.length!==bytes)throw Error('shape 參數讀取不完整。');if(b.size)readBytes+=bytes;inspectedBytes+=bytes;
            const view=new DataView(data.buffer,data.byteOffset,data.byteLength),getter={2:'getInt32',4:'getBigInt64',7:'getInt16',9:'getInt8',6:'getUint8'}[t.type],result=Array.from({length:count},(_,i)=>BigInt(view[getter](i*width,true)));if(cache.size<128)cache.set(id,result);return result;
        };
        for(const e of entries){
            if(++work>200000)throw Error('模型超過本次 200,000 個 OP 的推導掃描上限。');
            if(work%500===0){await new Promise(r=>setTimeout(r,0));if(cancelled())throw Error('已取消 shape 推導。');}
            const inputs=e.inputs.map(id=>id<0?null:tensors[id]),outputs=e.outputs.map(id=>tensors[id]);
            const inputChanged=e.inputs.some((id,i)=>id>=0&&!sameMetaShape(tensors[id],raw.tensors[e.source.inputs[i]])),parameterChanged=parameterOps.has(e.name)&&e.inputs.some((id,i)=>(e.name==='SPLIT'?i!==1:i>0)&&id!==e.source.inputs[i]);
            if(!inputChanged&&!parameterChanged&&!e.node?.builtin?.inferOutputs)continue;
            if(++affected>50000)throw Error('受影響 OP 超過 50,000 個，請縮小編輯範圍後分次處理。');
            try{
                if(e.custom)throw Error('custom OP 未提供 shape 規則，無法根據改變的輸入可靠推導。');
                let priorInference=null;
                if(!inputChanged&&!parameterChanged){priorInference=inferTfliteOutputs(e.name,inputs.map(t=>t?{...t,shape:dims(t)}:null),outputs.map(t=>({...t,shape:dims(t)})),e.options);if(priorInference.status!=='inferred')continue;}
                const slots=e.name==='RESHAPE'?e.inputs[1]>=0?[1]:[]:['TRANSPOSE','EXPAND_DIMS'].includes(e.name)?[1]:OPERAND_OPERATORS.has(e.name)?e.name==='SPLIT'?[0]:['SPLIT_V','SLICE'].includes(e.name)?[1,2]:e.name==='STRIDED_SLICE'?[1,2,3]:[1]:[],constants=new Map();
                for(const slot of slots)constants.set(slot,await values(e.inputs[slot],['RESHAPE','TRANSPOSE'].includes(e.name)?[2]:e.name==='EXPAND_DIMS'?[2,4]:[2,4,7,9,6]));
                const shapes=priorInference?.shapes||inferOperation(e.name,inputs,outputs,e.options,(slot,types)=>{if(!types.includes(inputs[slot]?.type)||!constants.has(slot))throw Error(`input ${slot} 的常數型別或內容不可用。`);return constants.get(slot);});if(shapes.length!==outputs.length)throw Error('推導的輸出數量不符。');
                shapes.forEach((shape,i)=>{
                    checkedShape(shape);const id=e.outputs[i],old=tensors[id];if(same(dims(old),shape))return;
                    const buffer=index.raw.buffers[old.buffer];if(old.is_variable||old.external_buffer||old.sparsity||old.buffer&&Number(buffer?.size||buffer?.data?.length||0))throw Error('不會變更權重、variable、外部資料或稀疏 tensor shape。');
                    if(old.quantization?.scale?.length>1&&shape[old.quantization.quantized_dimension]!==old.quantization.scale.length)throw Error('推導維度與既有 per-axis 量化 channel 數不相容。');
                    tensors[id]=shaped(old,shape);if(++changedTensors>100000)throw Error('受影響 tensor 超過 100,000 個，請分次編輯。');if(rows.length<100)rows.push({graph:plan.graph,node:e.node?.id||`op:${plan.graph}:${e.entry.template}`,type:e.name,tensor:id,before:Array.from(old.shape),after:[...shape]});
                });
                checkBuiltinPorts(e.entry.builtin?.code??Math.max(index.raw.operator_codes[e.source.opcode_index].builtin_code,index.raw.operator_codes[e.source.opcode_index].deprecated_builtin_code||0),inputs,e.outputs.map(id=>tensors[id]),e.options);
            }catch(error){throw Error(`Subgraph #${plan.graph} · ${e.node?.id||`OP #${e.entry.template}`} ${e.name} · inputs [${e.inputs.join(', ')}]：${error.message}`,{cause:error});}
        }
        const changedInterface=!state.composition&&plan.outputs.some((id,i)=>!sameMetaShape(tensors[id],raw.tensors[raw.outputs[i]]));
        if(changedInterface&&index.raw.subgraphs.some(g=>g.operators.some(op=>[op.builtin_options,op.builtin_options_2].some(o=>o&&Object.keys(o).some(k=>/subgraph/.test(k)&&(typeof o[k]==='number'?o[k]===plan.graph:Array.from(o[k]||[]).includes(plan.graph)))))))throw Error(`Subgraph #${plan.graph} 的輸出 shape 影響控制流程呼叫介面，需同步處理其他 subgraphs，未自動套用。`);
        for(let tensor=0;tensor<originalCount;tensor++)if(!sameMetaShape(tensors[tensor],raw.tensors[tensor])){if(dims(tensors[tensor]))shapePatches.push({graph:plan.graph,tensor,shape:dims(tensors[tensor])});}
        for(const [value,id]of ids){if(!Number.isInteger(id)||!tensors[id])continue;const v=state.values.get(value),shape=dims(tensors[id]);if(!shape)continue;const actual=JSON.parse(v.signature).shape;
            if(!same(actual,shape)){if(verifyLocal)throw Error(`草稿的 ${value} shape 與重新推導結果不符；請重新執行自動推導。`);localShapes.push({value,shape});}
        }
    }
    return {shapePatches,localShapes,summary:{operators:affected,tensors:changedTensors,changes:rows,truncated:changedTensors>rows.length,readBytes,inspectedBytes}};
}

export async function previewDeleteInference(index,snapshot,commands,nodeId,readAt,{source,cancelled}={}){
    if(index.exportUnsupportedReason)throw Error(index.exportUnsupportedReason);
    const state=replayEditDraft(snapshot,commands),node=state.nodes.find(n=>n.id===nodeId);if(!node||node.removed)throw Error('請選取尚未刪除的 OP。');
    const raw=index.raw.subgraphs[node.source.graph].operators[node.source.node],code=index.raw.operator_codes[raw.opcode_index],name=node.builtin?builtinSettings(node.builtin.code,node.builtin.settings).info.name:code.custom_code||schema.BuiltinOperator[Math.max(code.builtin_code,code.deprecated_builtin_code||0)];
    if(node.outputs.length!==1||code.custom_code&&!node.builtin||!unaryData.has(name))throw Error(`${name} 的資料輸入／輸出無法唯一決定，請使用指定來源重接；custom OP 需另外提供 shape 規則。`);
    const constant=v=>v?.generated||v?.kind==='權重／常數',swap=['ADD','MUL','MAXIMUM','MINIMUM','SQUARED_DIFFERENCE'].includes(name)&&constant(state.values.get(node.inputs[0]?.value))&&!constant(state.values.get(node.inputs[1]?.value));
    const value=source||node.inputs[swap?1:0]?.value,preview=editDeletePreview(state,node.id,{allowShape:true}),choice=preview.outputs[0].choice(value);if(!choice||choice.reason)throw Error(choice?.reason||'找不到可接回的資料輸入。');
    const command={kind:'delete-infer',node:node.id,algorithm:DELETE_INFERENCE_ALGORITHM,replacements:[{from:node.outputs[0].value,value}],localShapes:[]};
    const candidate=replayEditDraft(snapshot,[...commands,command]),inference=await inferDeletedGraph(index,candidate,readAt,{cancelled});command.localShapes=inference.localShapes;
    const choices=preview.outputs[0].choices.filter(c=>!c.reason).sort((a,b)=>Number(b.preferred)-Number(a.preferred)).slice(0,50);if(!choices.some(c=>c.value===value))choices.push(choice);
    return {status:'ready',command,source:{value,name:state.values.get(value).name,type:state.values.get(value).type},choices,summary:inference.summary};
}
