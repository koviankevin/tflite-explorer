export const DIAGNOSTIC_EVENT_LIMIT=64;
export const DIAGNOSTIC_BYTE_LIMIT=64*1024;
const operations=new Set(['open','workspaceIdentity','exportTflite','exportMLIR','search','pattern','subgraphPattern','capturePattern','page','patternOverview','overviewNode','select','graph','ui','layout','worker','global','pattern-save','pattern-import','pattern-read','workspace-save']);
const outcomes=new Set(['started','success','error','cancelled']);
const errors=new Set(['Error','TypeError','RangeError','SyntaxError','AbortError','QuotaExceededError','SecurityError','VersionError','NotReadableError','DataCloneError','InvalidStateError','DraftConflict']);
const operation=value=>operations.has(value)?value:'other';
const errorKind=error=>{try{const name=error?.name;return errors.has(name)?name:'UnknownError';}catch{return 'UnknownError';}};
const number=(value,max=Number.MAX_SAFE_INTEGER)=>typeof value==='number' && Number.isFinite(value) && value>=0?Math.min(value,max):null;
const elapsed=value=>Math.round((number(value,7*24*3600*1000) || 0)/10)*10;
const choose=(value,values,fallback='unknown')=>values.includes(value)?value:fallback;
export function diagnosticCount(value) {
    const n=number(value);if(n===null)return 'unknown';
    return n===0?'0':n<=32?'1-32':n<=500?'33-500':n<=1500?'501-1500':n<=20000?'1501-20000':'>20000';
}
export function diagnosticSize(value) {
    const n=number(value);if(n===null)return 'unknown';
    return n<2**20?'<1MiB':n<64*2**20?'1-64MiB':n<1024*2**20?'64MiB-1GiB':n<2*2**30?'1-2GiB':n<4*2**30?'2-4GiB':'>=4GiB';
}
export function diagnosticRuntime(userAgent='') {
    // Raw UA, OS version, locale, URL and device identifiers never leave here.
    if(typeof userAgent!=='string')return {browser:'unknown',major:null,os:'unknown'};
    const matches=[['Edge',/(?:Edg|EdgA|EdgiOS)\/(\d+)/],['Firefox',/(?:Firefox|FxiOS)\/(\d+)/],['Chrome',/(?:Chrome|CriOS)\/(\d+)/],['Safari',/Version\/(\d+).*Safari/]];
    const found=matches.map(([name,regex])=>[name,userAgent.match(regex)]).find(([,match])=>match);
    const os=/Android/.test(userAgent)?'Android':/iPhone|iPad|iPod/.test(userAgent)?'iOS':/Windows/.test(userAgent)?'Windows':/Macintosh|Mac OS/.test(userAgent)?'macOS':/Linux/.test(userAgent)?'Linux':'unknown';
    return {browser:found?.[0] || 'unknown',major:found?Math.min(Number(found[1][1]),9999):null,os};
}
export function diagnosticJournal({now=()=>performance.now()}={}) {
    let start=now(),sequence=0,epoch=0,events=[],discarded=0;
    const append=event=>{events.push(event);if(events.length>DIAGNOSTIC_EVENT_LIMIT){events.shift();discarded++;}};
    const begin=action=>{
        const at=now(),currentEpoch=epoch,id=++sequence,kind=operation(action);let done=false;
        append({id,operation:kind,outcome:'started',atMs:elapsed(at-start)});
        return (outcome='success',error)=>{
            if(done || currentEpoch!==epoch)return;done=true;
            const status=choose(outcome,[...outcomes],'error');
            append({id,operation:kind,outcome:status,atMs:elapsed(now()-start),durationMs:elapsed(now()-at),...(status==='error'?{errorKind:errorKind(error)}:{})});
        };
    };
    return {
        begin,
        record(action,outcome,error){begin(action)(outcome,error);},
        async track(action,task){const finish=begin(action);try{const result=await task();finish('success');return result;}catch(error){finish(errorKind(error)==='AbortError'?'cancelled':'error',error);throw error;}},
        snapshot(){return {events:events.map(e=>({...e})),discarded};},
        clear(){epoch++;sequence=0;events=[];discarded=0;start=now();}
    };
}
const hash=(value,length)=>typeof value==='string' && new RegExp(`^[a-f0-9]{${length}}$`).test(value)?value:null;
export function createDiagnosticReport({journal,context={},release=null,loadedBuild=null,userAgent='',createdAt=new Date().toISOString()}={}) {
    const snapshot=journal.snapshot(),autosave=context.autosave || {},releaseBuild=hash(release?.buildId,16),activeBuild=hash(loadedBuild,16);
    const version=typeof release?.version==='string' && /^\d+\.\d+\.\d+(?:-(?:alpha|beta|rc|preview|dev)(?:\.\d+)*)?$/i.test(release.version) && release.version.length<=48?release.version:null;
    const report={format:'model-lens-diagnostics',version:1,createdAt:typeof createdAt==='string' && /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(createdAt)?createdAt:null,
        application:{version,loadedBuild:activeBuild,publishedBuild:releaseBuild,releaseStatus:!releaseBuild?'unavailable':activeBuild===releaseBuild?'matched':'mismatch',distribution:choose(release?.distribution,['public','internal']),sourceCommit:hash(release?.source?.commit,40),dirty:typeof release?.source?.dirty==='boolean'?release.source.dirty:null},
        runtime:diagnosticRuntime(userAgent),
        context:{modelLoaded:!!context.modelLoaded,format:choose(context.format,['tflite','mlir','none'],'none'),fileSize:diagnosticSize(context.fileBytes),layers:diagnosticCount(context.layers),scopes:diagnosticCount(context.scopes),selected:diagnosticCount(context.selected),renderer:choose(context.renderer,['svg','canvas','none'],'none'),view:choose(context.view,['local','full','overview']),fontPx:choose(context.fontPx,[14,16,18,20,24,28,32],null),layoutBusy:!!context.layoutBusy,exportBusy:!!context.exportBusy,modelWorkerPresent:!!context.modelWorkerPresent,pendingRequests:diagnosticCount(context.pendingRequests),readSize:diagnosticSize(context.bytesRead),parseMs:number(context.parseMs)===null?null:elapsed(context.parseMs),
            autosave:Object.fromEntries(['enabled','attached','pending','conflict','saving','busy','storageFailed'].map(key=>[key,typeof autosave[key]==='boolean'?autosave[key]:null]))},
        operations:{limit:DIAGNOSTIC_EVENT_LIMIT,discarded:number(snapshot.discarded) || 0,events:snapshot.events.slice(-DIAGNOSTIC_EVENT_LIMIT).map(e=>{const outcome=choose(e.outcome,[...outcomes],'error');return {id:Math.floor(number(e.id) || 0),operation:operation(e.operation),outcome,atMs:elapsed(e.atMs),...(e.durationMs!==undefined?{durationMs:elapsed(e.durationMs)}:{}),...(outcome==='error'?{errorKind:errors.has(e.errorKind)?e.errorKind:'UnknownError'}:{})};})},
        privacy:{localOnly:true,rawMessages:false,stackTraces:false,modelNames:false,operatorNames:false,searchAndPatterns:false,weightsAndAttributes:false,extensionDetails:false,fullUserAgent:false},
        limitations:['操作紀錄僅限目前分頁記憶體；重新整理後不保留。','數量與檔案大小只記錄區間，耗時以 10ms 取整。','匯出操作成功表示產生檔案，不代表瀏覽器已完成下載。','未量測整個瀏覽器程序或 Worker 的記憶體，也未驗證 dialect／runtime 語意。']};
    const text=JSON.stringify(report,null,2)+'\n';
    if(new TextEncoder().encode(text).length>DIAGNOSTIC_BYTE_LIMIT)throw new Error('診斷報告超過大小上限，請先清除本次操作紀錄。');
    return {report,text};
}
