import {tflite as schema} from '../vendor/netron/tflite-schema.js';
// Metadata only: never serialize a model or read any weight/custom bytes.
export function tfliteExportPreview(index,graphId,nodes){
    const model=index?.raw,g=model?.subgraphs[graphId],selected=[...new Set(nodes||[])];
    if(!g||!selected.length||selected.some(n=>!Number.isInteger(n)||!g.operators[n]))throw Error('請先選取有效的 TFLite layers。');
    const operators=selected.map(n=>g.operators[n]),custom=[...new Set(operators.map(o=>model.operator_codes[o.opcode_index]).filter(c=>Math.max(c.builtin_code,c.deprecated_builtin_code||0)===schema.BuiltinOperator.CUSTOM).map(c=>c.custom_code||'Custom'))];
    const used=new Set(operators.flatMap(o=>[...o.inputs,...o.outputs,...o.intermediates||[]]).filter(n=>n>=0));
    for(const id of used){const q=g.tensors[id]?.quantization?.details;for(const key of ['scales','zero_points'])if(q?.[key]>=0)used.add(q[key]);}
    const direct=new Set([0,...Array.from(used,id=>g.tensors[id]?.buffer)]),retained=custom.length?model.buffers.map((_,id)=>id):[...direct];
    const bytes=id=>{const b=model.buffers[id];if(!b)throw Error('Buffer 不存在，無法估計匯出。');const n=Number(b.size||b.sourceRange?.size||b.data?.length||0);if(!Number.isSafeInteger(n)||n<0)throw Error('Buffer 大小無效。');return n;};
    const sum=ids=>{const n=Array.from(ids,id=>bytes(id)).reduce((a,b)=>a+b,0);if(!Number.isSafeInteger(n))throw Error('匯出大小超出可表示範圍。');return n;};
    const retainedBytes=sum(retained),referencedBytes=sum(direct);
    return {layers:selected.length,retainedBuffers:retained.length,retainedBytes,referencedBytes,opaqueRetainedBytes:Math.max(0,retainedBytes-referencedBytes),customOperators:custom,preservedIds:!!custom.length,scope:'依 metadata 計算保留的 buffer 資料量；最終檔案另含結構、metadata 與 custom options。Opaque 引用不明時保留全部原始 buffers／編號，不猜測刪除。'};
}
export function exportPreviewText(p){
    const amount=n=>`${n.toLocaleString('en-US')} bytes（${(n/1024**2).toFixed(2)} MiB）`;
    return `${p.layers} 個 OP；保留 ${p.retainedBuffers} 個 buffers，資料量 ${amount(p.retainedBytes)}。${p.preservedIds?`\n含 custom op：${p.customOperators.join('、')}。除明確 tensor 引用外，另保留 ${amount(p.opaqueRetainedBytes)} 的不明引用資料；小片段仍可能接近原模型大小。`:''}\n${p.scope}`;
}
