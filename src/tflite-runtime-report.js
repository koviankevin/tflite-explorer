import {EXPORT_REPORT_LIMIT} from './export-report.js';
import {runtimeSummary} from './tflite-runtime-policy.js';
export async function attachRuntimeReport(report,result){
    if(!report)return report;
    if(report.blob.size>EXPORT_REPORT_LIMIT)throw Error('修改報告超過大小上限。');
    const document=JSON.parse(await report.blob.text());
    const checks=document.checks.filter(c=>!['runtime-load','runtime-smoke'].includes(c.id));
    if(result.invoked){const equivalence=checks.find(c=>c.id==='runtime-equivalence');if(equivalence)equivalence.detail='已用一組指定輸入執行；尚未比對精度、預期答案、全部分支或與來源模型的數值等價性。';}
    checks.push({id:'runtime-load',status:result.compiled?'passed':result.status==='failed'?'failed':'not-run',detail:result.compiled?'LiteRT CPU 已載入／編譯本次候選；配置與執行結果請看執行檢查。':runtimeSummary(result)},
        {id:'runtime-smoke',status:result.status==='passed'?'passed':result.status==='failed'?'failed':'not-run',detail:runtimeSummary(result)+' '+(result.scope||'')});
    const blob=new Blob([JSON.stringify({...document,checks,runtimeValidation:result},null,2)+'\n'],{type:'application/json'});
    if(blob.size>EXPORT_REPORT_LIMIT)throw Error('執行檢查後的修改報告超過大小上限。');
    return {...report,blob,summary:{...report.summary,checks}};
}
