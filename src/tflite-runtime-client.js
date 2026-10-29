import {RUNTIME_LIMITS,runtimeSkipped} from './tflite-runtime-policy.js';
import {prepareRuntimeModule} from './runtime-module.js';
import {runtimeIOBufferTransfers,releaseRuntimeIOBuffer} from './runtime-io.js';
function prepared(slot,module){
    if(slot.finished)return;
    try{slot.worker.postMessage({...slot.payload,runtimeModule:module},runtimeIOBufferTransfers(slot.payload.ioBuffer));slot.payload=null;}
    catch(error){slot.finish(runtimeSkipped(`此瀏覽器無法傳送本機 runtime：${String(error.message).slice(0,512)}`));}
}
function preparationFailed(slot,error){if(!slot.finished)slot.finish(runtimeSkipped(`無法準備公開 runtime：${String(error?.message||error).slice(0,512)}`));}
function finish(slot,release,result){
    if(slot.finished)return;slot.finished=true;clearTimeout(slot.timer);releaseRuntimeIOBuffer(slot.payload?.ioBuffer);slot.payload=slot.progress=null;
    if(slot.worker){slot.worker.onmessage=slot.worker.onerror=slot.worker.onmessageerror=null;slot.worker.terminate();slot.worker=null;}
    const resolve=slot.resolve;slot.resolve=null;release(slot);resolve(result);
}
// Async callbacks capture this explicit slot, not check()'s File arguments.
function start(slot,createWorker,prepareModule,release){
    return new Promise(resolve=>{
        slot.resolve=resolve;slot.finish=finish.bind(null,slot,release);
        try{
            slot.worker=createWorker();if(slot.finished){slot.worker.terminate();slot.worker=null;return;}
            slot.worker.onmessage=({data})=>{if(data.progress)slot.progress?.(String(data.progress));else if(data.result)slot.finish(data.result);};
            slot.worker.onerror=event=>{event.preventDefault?.();slot.finish(runtimeSkipped('本機 runtime Worker 發生錯誤；未完成執行驗證。'));};slot.worker.onmessageerror=()=>slot.finish(runtimeSkipped('本機 runtime 結果無法讀取。'));
            slot.timer=setTimeout(()=>slot.finish(runtimeSkipped('執行檢查超過 30 秒，已終止 Worker；可能包含長迴圈或高負載。')),RUNTIME_LIMITS.timeoutMs);
            slot.progress?.('準備本機 LiteRT CPU runtime…');if(slot.finished)return;
            Promise.resolve(prepareModule()).then(prepared.bind(null,slot),preparationFailed.bind(null,slot));
        }catch(error){slot.finish(runtimeSkipped(`此瀏覽器無法啟動本機 runtime：${error.message}`));}
    });
}
// One owned Worker per check; cancellation, failure and success all terminate it.
export function runtimeClient({createWorker=()=>new Worker(new URL('./tflite-runtime-worker.js',import.meta.url)),prepareModule=prepareRuntimeModule}={}){
    let current=null;
    const release=slot=>{if(current===slot)current=null;};
    const cancel=()=>current?.finish({...runtimeSkipped('已取消本機執行檢查；尚未驗證的結果不算通過。'),cancelled:true});
    return {cancel,check(blob,plan,progress=()=>{},specs=plan?.inputs?.map(()=>({mode:'zero'})),ioBuffer=null){
        cancel();if(!plan?.eligible){releaseRuntimeIOBuffer(ioBuffer);return Promise.resolve(runtimeSkipped(plan?.reason||'缺少執行檢查 metadata。'));}
        current={worker:null,timer:null,finished:false,payload:{blob,plan,specs,ioBuffer},progress,finish:null,resolve:null};
        return start(current,createWorker,prepareModule,release);
    }};
}
