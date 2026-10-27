const MiB=1024**2;
export const LIFECYCLE_POLICY=Object.freeze({version:1,cycles:8,warmupCycles:2,sampleIntervalMs:500,urlReleaseTimeoutMs:80000,settleSamples:5,
    maxReadBytes:MiB,realmReadBytes:16*MiB,browserPeakGrowthBytes:768*MiB,closedRssDriftBytes:128*MiB,closedRssSlopeBytesPerCycle:16*MiB,closedMainHeapDriftBytes:32*MiB,modelWorkerUsedBytes:512*MiB,modelWorkerBackingBytes:512*MiB});
export function median(values) {if(!values.length||values.some(x=>!Number.isFinite(x)))throw Error('Missing finite samples.');const sorted=[...values].sort((a,b)=>a-b),at=Math.floor(sorted.length/2);return sorted.length%2?sorted[at]:(sorted[at-1]+sorted[at])/2;}
export function slope(values) {if(values.length<2||values.some(x=>!Number.isFinite(x)))throw Error('Missing slope samples.');const mean=(values.length-1)/2,average=values.reduce((a,b)=>a+b,0)/values.length;return values.reduce((n,v,i)=>n+(i-mean)*(v-average),0)/values.reduce((n,_,i)=>n+(i-mean)**2,0);}
export function evaluateLifecycle(report,policy=LIFECYCLE_POLICY) {
    const issues=[],cycles=report.cycles || [],samples=report.samples || [];
    if(cycles.length!==policy.cycles)issues.push('missing-cycles');
    for(const [i,c] of cycles.entries()) {
        if(c.cycle!==i+1 || c.weightVerified!==true || c.optionsVerified!==true || c.patternSourceMatches!==1 || c.patternReopenMatches!==1 || c.negativePatternMatches!==0 || c.fileInputEmpty!==true || c.liveModelWorkers!==0 || c.activeBlobUrls!==0 || !Number.isFinite(c.closedRssBytes) || c.closedRssBytes<=0 || !Number.isFinite(c.closedMainHeapBytes) || c.closedMainHeapBytes<=0)issues.push(`cycle-${i+1}-incomplete`);
        if(!Array.isArray(c.workerHeaps)||c.workerHeaps.length<2||c.workerHeaps.some(h=>!Number.isFinite(h.usedSize)||h.usedSize<=0||h.usedSize>policy.modelWorkerUsedBytes||!Number.isFinite(h.backingStorageSize)||h.backingStorageSize<0||h.backingStorageSize>policy.modelWorkerBackingBytes))issues.push(`cycle-${i+1}-worker-heap`);
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
