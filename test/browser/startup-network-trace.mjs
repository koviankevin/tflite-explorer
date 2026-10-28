// CI startup evidence only. Keep status/content type, not credential headers,
// bodies, query strings or user files. Stop before selecting any model.
export function startupNetworkTrace(base,{now=()=>performance.now(),requestLimit=128,consoleLimit=32}={}){
    const root=new URL(base),rows=[],messages=[],entries=new WeakMap(),started=now();let stoppedAt=null,truncated=false;
    if(!['http:','https:'].includes(root.protocol)||root.search||root.hash||root.username||root.password||!root.pathname.endsWith('/')||!Number.isInteger(requestLimit)||requestLimit<1||requestLimit>128||!Number.isInteger(consoleLimit)||consoleLimit<1||consoleLimit>32)throw Error('Invalid bounded startup trace.');
    const elapsed=()=>Math.round((now()-started)*1000)/1000;
    const safeText=value=>String(value).replace(/(?:https?|file|blob|data):[^\s<>"']+/g,raw=>{try{const url=new URL(raw);return url.origin===root.origin&&url.pathname.startsWith(root.pathname)?url.origin+url.pathname:'[external URL]';}catch{return '[URL]';}}).slice(0,512);
    function request(r){
        if(entries.has(r))return entries.get(r);if(stoppedAt!==null)return;
        let url;try{url=new URL(r.url());}catch{return;}
        const type=r.resourceType();
        if(r.method()!=='GET'||url.origin!==root.origin||!url.pathname.startsWith(root.pathname)||!['document','script','stylesheet','image'].includes(type))return;
        const path=url.pathname.slice(root.pathname.length);if(path.length>512)return;
        if(rows.length===requestLimit){truncated=true;return;}
        const row={path,resourceType:type,startedMs:elapsed(),status:null,contentType:null,held:false,state:'pending'};rows.push(row);entries.set(r,row);return row;
    }
    return {
        request,
        hold(r){const row=request(r);if(row)row.held=true;},
        response(r){const row=entries.get(r.request());if(row){row.status=r.status();row.contentType=String(r.headers()['content-type']||'').slice(0,128);row.responseMs=elapsed();}},
        finished(r){const row=entries.get(r);if(row){row.state='finished';row.finishedMs=elapsed();}},
        failed(r){const row=entries.get(r);if(row){row.state='failed';row.failure=safeText(r.failure()?.errorText||'unknown');row.finishedMs=elapsed();}},
        console(message){if(stoppedAt!==null||message.type()!=='error')return;if(messages.length===consoleLimit){truncated=true;return;}messages.push({elapsedMs:elapsed(),message:safeText(message.text())});},
        stop(){stoppedAt??=elapsed();},
        snapshot(){return {format:'model-lens-startup-network',version:1,requestLimit,consoleLimit,truncated,stoppedAtMs:stoppedAt,observedAtMs:elapsed(),requests:rows.map(r=>({...r})),consoleErrors:messages.map(r=>({...r}))};}
    };
}
