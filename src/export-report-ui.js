const modes={'tflite-subgraph':'TFLite 子圖','ssa-slice':'局部 SSA','cfg-slice':'局部控制流程',function:'完整 function'};
export function exportReportUI({exportFile}) {
    const button=document.getElementById('export-report-button'),dialog=document.getElementById('export-report-dialog'),fields=document.getElementById('export-report-fields'),checks=document.getElementById('export-report-checks'),download=document.getElementById('download-export-report');
    let current=null;
    // Modal keys must not reach graph shortcuts (Escape ends graph selection).
    dialog.addEventListener('keydown',event=>event.stopPropagation());
    button.onclick=()=>{if(current)dialog.showModal();};
    document.getElementById('close-export-report').onclick=()=>dialog.close();
    download.onclick=()=>{if(current)exportFile(current.name+'.report.json',current.blob);};
    return {
        clear(){current=null;button.hidden=true;download.disabled=true;dialog.close();fields.replaceChildren();checks.replaceChildren();},
        set(report,name,error){
            current=report?{blob:report.blob,name}:null;
            button.hidden=false;download.disabled=!report;
            if(!report){fields.textContent=error || '本次未能產生報告。';checks.replaceChildren();button.onclick=()=>dialog.showModal();return;}
            button.onclick=()=>dialog.showModal();
            const s=report.summary,rows=[['來源',`${s.source.name}（${s.source.bytes.toLocaleString()} bytes）`],['匯出',`${name}（${s.output.bytes.toLocaleString()} bytes）`],['範圍',`${modes[s.mode] || s.mode} · 選取 ${s.selected} 個 OP`],['來源對照',`${s.mapped} 個保留 OP、${s.generated} 個新增控制／輸出 OP（module／function 包裝另計）`],['輸入／輸出',`${s.inputs} 個輸入、${s.outputs} 個資料輸出`],['原始資料範圍',`${s.preservation.byteRanges} 段、${s.preservation.bytes.toLocaleString()} bytes（尚未比對下載檔）`]];
            fields.replaceChildren();for(const [label,value] of rows){const dt=document.createElement('dt'),dd=document.createElement('dd');dt.textContent=label;dd.textContent=value;fields.append(dt,dd);}
            checks.replaceChildren();for(const check of s.checks){const li=document.createElement('li');li.textContent=`${check.status==='passed'?'已完成':'未驗證'} · ${check.detail}`;checks.append(li);}
        }
    };
}
