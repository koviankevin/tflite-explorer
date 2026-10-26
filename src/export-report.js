export const EXPORT_REPORT_LIMIT=16*1024*1024;

// A record of the exporter's work, not an authenticity certificate or proof of
// runtime equivalence. Creating this report never reads model/weight bytes.
export function createExportReport(index,file,result,{graph,nodes,selections,outputName,buildId=null}={}) {
    const format=index.mlir?'mlir':'tflite',provenance=result.provenance;
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
        {id:'export-boundaries',status:'passed',detail:'已依來源定義建立匯出邊界及必要依賴。'},
        ...(format==='mlir'?[{id:'mlir-structure',status:result.validation?.passed?'passed':'not-run',detail:result.validation?.scope || '未取得結構檢查結果。'}]:[]),
        {id:'payload-byte-comparison',status:'not-run',detail:'此報告記錄來源／輸出 byte ranges；尚未重新讀取下載檔逐段比對。可用本機 verify-export.mjs 比對。'},
        ...(format==='mlir'?[{id:'native-compiler',status:'not-run',detail:'尚未使用 LLVM／公司 compiler 驗證下載檔。'}]:[{id:'runtime-load',status:'not-run',detail:'尚未使用 TFLite／公司 runtime 載入下載檔。'}]),
        {id:'runtime-equivalence',status:'not-run',detail:'尚未執行推論、數值比對或 custom dialect／custom runtime 語意驗證。'}
    ];
    if(format==='mlir')checks.push({id:'dense-values',status:'not-run',detail:'未逐值驗證所有 dense／resource 權重的數值語法、元素數量或有效性。'});
    const report={schemaVersion:1,format:'model-lens-export-report',createdAt:new Date().toISOString(),producer:{name:'Model Lens',buildId},
        source:{name:file.name || 'model',bytes:file.size,format,lastModified:file.lastModified || null,identity:'filename-and-size-only'},
        output:{name:outputName,bytes:result.blob.size,format,layers:result.layers,tensors:result.tensors ?? null},
        selection:[...picked.values()],provenance,
        interface:{inputs:result.inputs,outputs:result.outputs,conditionalOutputs:result.slice?.conditionalOutputs || 0,exitTag:!!result.slice?.exitTag},
        preservation:{method:'original-file-slices-and-original-parameters',byteRanges:provenance.ranges.length,bytes:provenance.ranges.reduce((n,r)=>n+r.bytes,0),retainedBuffers:result.retainedBuffers ?? null,preservedTensorBufferIds:!!result.preservedIds,customOperators:result.customOperators || []},
        checks,limitations:['檔名與大小不是來源檔案的身分驗證；本報告未計算完整來源 SHA-256。','本報告含模型名稱、OP 名稱及型別／介面資訊；全程在本機產生，分享前請自行確認內容。','補入邊界輸入後需提供對應數值；結構有效不代表子模型與原模型可直接替換。']};
    const blob=new Blob([JSON.stringify(report,null,2)+'\n'],{type:'application/json'});
    if(blob.size>EXPORT_REPORT_LIMIT)throw new Error('完整匯出報告超過 16 MiB；模型仍可下載，但本次無法提供報告。');
    return {blob,summary:{source:report.source,output:report.output,selected:report.selection.length,mode:provenance.mode,mapped:provenance.operators.length,generated:provenance.generated?.length || 0,inputs:result.inputs.length,outputs:result.outputs.length,preservation:report.preservation,checks}};
}
