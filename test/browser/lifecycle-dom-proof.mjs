// The cross-engine reader cannot access main-world JS after Netron disables
// eval. This test-only bridge publishes whitelisted numeric observer metadata
// on request; it never touches model/selection state or retains File/Blob data.
export function snapshotLifecycleAudit(state){
    const pick=(value,names)=>Object.fromEntries(names.filter(name=>value&&Object.hasOwn(value,name)).map(name=>[name,value[name]]));
    const counters=value=>{
        if(!value)return undefined;const result=pick(value,['bytes','calls','maxRead']);
        if(Object.values(result).some(v=>!Number.isFinite(v)||v<0)||!Array.isArray(value.violations)||value.violations.length>16||value.violations.some(v=>typeof v!=='string'||v.length>1024))throw Error('Invalid bounded-read observation.');
        return {...result,violations:[...value.violations]};
    };
    if(!state||!Array.isArray(state.workers)||!Array.isArray(state.urls)||state.workers.length>128||state.urls.length>128)throw Error('Lifecycle observation budget exceeded.');
    const workers=state.workers.map(w=>{
        const result=pick(w,['url','terminated','error','verificationPasses','verificationReadBytes','verificationFileBytes']);
        if(typeof result.url!=='string'||result.url.length>4096||typeof result.terminated!=='boolean')throw Error('Invalid Worker observation.');
        if(result.error!==undefined&&(typeof result.error!=='string'||result.error.length>4096)||['verificationPasses','verificationReadBytes','verificationFileBytes'].some(name=>result[name]!==undefined&&(!Number.isSafeInteger(result[name])||result[name]<0)))throw Error('Invalid Worker observation counters.');
        result.audit=counters(w.audit);result.stats=pick(w.stats,['bytesRead','fileBytes']);
        if(Object.values(result.stats).some(v=>!Number.isFinite(v)||v<0))throw Error('Invalid Worker counters.');
        if(w.recoveryAudit){
            const detail=pick(w.recoveryAudit,['complete','fingerprint','elapsedMs']);
            if(typeof detail.complete!=='boolean'||detail.fingerprint!==undefined&&!/^[a-f0-9]{64}$/.test(detail.fingerprint)||detail.elapsedMs!==undefined&&(!Number.isFinite(detail.elapsedMs)||detail.elapsedMs<0))throw Error('Invalid fingerprint observation.');
            result.recoveryAudit={...counters(w.recoveryAudit),...detail};
        }
        return result;
    });
    return {audit:counters(state.audit),workers,urls:state.urls.map(u=>{
        if(typeof u.url!=='string'||u.url.length>4096||!Number.isFinite(u.bytes)||u.bytes<0||typeof u.revoked!=='boolean')throw Error('Invalid Blob URL observation.');
        return {url:u.url,bytes:u.bytes,revoked:u.revoked};
    })};
}
export function installLifecycleDOMProof(snapshot){
    document.addEventListener('model-lens-lifecycle-observe',()=>{
        const text=JSON.stringify(snapshot(globalThis.__lifecycle));
        if(text.length>1024**2)throw Error('Lifecycle proof exceeds the observation budget.');
        document.documentElement.setAttribute('data-model-lens-lifecycle-proof',text);
    });
}
