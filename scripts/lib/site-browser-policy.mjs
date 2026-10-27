export const SITE_BASELINE=Object.freeze({version:'0.2.0-preview.7',build:'163f38ab1dc856e4',source:'a0c0f702e310b53fc6baa3a05a57dbb5ca79b887',sha256:'4a7db3bcf310d7253c1d103cf86292323c32441b7471e84c035917a66b0702f7',bytes:29454029});
export const SITE_CHECKS=Object.freeze([
    'original legacy tab, native TFLite and persisted pattern before switching',
    'legacy and namespaced old tabs lazily load custom MLIR after upgrade with their original version',
    'new root selects the candidate namespace and sees the original IndexedDB pattern',
    'already-open candidate lazily loads TFLite after rollback and retains its version and saved pattern',
    '32px pattern search, native submodel download/reopen and original pattern export after rollback',
    'fresh root after rollback opens the old version with its original persisted pattern'
]);
const same=(a,b)=>JSON.stringify(a)===JSON.stringify(b),array=value=>Array.isArray(value)?value:[];
export function evaluateSiteBrowser(report){
    const r=report||{},issues=[],require=(value,message)=>{if(!value)issues.push(message);};
    const rows=(value,name)=>{const values=array(value),valid=item=>item&&typeof item==='object'&&!Array.isArray(item);require(Array.isArray(value)&&values.every(valid),'Malformed '+name+' records.');return values.filter(valid);};
    require(r.format==='model-lens-versioned-browser'&&r.version===1&&r.status==='passed'&&!r.error,'Incomplete browser report.');
    require(same(r.baseline,SITE_BASELINE),'Wrong immutable baseline.');
    require(/^[a-f0-9]{40}$/.test(r.source?.commit||'')&&/^[a-f0-9]{40}$/.test(r.source?.tree||'')&&r.source.dirty===false&&r.sourceUnchanged===true,'Missing clean unchanged source.');
    require(same(r.candidate?.source,r.source)&&r.candidate?.distribution==='public'&&r.candidate?.extension===null&&typeof r.candidate?.buildId==='string'&&/^[a-f0-9]{16}$/.test(r.candidate.buildId)&&r.candidate.buildId!==SITE_BASELINE.build,'Candidate source or distribution mismatch.');
    require(r.browserClosed===true&&Array.isArray(r.errors)&&r.errors.length===0&&r.phase==='rollback'&&/^\d+\./.test(r.chromium||''),'Browser errors or incomplete shutdown.');
    require(same(r.checks,SITE_CHECKS),'Missing, duplicate or skipped browser scenario.');
    const id=r.candidate?.buildId||'',old=`./versions/${SITE_BASELINE.build}/`,fresh=`./versions/${id}/`,namespaces={legacy:'./','old-namespace':old,candidate:fresh,'rolled-back':old};
    const workers=rows(r.workers,'Worker'),modelWorkers=workers.filter(w=>/\/model-worker\.js(?:\?|$)/.test(w.url||''));
    require(workers.length>0&&workers.length<=20&&workers.every(w=>w.closed===true&&Object.hasOwn(namespaces,w.page)&&typeof w.url==='string'&&w.url.startsWith(namespaces[w.page])),'Retained Worker or wrong namespace.');
    const expected=[['legacy','legacy-root','./'],['legacy','upgrade','./'],['old-namespace','upgrade',old],['candidate','upgrade',fresh],['candidate','rollback',fresh],['candidate','rollback',fresh],['rolled-back','rollback',old]].map(([page,phase,prefix])=>`${page}|${phase}|${prefix}src/model-worker.js?v=${page==='candidate'?id:SITE_BASELINE.build}`).sort();
    require(same(modelWorkers.map(w=>`${w.page}|${w.phase}|${w.url}`).sort(),expected),'Missing model open, wrong Worker namespace or phase.');
    const requests=rows(r.requests,'request');
    require(requests.length>0&&requests.length<=2000&&requests.every(q=>q.method==='GET'&&typeof q.url==='string'&&/^(?:\.\/|blob:|data:)/.test(q.url)&&Object.hasOwn(namespaces,q.page)),'Missing, external or non-GET network requests.');
    require(requests.filter(q=>typeof q.url==='string'&&/\.js(?:\?|$)/.test(q.url)).every(q=>q.page==='legacy'?/^\.\/(?:src|vendor)\//.test(q.url):q.url.startsWith(namespaces[q.page]||'invalid')),'Script requests mixed release namespaces.');
    for(const [page,phase,prefix,file] of [['legacy','upgrade','./','mlir.js'],['old-namespace','upgrade',old,'mlir.js'],['candidate','rollback',fresh,'tflite.js']])require(requests.some(q=>q.page===page&&q.phase===phase&&typeof q.url==='string'&&q.url.startsWith(prefix+'vendor/netron/'+file)),'Missing lazy parser request: '+page+'/'+phase+'/'+file);
    const snapshots=rows(r.snapshots,'snapshot'),expectedIds=[SITE_BASELINE.build,id,SITE_BASELINE.build];
    require(snapshots.length===3&&new Set(snapshots.map(s=>s.siteId)).size===3,'Missing distinct initial/upgrade/rollback snapshots.');
    for(const [i,s] of snapshots.entries())require(typeof s.siteId==='string'&&/^[a-f0-9]{64}$/.test(s.siteId)&&s.currentBuild===expectedIds[i]&&Number.isSafeInteger(s.files)&&s.files>0&&s.files<=4096&&same([...array(s.versions)].sort(),(i===0?[SITE_BASELINE.build]:[SITE_BASELINE.build,id]).sort()),'Invalid snapshot or retained version set.');
    const initial=snapshots[0],upgrade=snapshots[1],rollback=snapshots[2],currentFiles=(upgrade?.files||0)-2*246-3;
    require(initial?.files===2*246+2&&Number.isSafeInteger(currentFiles)&&currentFiles>=6&&currentFiles<=1000&&rollback?.files===upgrade?.files,'Snapshot file counts do not include the complete immutable payloads.');
    return {status:issues.length?'failed':'passed',issues,summary:{modelWorkers:modelWorkers.length,requests:requests.length,scenarios:array(r.checks).length,snapshots:snapshots.length}};
}
