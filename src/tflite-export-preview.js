import {planTfliteReferences,referencePlanSummary} from './tflite-reference-plan.js';
// Never serialize a model or read source weights/options; inspect only metadata
// and the bounded inline options already loaded by the parser.
export function tfliteExportPreview(index,graphId,nodes,options={}){
    const model=index?.raw,g=model?.subgraphs[graphId],selected=[...new Set(nodes||[])];
    if(!g||!selected.length||selected.some(n=>!Number.isInteger(n)||!g.operators[n]))throw Error('請先選取有效的 TFLite layers。');
    const plan=planTfliteReferences(model,graphId,selected,options),operators=selected.map(n=>g.operators[n]),custom=plan.customOperators;
    const used=new Set(operators.flatMap(o=>[...o.inputs,...o.outputs,...o.intermediates||[]]).filter(n=>n>=0));
    for(const id of used){const q=g.tensors[id]?.quantization?.details;for(const key of ['scales','zero_points'])if(q?.[key]>=0)used.add(q[key]);}
    const direct=new Set([0,...Array.from(used,id=>g.tensors[id]?.buffer)]),retained=plan.bufferDataIds;
    const bytes=id=>{const b=model.buffers[id];if(!b)throw Error('Buffer 不存在，無法估計匯出。');const n=Number(b.size||b.sourceRange?.size||b.data?.length||0);if(!Number.isSafeInteger(n)||n<0)throw Error('Buffer 大小無效。');return n;};
    const sum=ids=>{const n=Array.from(ids,id=>bytes(id)).reduce((a,b)=>a+b,0);if(!Number.isSafeInteger(n))throw Error('匯出大小超出可表示範圍。');return n;};
    const retainedBytes=sum(retained),referencedBytes=sum(direct);
    return {layers:selected.length,retainedBuffers:plan.preservedIds?model.buffers.length:retained.length,retainedDataBuffers:retained.filter(id=>bytes(id)>0).length,retainedBytes,referencedBytes,opaqueRetainedBytes:plan.mode==='custom-opaque'?Math.max(0,retainedBytes-referencedBytes):0,contractRetainedBytes:plan.mode==='custom-contract'?Math.max(0,retainedBytes-referencedBytes):0,customOperators:custom,preservedIds:plan.preservedIds,referenceMode:plan.mode,referencePlan:referencePlanSummary(plan),scope:'依 metadata 與已載入的小型 custom options 計算保留資料，不讀取權重或外部 options；最終檔案另含結構、metadata 與 custom options。未知引用完整保留；已註冊契約只清除未引用資料，原始編號保持。'};
}
export function exportPreviewText(p){
    const amount=n=>`${n.toLocaleString('en-US')} bytes（${(n/1024**2).toFixed(2)} MiB）`;
    return `${p.layers} 個 OP；保留 ${p.retainedBuffers} 個 buffers，資料量 ${amount(p.retainedBytes)}。${p.preservedIds?p.referenceMode==='custom-contract'?`\n含 custom op：${p.customOperators.join('、')}。引用契約符合；保留 ${p.retainedDataBuffers} 個含資料 buffers，清除 ${p.referencePlan.elidedBufferCount} 個未引用 payload，tensor／buffer 編號不變。`:`\n含 custom op：${p.customOperators.join('、')}。除明確 tensor 引用外，另保留 ${amount(p.opaqueRetainedBytes)} 的不明引用資料；小片段仍可能接近原模型大小。`:''}\n${p.scope}`;
}
