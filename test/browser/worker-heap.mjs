// Public CDP Target transport: Playwright's newCDPSession accepts a Page, not a Worker.
export async function modelWorkerHeap(cdp,{timeoutMs=5000}={}) {
    const {targetInfos}=await cdp.send('Target.getTargets');
    const targets=targetInfos.filter(t=>t.type==='worker' && /\/model-worker\.js(?:\?|$)/.test(t.url));
    if(targets.length!==1)throw Error(`Expected one model Worker, found ${targets.length}.`);
    const {sessionId}=await cdp.send('Target.attachToTarget',{targetId:targets[0].targetId,flatten:false});
    let timer,listener;
    try {
        const response=new Promise((resolve,reject)=>{
            listener=event=>{
                if(event.sessionId!==sessionId)return;
                const data=JSON.parse(event.message);if(data.id!==1)return;
                if(data.error)reject(Error(data.error.message));else resolve(data.result);
            };
            cdp.on('Target.receivedMessageFromTarget',listener);
            timer=setTimeout(()=>reject(Error('Worker heap measurement timed out.')),timeoutMs);
        });
        // Observe both promises immediately so a disconnected target cannot leave an unhandled rejection.
        const [,heap]=await Promise.all([
            cdp.send('Target.sendMessageToTarget',{sessionId,message:JSON.stringify({id:1,method:'Runtime.getHeapUsage',params:{}})}),response
        ]);
        if(!Number.isFinite(heap?.usedSize)||heap.usedSize<=0||!Number.isFinite(heap.backingStorageSize)||heap.backingStorageSize<0)throw Error('Worker heap metrics unavailable.');
        return {targetId:targets[0].targetId,...heap};
    }finally{
        clearTimeout(timer);cdp.off('Target.receivedMessageFromTarget',listener);
        await cdp.send('Target.detachFromTarget',{sessionId});
    }
}
