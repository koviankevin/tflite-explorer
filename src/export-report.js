export const EXPORT_REPORT_LIMIT=16*1024*1024;

// A record of the exporter's work, not an authenticity certificate or proof of
// runtime equivalence. Creating this report never reads model/weight bytes.
export function createExportReport(index,file,result,{graph,nodes,selections,outputName,buildId=null}={}) {
    const format=index.mlir?'mlir':'tflite',provenance=result.provenance;
    const edited=provenance?.mode==='model-edit';
    if(!provenance || !Array.isArray(provenance.ranges))throw new Error('匯出器未提供來源對照，無法產生完整報告。');
    if(provenance.error)throw new Error(provenance.error);
    if(provenance.ranges.length>100000)throw new Error('原始資料範圍超過 100,000 段；模型仍可下載，但本次無法提供完整報告。');
    const picked=new Map();
    for(const s of selections || [{graph,nodes}])for(const node of s.nodes || []) {
        const op=index.graphs[s.graph]?.graph.nodes[node];
        if(!op)throw new Error('報告的選取來源無效。');
        picked.set(`${s.graph}:${node}`,{graph:s.graph,node,name:op.name || '',type:op.type?.identifier || op.type?.name || ''});
    }
    for(const r of provenance.ranges)if(!Number.isSafeInteger(r.sourceOffset) || !Number.isSafeInteger(r.outputOffset) || !Number.isSafeInteger(r.bytes) || r.sourceOffset<0 || r.outputOffset<0 || r.bytes<=0 || r.sourceOffset>file.size-r.bytes || r.outputOffset>result.blob.size-r.bytes)throw new Error('報告的權重／options 對照超出檔案範圍。');
    const checks=[
        {id:'export-boundaries',status:'passed',detail:edited?'已依明確指定的 OP／接線修改建立整份模型；保留其他 scopes／subgraphs。':'已依來源定義建立匯出邊界及必要依賴。'},
        ...(edited?[{id:'serialized-roundtrip',status:result.roundTrip?'passed':'not-run',detail:result.roundTrip?'已重新解析實際輸出 bytes，並重跑候選結構檢查。':'尚未重新解析實際輸出 bytes。'}]:[]),
        ...(format==='mlir'?[{id:'mlir-structure',status:result.validation?.passed?'passed':'not-run',detail:result.validation?.scope || '未取得結構檢查結果。'}]:[]),
        ...(edited&&format==='tflite'?[{id:'tflite-structure',status:result.validation?.passed?'passed':'not-run',detail:result.validation?.scope||'未取得結構檢查結果。'}]:[]),
        {id:'payload-byte-comparison',status:'not-run',detail:'此報告記錄來源／輸出 byte ranges；尚未重新讀取下載檔逐段比對。可用本機 verify-export.mjs 比對。'},
        ...(format==='mlir'?[{id:'native-compiler',status:'not-run',detail:'尚未使用 LLVM／公司 compiler 驗證下載檔。'}]:[{id:'runtime-load',status:'not-run',detail:'尚未使用 TFLite／公司 runtime 載入下載檔。'}]),
        {id:'runtime-equivalence',status:'not-run',detail:'尚未執行推論、數值比對或 custom dialect／custom runtime 語意驗證。'}
    ];
    if(format==='mlir')checks.push({id:'dense-values',status:'not-run',detail:'已核對支援格式的延後 dense 元素數／hex bytes；不包含全部數值、resource packing 或 dialect 語意驗證。'});
    const operatorValidation=result.semanticValidation?.flatMap(c=>c.operators||[])||[];
    const quantization=result.quantizationValidation,quantizationValidation=quantization?.tensors||[];
    const quantizationSummary=quantization?Object.fromEntries(Object.entries(quantization).filter(([key])=>key!=='tensors')):null;
    if(quantization?.total){
        const issue=quantizationValidation.find(c=>c.status==='failed')||quantizationValidation.find(c=>c.status!=='passed');
        checks.push({id:'quantization-metadata',status:quantization.failed?'failed':quantization.unchecked?'not-run':'passed',detail:`量化欄位：${quantization.checked} 個已檢查、${quantization.failed} 個失敗、${quantization.unchecked} 個未驗證。${issue?`首項需確認：Subgraph #${issue.graph} · tensor #${issue.tensor}：${issue.reason}`:'此項不代表 kernel 或數值等價已驗證。'}${quantization.omitted?`另省略 ${quantization.omitted} 筆，均列未驗證。`:''}`});
    }
    if(result.semanticValidation)for(const c of result.semanticValidation)checks.push({id:'constant-operands',status:c.unchecked||!c.checked?'not-run':'passed',detail:`Subgraph #${c.graph??'?'} 常數 operands：${c.checked} 個已檢查、${c.unchecked} 個未能檢查；讀取 ${c.bytesRead} bytes。${c.scope}`});
    const operatorSummary={total:operatorValidation.length,checked:operatorValidation.filter(c=>c.status==='passed').length,unchecked:operatorValidation.filter(c=>c.status!=='passed').length,scope:'只列本次修改／組合的 subgraphs；其他 subgraphs 未重新做常數語意檢查。已檢查只代表列出的靜態規則，不代表可執行或數值等價。'};
    if(operatorValidation.length)checks.push({id:'operator-coverage',status:operatorSummary.unchecked?'not-run':'passed',detail:`逐 OP 靜態規則：${operatorSummary.checked} 個已檢查、${operatorSummary.unchecked} 個未檢查。${operatorSummary.scope}`});
    if(result.referencePlan&&result.referencePlan.mode!=='builtin-compact')checks.push({id:'custom-references',status:result.referencePlan.mode==='custom-contract'?'passed':'not-run',detail:result.referencePlan.mode==='custom-contract'?`依受信任引用契約保留資料，清除 ${result.referencePlan.elidedBufferCount} 個未引用 payload；原始 tensor／buffer 編號與 options 保留。此項只檢查引用，未驗證 custom kernel 或數值語意。`:`引用不明，完整保留原始資料。${result.referencePlan.reasons.join(' ')}`});
    const report={schemaVersion:1,format:'model-lens-export-report',createdAt:new Date().toISOString(),producer:{name:'Model Lens',buildId},
        source:{name:file.name || 'model',bytes:file.size,format,lastModified:file.lastModified || null,identity:'filename-and-size-only'},
        output:{name:outputName,bytes:result.blob.size,format,layers:result.layers,tensors:result.tensors ?? null},
        selection:[...picked.values()],provenance,...(quantization?{quantizationValidation,quantizationSummary}:{}),
        interface:{inputs:result.inputs,outputs:result.outputs,conditionalOutputs:result.slice?.conditionalOutputs || 0,exitTag:!!result.slice?.exitTag},
        ...(edited?{modification:result.modification}:{}),operatorValidation,operatorSummary,
        preservation:{method:edited?'original-file-slices-and-explicit-model-edits':'original-file-slices-and-original-parameters',byteRanges:provenance.ranges.length,bytes:provenance.ranges.reduce((n,r)=>n+r.bytes,0),retainedBuffers:result.retainedBuffers ?? null,preservedTensorBufferIds:!!result.preservedIds,customOperators:result.customOperators || [],...(result.referencePlan?{referencePlan:result.referencePlan}:{})},
        checks,limitations:['檔名與大小不是來源檔案的身分驗證；本報告未計算完整來源 SHA-256。','本報告含模型名稱、OP 名稱及型別／介面資訊；全程在本機產生，分享前請自行確認內容。',edited?'此模型已依指定修改，尚未驗證是否符合新需求的推論結果；不宣稱與來源模型等價。':'補入邊界輸入後需提供對應數值；結構有效不代表子模型與原模型可直接替換。']};
    // Keep an immutable JSON prefix so a later runtime-status attachment can
    // compose a new report without reading this potentially multi-MiB Blob in
    // the main realm. The prefix has no checks/runtime verdict to accumulate.
    const {checks:reportChecks,...body}=report;
    const runtimePrefix=new Blob([JSON.stringify(body,null,2).slice(0,-1)]);
    const blob=new Blob([runtimePrefix,',\n  "checks": ',JSON.stringify(reportChecks,null,2),'\n}\n'],{type:'application/json'});
    if(blob.size>EXPORT_REPORT_LIMIT)throw new Error('完整匯出報告超過 16 MiB；模型仍可下載，但本次無法提供報告。');
    return {blob,runtimePrefix,summary:{source:report.source,output:report.output,selected:report.selection.length,mode:provenance.mode,mapped:provenance.operators.length,generated:provenance.generated?.length || 0,inputs:result.inputs.length,outputs:result.outputs.length,preservation:report.preservation,checks,operatorValidation,operatorSummary,...(quantization?{quantizationValidation,quantizationSummary}:{}),...(edited?{modification:report.modification}:{})}};
}
