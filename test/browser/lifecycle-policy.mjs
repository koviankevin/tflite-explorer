const MiB=1024**2;
export const LIFECYCLE_POLICY=Object.freeze({version:1,cycles:8,warmupCycles:2,sampleIntervalMs:500,urlReleaseTimeoutMs:80000,settleSamples:5,
    maxReadBytes:MiB,realmReadBytes:16*MiB,browserPeakGrowthBytes:768*MiB,closedRssDriftBytes:128*MiB,closedRssSlopeBytesPerCycle:16*MiB,closedMainHeapDriftBytes:32*MiB,modelWorkerUsedBytes:512*MiB,modelWorkerBackingBytes:512*MiB});
// Same memory/read limits. v2 also requires the real full-model edit path in
// every cycle; v1 remains verifiable for immutable historical rollback assets.
export const MODEL_EDIT_LIFECYCLE_POLICY=Object.freeze({...LIFECYCLE_POLICY,version:2});
// v3 adds real incremental composition/export/reopen to every eight-cycle run.
// All original physical editing, memory/read limits and v1/v2 history remain.
export const MODEL_COMPOSITION_LIFECYCLE_POLICY=Object.freeze({...LIFECYCLE_POLICY,version:3});
export function median(values) {if(!values.length||values.some(x=>!Number.isFinite(x)))throw Error('Missing finite samples.');const sorted=[...values].sort((a,b)=>a-b),at=Math.floor(sorted.length/2);return sorted.length%2?sorted[at]:(sorted[at-1]+sorted[at])/2;}
export function slope(values) {if(values.length<2||values.some(x=>!Number.isFinite(x)))throw Error('Missing slope samples.');const mean=(values.length-1)/2,average=values.reduce((a,b)=>a+b,0)/values.length;return values.reduce((n,v,i)=>n+(i-mean)*(v-average),0)/values.reduce((n,_,i)=>n+(i-mean)**2,0);}
export function evaluateLifecycle(report,policy=LIFECYCLE_POLICY) {
    if(policy===LIFECYCLE_POLICY&&report.policy?.version===2)policy=MODEL_EDIT_LIFECYCLE_POLICY;
    if(policy===LIFECYCLE_POLICY&&report.policy?.version===3)policy=MODEL_COMPOSITION_LIFECYCLE_POLICY;
    const issues=[],cycles=report.cycles || [],samples=report.samples || [];
    if(cycles.length!==policy.cycles)issues.push('missing-cycles');
    for(const [i,c] of cycles.entries()) {
        if(c.cycle!==i+1 || c.weightVerified!==true || c.optionsVerified!==true || c.patternSourceMatches!==1 || c.patternReopenMatches!==1 || c.negativePatternMatches!==0 || c.fileInputEmpty!==true || c.liveModelWorkers!==0 || c.activeBlobUrls!==0 || !Number.isFinite(c.closedRssBytes) || c.closedRssBytes<=0 || !Number.isFinite(c.closedMainHeapBytes) || c.closedMainHeapBytes<=0)issues.push(`cycle-${i+1}-incomplete`);
        if(!Array.isArray(c.workerHeaps)||c.workerHeaps.length<2||c.workerHeaps.some(h=>!Number.isFinite(h.usedSize)||h.usedSize<=0||h.usedSize>policy.modelWorkerUsedBytes||!Number.isFinite(h.backingStorageSize)||h.backingStorageSize<0||h.backingStorageSize>policy.modelWorkerBackingBytes))issues.push(`cycle-${i+1}-worker-heap`);
        if(policy.version>=2){
            const m=c.modelEdit;
            if(!m||m.sourceOperators!==21005||m.outputOperators!==21006||m.readbackOperators!==21006||!Number.isSafeInteger(m.bytes)||m.bytes<=1024**3||m.weightVerified!==true||m.optionsVerified!==true||!/^[a-f0-9]{64}$/.test(m.weightSHA256||'')||m.weightSHA256!==report.fixture?.weightSHA256||m.roundTrip!==true||m.prefixMatches!==1||m.branchMatches!==1||m.byteComparison!=='passed'||!Number.isSafeInteger(m.comparedBytes)||m.comparedBytes<1024**3||!Number.isSafeInteger(m.byteRanges)||m.byteRanges<1||!/^[a-f0-9]{64}$/.test(m.sha256||'')||!Number.isFinite(m.exportMs)||m.exportMs<=0||c.workerHeaps?.length<3)issues.push(`cycle-${i+1}-model-edit-incomplete`);
        }
        if(policy.version===3){
            const m=c.composition,layout=m?.layout;
            if(!m||m.workspaceNative!==true||JSON.stringify(m.imports)!=='[4,4]'||m.sourceNodes!==8||m.cloneNodes!==1||m.undoRedo!==true||m.sourceOperators!==21005||m.outputOperators!==9||m.readbackOperators!==9||!Number.isSafeInteger(m.bytes)||m.bytes<=1024**3||m.weightVerified!==true||m.optionsVerified!==true||m.weightSHA256!==report.fixture?.weightSHA256||m.roundTrip!==true||m.prefixMatches!==1||m.branchMatches!==1||m.reshapeMatches!==1||m.byteComparison!=='passed'||!Number.isSafeInteger(m.comparedBytes)||m.comparedBytes<1024**3||!Number.isSafeInteger(m.byteRanges)||m.byteRanges<1||!/^[a-f0-9]{64}$/.test(m.sha256||'')||m.sha256!==cycles[0]?.composition?.sha256||!Number.isFinite(m.exportMs)||m.exportMs<=0||JSON.stringify(m.inputs)!=='[0]'||JSON.stringify(m.outputs)!=='[21009,21011]'||m.draft?.version!==2||m.draft?.nodes!==8||m.draft?.fingerprint!==report.fixture?.editFingerprint||layout?.font!==32||layout?.width!==1280||!Number.isFinite(layout.scrollWidth)||layout.scrollWidth>layout.width||!Number.isFinite(layout.graphHeight)||layout.graphHeight<200||c.workerHeaps?.length<5)issues.push(`cycle-${i+1}-composition-incomplete`);
            if(m?.negativePatternMatches!==0||!/^[a-f0-9]{64}$/.test(report.fixture?.editFingerprint||'')||m?.recovery?.complete!==true||m.recovery.bytes!==report.fixture?.bytes||m.recovery.fingerprint!==report.fixture?.editFingerprint||!Number.isFinite(m.recovery.maxRead)||m.recovery.maxRead<=0||m.recovery.maxRead>policy.maxReadBytes||!Array.isArray(m.recovery.violations)||m.recovery.violations.length)issues.push(`cycle-${i+1}-composition-source-identity`);
        }
    }
    if(!samples.length || samples.some(s=>!Number.isFinite(s.rssBytes)||s.rssBytes<=0))issues.push('missing-browser-rss');
    let summary=null;
    if(cycles.length===policy.cycles && !issues.some(x=>x.includes('incomplete')) && samples.length && !issues.includes('missing-browser-rss')) {
        const measured=cycles.slice(policy.warmupCycles),rss=measured.map(c=>c.closedRssBytes),heap=measured.map(c=>c.closedMainHeapBytes);
        summary={measuredCycles:measured.length,rssSlopeBytesPerCycle:slope(rss),rssDriftBytes:median(rss.slice(-3))-cycles[policy.warmupCycles-1].closedRssBytes,mainHeapDriftBytes:median(heap.slice(-3))-cycles[policy.warmupCycles-1].closedMainHeapBytes,sampledPeakRssBytes:Math.max(...samples.map(s=>s.rssBytes))};
        summary.sampledPeakGrowthBytes=summary.sampledPeakRssBytes-samples[0].rssBytes;
        if(summary.rssSlopeBytesPerCycle>policy.closedRssSlopeBytesPerCycle)issues.push('closed-rss-slope');
        if(summary.rssDriftBytes>policy.closedRssDriftBytes)issues.push('closed-rss-drift');
        if(summary.mainHeapDriftBytes>policy.closedMainHeapDriftBytes)issues.push('closed-main-heap-drift');
        if(summary.sampledPeakGrowthBytes>policy.browserPeakGrowthBytes)issues.push('sampled-browser-peak-growth');
    }
    return {status:issues.length?'failed':'passed',issues,summary};
}
