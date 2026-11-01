import path from 'node:path';
import assert from 'node:assert/strict';

export function assertProbeLayerCount(actual,expected){
    assert.equal(actual,expected.toLocaleString('en-US'));
}

export function rendererProbeLocations({root,reportPath,nonce}){
    need(path.isAbsolute(root)&&path.isAbsolute(reportPath)&&/^[a-f0-9]{16}$/.test(nonce),'probe-locations');
    const fixtures=path.join(path.dirname(reportPath),'renderer-release-fixtures');
    return {fixtures,core:path.join(root,'build',`renderer-release-probe-${nonce}`)};
}

export const RENDERER_RELEASE_PLAN=Object.freeze({
    sampleIntervalMs:500,observeAfterCloseMs:45000,stepBytes:100*1024**2,maxSampleGapMs:1500,
    maxSamplesPerCase:512,maxOwnersPerSample:32,maxOwnerLabels:128,maxReportBytes:8*1024**2,
    cases:Object.freeze([Object.freeze({id:'small',repeats:1000,operators:3005,weightBytes:1024**2}),Object.freeze({id:'large',repeats:7000,operators:21005,weightBytes:1024**2})])
});
const memoryFields=['rssBytes','anonymousBytes','fileBytes','sharedBytes'];
const phaseNames=['baseline','source','loaded','closing','closed'];
const kindNames=['browser','renderer','GPU','unknown'];
const number=value=>Number.isSafeInteger(value)&&value>=0&&value<=2**50;
const key=p=>`${p.pid}:${p.startTicks}`;
const need=(value,code)=>{if(!value)throw Error(code);};

// Input identities are already admitted by OwnedProcessTree. Keep PID and
// creation IDs inside this collector; published observations use ordinal labels.
export function createRendererProjection(){
    const labels=new Map();
    return {project(anchor,native,metrics,types){
        need(Number.isSafeInteger(anchor?.index)&&anchor.index>=0&&anchor.index<RENDERER_RELEASE_PLAN.maxSamplesPerCase,'sample-budget');
        need(phaseNames.includes(anchor.phase)&&number(anchor.elapsedMs)&&number(anchor.rssBytes)&&anchor.rssBytes>0,'sample-anchor');
        need(Array.isArray(native?.processes)&&native.processes.length>0&&native.processes.length<=RENDERER_RELEASE_PLAN.maxOwnersPerSample&&native.processes.length===anchor.processes,'owner-budget');
        need(native.elapsedMs===anchor.elapsedMs&&native.phase===anchor.phase&&native.gateRssBytes===anchor.rssBytes&&number(native.observedStartMs)&&native.observedStartMs>=anchor.elapsedMs&&number(native.observedEndMs)&&native.observedEndMs>=native.observedStartMs,'native-anchor');
        need(new Set(native.processes.map(key)).size===native.processes.length,'owner-duplicate');
        const owners=native.processes.map(p=>{
            need(Number.isSafeInteger(p.pid)&&p.pid>1&&typeof p.startTicks==='string'&&/^\d+$/.test(p.startTicks)&&['present','exited','reused'].includes(p.observation),'owner-identity');
            const id=key(p);if(!labels.has(id)){need(labels.size<RENDERER_RELEASE_PLAN.maxOwnerLabels,'owner-label-budget');labels.set(id,labels.size);}
            const memory=Object.fromEntries(memoryFields.map(k=>{const value=p.observation==='present'?p[k]:null;need(value===null||number(value),'owner-memory');return[k,value];}));
            const kind=p.observation==='present'&&kindNames.includes(types.get(p.pid))?types.get(p.pid):'unknown';
            return {label:labels.get(id),kind,observation:p.observation,...memory};
        });
        const metric=k=>{const value=metrics.find(m=>m.name===k)?.value;need(number(value),'heap-metric');return value;};
        const totals=Object.fromEntries(memoryFields.map(k=>{const values=owners.map(p=>p[k]);const value=values.includes(null)?null:values.reduce((a,b)=>a+b,0);need(value===native.totals[k],'native-total');return[k,value];}));
        need(native.differenceFromGateRSSBytes===(totals.rssBytes===null?null:totals.rssBytes-anchor.rssBytes),'native-difference');
        return {index:anchor.index,phase:anchor.phase,elapsedMs:anchor.elapsedMs,gateRssBytes:anchor.rssBytes,processCount:anchor.processes,nativeObservedStartMs:native.observedStartMs,nativeObservedEndMs:native.observedEndMs,mainHeapUsedBytes:metric('JSHeapUsedSize'),mainHeapTotalBytes:metric('JSHeapTotalSize'),owners,totals,differenceFromGateRSSBytes:native.differenceFromGateRSSBytes};
    },get labelCount(){return labels.size;}};
}

export function summarizeRendererRelease(samples,closedAtMs){
    need(Array.isArray(samples)&&samples.length>=3&&samples.length<=RENDERER_RELEASE_PLAN.maxSamplesPerCase&&number(closedAtMs),'missing-probe-samples');
    need(samples.every((s,i)=>s.index===i&&phaseNames.includes(s.phase)&&number(s.elapsedMs)&&(i===0||s.elapsedMs>=samples[i-1].elapsedMs)),'sample-order');
    const closed=samples.filter(s=>s.phase==='closed');need(closed.length>=3&&closed.every(s=>s.elapsedMs>=closedAtMs),'missing-post-close');
    const rendererLabels=new Set(closed.flatMap(s=>s.owners.filter(p=>p.kind==='renderer').map(p=>p.label)));need(rendererLabels.size===1,'ambiguous-renderer');
    const label=[...rendererLabels][0],renderer=s=>s.owners.find(p=>p.label===label),complete=s=>{const p=renderer(s);return p?.kind==='renderer'&&p.observation==='present'&&memoryFields.every(k=>number(p[k]));};
    need(closed.every(complete),'missing-renderer-memory');
    const changes=[];
    for(let i=1;i<samples.length;i++){
        const a=samples[i-1],b=samples[i];
        if(!['closing','closed'].includes(a.phase)||b.phase!=='closed'||b.elapsedMs<closedAtMs+1000||b.elapsedMs-a.elapsedMs>RENDERER_RELEASE_PLAN.maxSampleGapMs||!complete(a)||!complete(b))continue;
        const before=renderer(a),after=renderer(b),anonymousDeltaBytes=after.anonymousBytes-before.anonymousBytes;
        if(anonymousDeltaBytes<=-RENDERER_RELEASE_PLAN.stepBytes)changes.push({from:a.index,to:b.index,afterCloseMs:b.elapsedMs-closedAtMs,anonymousDeltaBytes,fileDeltaBytes:after.fileBytes-before.fileBytes,sharedDeltaBytes:after.sharedBytes-before.sharedBytes,gateRssDeltaBytes:b.gateRssBytes-a.gateRssBytes,mainHeapUsedDeltaBytes:b.mainHeapUsedBytes-a.mainHeapUsedBytes,mainHeapTotalDeltaBytes:b.mainHeapTotalBytes-a.mainHeapTotalBytes});
    }
    const anon=closed.map(s=>renderer(s).anonymousBytes),rss=closed.map(s=>s.gateRssBytes);
    return {rendererLabel:label,postCloseSamples:closed.length,postCloseDurationMs:closed.at(-1).elapsedMs-closedAtMs,delayedReleaseStepObserved:changes.length>0,changes,rendererAnonymousFirstBytes:anon[0],rendererAnonymousLastBytes:anon.at(-1),rendererAnonymousMinBytes:Math.min(...anon),rendererAnonymousMaxBytes:Math.max(...anon),closedRssFirstBytes:rss[0],closedRssLastBytes:rss.at(-1),missingOwners:closed.reduce((n,s)=>n+s.owners.filter(p=>p.observation!=='present').length,0)};
}

// Reject private/unplanned additions rather than redacting an arbitrary object.
// Safe source bindings, enum labels and numeric observations are the report.
export function assertPublicRendererReport(report){
    const allowed=new Set(['format','version','purpose','releaseEvidenceEligible','forcedGC','status','operation','source','commit','tree','committedAt','dirty','node','chromium','policy','sampleIntervalMs','observeAfterCloseMs','stepBytes','maxSampleGapMs','maxSamplesPerCase','maxOwnersPerSample','maxOwnerLabels','maxReportBytes','cases','id','repeats','operators','weightBytes','fixture','bytes','sha256','readbackSHA256','samples','index','phase','elapsedMs','gateRssBytes','processCount','nativeObservedStartMs','nativeObservedEndMs','mainHeapUsedBytes','mainHeapTotalBytes','owners','label','kind','observation','rssBytes','anonymousBytes','fileBytes','sharedBytes','totals','differenceFromGateRSSBytes','closedAtMs','workerHeap','usedSize','totalSize','embedderHeapUsedSize','backingStorageSize','summary','rendererLabel','postCloseSamples','postCloseDurationMs','delayedReleaseStepObserved','changes','from','to','afterCloseMs','anonymousDeltaBytes','fileDeltaBytes','sharedDeltaBytes','gateRssDeltaBytes','mainHeapUsedDeltaBytes','mainHeapTotalDeltaBytes','rendererAnonymousFirstBytes','rendererAnonymousLastBytes','rendererAnonymousMinBytes','rendererAnonymousMaxBytes','closedRssFirstBytes','closedRssLastBytes','missingOwners','workerCounts','model','layout','identity','runtime','other','allClosed','allReaped','observedIdentityCount','labelCount','sourceUnchanged','failures','stage','code','messageSHA256']);
    for(const key of ['poolLogging','v8','poolLog','events','privateLogBytes','scopedPoolLines','foreignPoolLines','v8ElapsedUs','normalPageBytes','largePageBytes','poolCorrelations','poolEventIndexes','poolReleaseCoincidesWithStep'])allowed.add(key);
    const strings=new Set(['model-lens-renderer-release-probe','readonly-native-memory-attribution','open-close','running','complete','failed','small','large','baseline','source','loaded','closing','closed','browser','renderer','GPU','unknown','present','exited','reused','host','fixture','build','launch','ui','observe','cleanup','finish','unexpected']);
    const visit=(v,k)=>{
        if(v===null||typeof v==='boolean'||typeof v==='number'){need(typeof v!=='number'||Number.isSafeInteger(v)&&Math.abs(v)<=2**50,'public-number');return;}
        if(Array.isArray(v)){need(v.length<=RENDERER_RELEASE_PLAN.maxSamplesPerCase*2,'public-array');for(const x of v)visit(x,k);return;}
        if(typeof v==='object'){for(const [name,x]of Object.entries(v)){need(allowed.has(name),'private-report-field');visit(x,name);}return;}
        need(typeof v==='string'&&(strings.has(v)||['commit','tree'].includes(k)&&/^[a-f0-9]{40}$/.test(v)||['sha256','readbackSHA256','messageSHA256'].includes(k)&&/^[a-f0-9]{64}$/.test(v)||k==='committedAt'&&/^\d{4}-\d\d-\d\dT[\d:+-]+Z?$/.test(v)||['node','chromium','v8'].includes(k)&&/^v?\d+\.\d+\.\d+(?:\.\d+)?$/.test(v)),'private-report-string');
    };
    need(report?.format==='model-lens-renderer-release-probe'&&report.releaseEvidenceEligible===false&&report.purpose==='readonly-native-memory-attribution'&&report.forcedGC===false,'diagnostic-marker');visit(report,'');
    need(Buffer.byteLength(JSON.stringify(report))<=RENDERER_RELEASE_PLAN.maxReportBytes,'report-budget');return report;
}

export function assertRendererProbeWorkflow(w){
    const same=(a,b)=>JSON.stringify(a)===JSON.stringify(b),job=w?.jobs?.minimize;
    need(same(Object.keys(w.on),['workflow_dispatch'])&&same(w.permissions,{contents:'read'})&&same(Object.keys(w.jobs),['minimize']),'probe-workflow-trigger-or-permissions');
    need(job?.if==="github.ref == 'refs/heads/main' && github.repository == 'koviankevin/tflite-explorer'"&&job['runs-on']==='ubuntu-24.04'&&job['timeout-minutes']===10&&!job.permissions&&!job.environment&&!job.secrets,'probe-workflow-scope');
    need(same(job.env,{REPORT_NAME:'renderer-release-probe-${{ github.run_id }}-${{ github.run_attempt }}.json'}),'probe-report-name');
    need(Array.isArray(job.steps)&&job.steps.length===7&&job.steps.every(s=>!s.env),'probe-workflow-steps');
    need(job.steps[0].uses==='actions/checkout@11d5960a326750d5838078e36cf38b85af677262'&&job.steps[0].with['persist-credentials']===false,'probe-checkout');
    need(job.steps[1].uses==='actions/setup-node@49933ea5288caeca8642d1e84afbd3f7d6820020'&&job.steps[1].with['node-version']==='22.23.3','probe-node');
    need(same(job.steps.slice(2,6).map(s=>s.run),['npm ci --ignore-scripts','node --test test/renderer-release-probe.test.mjs test/renderer-pool-log.test.mjs test/owned-processes.test.mjs test/physical-fixture.test.mjs','node scripts/install-browser.mjs','DEBUG=pw:browser DEBUG_FILE="$RUNNER_TEMP/$REPORT_NAME.browser-private.log" RENDERER_PROBE_REPORT="$RUNNER_TEMP/$REPORT_NAME" node test/browser/renderer-release-probe.mjs']),'probe-commands');
    const upload=job.steps[6];need(upload.uses==='actions/upload-artifact@ea165f8d65b6e75b540449e92b4886f43607fa02'&&upload.if==='always()'&&same(upload.with,{name:'renderer-release-probe-${{ github.sha }}-${{ github.run_attempt }}',path:'${{ runner.temp }}/${{ env.REPORT_NAME }}','if-no-files-found':'error','retention-days':30}),'probe-upload-public-summary-only');
    return true;
}
