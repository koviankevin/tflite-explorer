import {RUNTIME_LIMITS,runtimeSkipped} from './tflite-runtime-policy.js';
// One owned Worker per check; cancellation, failure and success all terminate it.
export function runtimeClient({createWorker=()=>new Worker(new URL('./tflite-runtime-worker.js',import.meta.url))}={}){
    let current=null;
    const cancel=()=>current?.finish({...runtimeSkipped('已取消本機執行檢查；尚未驗證的結果不算通過。'),cancelled:true});
    return {cancel,check(blob,plan,progress=()=>{},specs=plan?.inputs?.map(()=>({mode:'zero'}))){
        cancel();if(!plan?.eligible)return Promise.resolve(runtimeSkipped(plan?.reason||'缺少執行檢查 metadata。'));
        return new Promise(resolve=>{
            let worker,timer,finished=false;
            const finish=result=>{if(finished)return;finished=true;clearTimeout(timer);if(worker){worker.onmessage=worker.onerror=worker.onmessageerror=null;worker.terminate();}if(current?.finish===finish)current=null;resolve(result);};
            current={finish};
            try{worker=createWorker();worker.onmessage=({data})=>{if(data.progress)progress(String(data.progress));else if(data.result)finish(data.result);};worker.onerror=event=>{event.preventDefault?.();finish(runtimeSkipped('本機 runtime Worker 發生錯誤；未完成執行驗證。'));};worker.onmessageerror=()=>finish(runtimeSkipped('本機 runtime 結果無法讀取。'));timer=setTimeout(()=>finish(runtimeSkipped('執行檢查超過 30 秒，已終止 Worker；可能包含長迴圈或高負載。')),RUNTIME_LIMITS.timeoutMs);worker.postMessage({blob,plan,specs});}
            catch(error){finish(runtimeSkipped(`此瀏覽器無法啟動本機 runtime：${error.message}`));}
        });
    }};
}
