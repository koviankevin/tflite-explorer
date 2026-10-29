import {FlatbufferWriter} from './flatbuffer-writer.js';
import {tfliteWorkspacePlans} from './tflite-workspace-plan.js';
import {prepareTfliteModelEdit,validateTfliteModelGraph} from './tflite-model-edit.js';
import {compositionInterface,compositionOrder} from './model-composition-draft.js';
export function exportComposition(index,file,state,changes){
    const iface=compositionInterface(state),ordered=compositionOrder(state);
    if(iface.missing.length)throw Error('組合模型仍需輸入：'+iface.missing.map(id=>state.values.get(id).name).join('、')+'。請保留輸入或改接來源。');
    if(!ordered.length||!iface.outputs.length)throw Error('組合模型需要至少一個 OP 和一個輸出。');
    const plans=tfliteWorkspacePlans(index,state,changes);if(plans.length!==1)throw Error('組合模型需來自同一個 subgraph。');
    const prepared=prepareTfliteModelEdit(index,file,plans),sourceGraph=plans[0].graph,graph=prepared.model.subgraphs[sourceGraph],custom=graph.operators.some(op=>!!prepared.model.operator_codes[op.opcode_index].custom_code),used=new Set([...graph.inputs,...graph.outputs]);
    for(const op of graph.operators)for(const id of [...op.inputs,...op.outputs,...op.intermediates||[]])if(id>=0)used.add(id);
    for(const id of used){const t=graph.tensors[id];if(!t||t.external_buffer||t.is_variable||[13,14].includes(t.type))throw Error('組合模型不支援 variable、resource、variant 或外部檔案 tensor。');const q=t.quantization?.details;for(const key of ['scales','zero_points'])if(q?.[key]>=0)used.add(q[key]);}
    const tensorIds=custom?graph.tensors.map((_,id)=>id):[...used].sort((a,b)=>a-b),tensorMap=new Map(tensorIds.map((id,i)=>[id,i])),mapId=id=>id<0?id:tensorMap.get(id);
    const bufferIds=custom?prepared.model.buffers.map((_,id)=>id):[...new Set([0,...tensorIds.filter(id=>!graph.inputs.includes(id)).map(id=>graph.tensors[id].buffer)])],bufferMap=new Map(bufferIds.map((id,i)=>[id,i]));
    const tensors=tensorIds.map(id=>{const t=graph.tensors[id];if(t.external_buffer)throw Error('組合來源含外部檔案 tensor，無法封裝。');const result={...t,buffer:graph.inputs.includes(id)?0:bufferMap.get(t.buffer)},q=t.quantization?.details;if(q&&'scales' in q)result.quantization={...t.quantization,details:Object.assign(new q.constructor(),q,{scales:mapId(q.scales),zero_points:mapId(q.zero_points)})};return result;});
    const compact={...graph,name:'composed',tensors,inputs:Int32Array.from(graph.inputs,mapId),outputs:Int32Array.from(graph.outputs,mapId),operators:graph.operators.map(op=>({...op,inputs:Int32Array.from(op.inputs,mapId),outputs:Int32Array.from(op.outputs,mapId),intermediates:Int32Array.from(op.intermediates||[],mapId)}))};
    const model={...prepared.model,description:'Model Lens composed model; selected fragments and explicit interface. '+(custom?'Opaque custom options and original tensor/buffer IDs retained; custom runtime required.':''),subgraphs:[compact],buffers:bufferIds.map(id=>prepared.model.buffers[id]),signature_defs:[],metadata:custom?prepared.model.metadata.filter(m=>m.name!=='TFLITE_METADATA'):[],metadata_buffer:custom?prepared.model.metadata_buffer:new Int32Array(),external_buffers:[],external_buffer_groups:[]};
    validateTfliteModelGraph(model,0);
    const mapping=ordered.map((n,node)=>({source:{...n.source},output:{graph:0,node},role:n.fresh?'cloned':'imported'}));
    return {...new FlatbufferWriter().finishArtifact(model,file),format:'tflite',changes:[{graph:0,before:index.raw.subgraphs[sourceGraph].operators.length,after:compact.operators.length,newTensors:tensors.length}],workspaceChanges:changes,workspaceScope:ordered.map(n=>n.id),metadataChanges:[...prepared.metadataChanges,'組合結果為獨立模型，重建輸入／輸出並移除舊 signatures 與 TFLITE_METADATA。'],composition:{sourceGraph,mapping,preservedIds:custom},preservedIds:custom,validation:{passed:true,scope:'組合模型接線、執行順序、介面、索引及已支援的 shape 規則；custom kernel 與數值等價需另外驗證'},verification:'structure-only'};
}
