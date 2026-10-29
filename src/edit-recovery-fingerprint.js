// Weak keys do not keep a closed tab's immutable File alive. Pending work is
// cancelled on detach; completed identities may be reused for the same File.
export function editRecoveryFingerprint({createWorker=()=>new Worker(new URL('./edit-recovery-worker.js',import.meta.url),{type:'module'}),progress=()=>{}}={}){
    const cache=new WeakMap();let current=null,serial=0;
    const release=task=>{const worker=task.worker;task.worker=null;if(worker){worker.onmessage=null;worker.onerror=null;worker.terminate();}};
    const cancel=()=>{if(!current)return;const task=current;current=null;release(task);task.reject(new DOMException('已取消原模型核對','AbortError'));};
    return {cancel,read(file){
        if(cache.has(file))return Promise.resolve(cache.get(file));if(current?.file===file)return current.promise;cancel();
        const id=++serial;let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});const task={file,worker:null,id,promise,reject};current=task;
        const finish=(reason,fingerprint)=>{if(current!==task)return;current=null;release(task);if(reason)reject(reason);else{cache.set(file,fingerprint);resolve(fingerprint);}};
        // detach() can capture a final draft and immediately cancel its identity
        // check in the same turn. Do not start a native Worker for that work.
        queueMicrotask(()=>{if(current!==task)return;let worker;try{worker=createWorker();task.worker=worker;}catch(reason){finish(reason);return;}
        worker.onerror=event=>{event.preventDefault?.();finish(Error(event.message||'原模型核對 Worker 無法執行。'));};
        worker.onmessage=({data})=>{if(current!==task||data.id!==id)return;if(data.error){finish(Error(data.error));return;}if(data.fingerprint){if(!/^[a-f0-9]{64}$/.test(data.fingerprint)||data.bytes!==file.size){finish(Error('原模型指紋回覆不符。'));return;}finish(null,data.fingerprint);}
            else if(Number.isSafeInteger(data.done)&&data.total===file.size&&data.done>=0&&data.done<=data.total)try{progress(data.done,data.total);}catch{/* Progress is advisory. */}};
        try{worker.postMessage({id,file});}catch(reason){finish(reason);}});return promise;
    }};
}
