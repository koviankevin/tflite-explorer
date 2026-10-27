import {createDiagnosticReport} from './diagnostics.js';

export function diagnosticUI({journal,context,exportFile}) {
    const $=id=>document.getElementById(id),dialog=$('diagnostic-dialog'),preview=$('diagnostic-preview'),download=$('download-diagnostics');
    let text='',release=null,generation=0,active;
    const render=()=>{
        const result=createDiagnosticReport({journal,context:context(),release,loadedBuild:new URL(import.meta.url).searchParams.get('v'),userAgent:navigator.userAgent});
        text=result.text;preview.textContent=text;download.disabled=false;
        $('diagnostic-summary').textContent=`${result.report.operations.events.length} 筆操作紀錄 · 較早 ${result.report.operations.discarded} 筆已淘汰 · ${new TextEncoder().encode(text).length.toLocaleString()} bytes`;
    };
    $('open-diagnostics').onclick=async()=>{
        $('release-dialog').close();const current=++generation;
        text='';release=null;download.disabled=true;preview.textContent='讀取程式版本並建立本機診斷報告…';dialog.showModal();
        const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),5000);active=controller;let data=null;
        try {
            const url=new URL('../release.json',import.meta.url);url.search=new URL(import.meta.url).search;
            const response=await fetch(url,{cache:'no-store',signal:controller.signal});
            if(response.ok)data=await response.json();
        }catch{/* The report remains usable when version metadata is unavailable. */}
        finally{clearTimeout(timer);}
        if(current!==generation || !dialog.open)return;
        release=data;
        try{render();}catch{preview.textContent='無法建立診斷報告；請先清除本次操作紀錄後重試。';}
    };
    download.onclick=async()=>{
        if(!text)return;const current=generation;download.disabled=true;
        try{await exportFile('model-lens-diagnostics.json',new Blob([text],{type:'application/json'}));if(current===generation)$('diagnostic-summary').textContent='已啟動下載這份預覽的 JSON。';}
        catch{if(current===generation)$('diagnostic-summary').textContent='無法啟動下載；可選取下方 JSON 另存。';}
        finally{if(current===generation)download.disabled=false;}
    };
    $('refresh-diagnostics').onclick=()=>{try{render();}catch{preview.textContent='無法建立診斷報告。';download.disabled=true;}};
    $('clear-diagnostics').onclick=()=>{journal.clear();$('refresh-diagnostics').onclick();};
    $('close-diagnostics').onclick=()=>dialog.close();
    dialog.addEventListener('close',()=>{generation++;active?.abort();text='';preview.textContent='';download.disabled=true;$('release-info-button').focus();});
    dialog.addEventListener('keydown',event=>event.stopPropagation());
}
