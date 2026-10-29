import {LIFECYCLE_POLICY,median,slope} from './lifecycle-policy.mjs';
export const RUNTIME_LIFECYCLE_POLICY=Object.freeze({version:1,cycles:8,warmupCycles:2,runsPerCycle:3,sampleIntervalMs:500,maxSampleGapMs:3000,urlReleaseTimeoutMs:80000,settleSamples:5,deadlineMs:270000,closedRssDriftBytes:LIFECYCLE_POLICY.closedRssDriftBytes,closedRssSlopeBytesPerCycle:LIFECYCLE_POLICY.closedRssSlopeBytesPerCycle,closedMainHeapDriftBytes:LIFECYCLE_POLICY.closedMainHeapDriftBytes,browserPeakGrowthBytes:LIFECYCLE_POLICY.browserPeakGrowthBytes});
export function evaluateRuntimeLifecycle(r){
    const p=RUNTIME_LIFECYCLE_POLICY,issues=[],need=(v,k)=>{if(!v)issues.push(k);},cycles=r.cycles||[],samples=r.samples||[];
    need(JSON.stringify(r.policy)===JSON.stringify(p),'policy');need(r.forcedGC===false&&r.shortenedURLTimer===false,'natural-lifecycle');need(cycles.length===p.cycles,'cycle-count');
    for(const [i,c]of cycles.entries())need(c.cycle===i+1&&c.runs?.length===3&&c.runs.every((s,j)=>s.status==='passed'&&s.input===(i*3+j)&&s.workerClosed===true)&&c.io?.input===i*3+2&&c.io.modelSHA256===r.fixture?.modelSHA256&&/^[a-f0-9]{64}$/.test(c.io.sha256||'')&&c.io.inputBytes===4194304&&c.io.outputBytes===4194304&&c.io.bytesVerified===true&&c.liveRuntimeWorkers===0&&c.liveModelWorkers===0&&c.fileInputEmpty===true&&c.closedRssBytes>0&&c.closedMainHeapBytes>0,`cycle-${i+1}`);
    need(r.modelWorkers?.length===8&&r.runtimeWorkers?.length===24&&[...r.modelWorkers||[],...r.runtimeWorkers||[]].every(w=>w.closed),'worker-close');
    need(r.urlWindows?.length===2&&r.urlWindows.every(w=>w.before>0&&w.after===0&&w.elapsedMs>=0&&w.elapsedMs<=p.urlReleaseTimeoutMs),'url-release');
    need(r.urls?.length===8&&r.urls.every(u=>u.bytes>=8388608&&Number.isFinite(u.createdAt)&&Number.isFinite(u.revokedAt)&&u.revokedAt-u.createdAt>=59950&&u.revokedAt-u.createdAt<=p.urlReleaseTimeoutMs),'native-url-lifetime');
    need(r.warmBaseline?.rssBytes>0&&r.warmBaseline?.mainHeapBytes>0&&r.final?.rssBytes>0&&r.final?.mainHeapBytes>0,'settled-metrics');
    need(samples.length>20&&samples.every(s=>Number.isFinite(s.elapsedMs)&&s.elapsedMs>=0&&s.rssBytes>0&&s.mainHeapBytes>0&&s.processes>0),'samples');
    const gaps=samples.slice(1).map((s,i)=>s.elapsedMs-samples[i].elapsedMs);need(gaps.length>0&&gaps.every(n=>n>=0&&n<=p.maxSampleGapMs),'sample-gaps');
    need(samples[0]?.elapsedMs<=p.maxSampleGapMs&&r.elapsedMs>=0&&r.elapsedMs-samples.at(-1)?.elapsedMs<=p.maxSampleGapMs&&r.elapsedMs<=p.deadlineMs,'sample-coverage');
    let summary=null;
    if(!issues.length){const measured=cycles.slice(p.warmupCycles);summary={measuredCycles:measured.length,rssDriftBytes:r.final.rssBytes-r.warmBaseline.rssBytes,mainHeapDriftBytes:r.final.mainHeapBytes-r.warmBaseline.mainHeapBytes,closedRssSlopeBytesPerCycle:slope(measured.map(c=>c.closedRssBytes)),sampledPeakRssBytes:Math.max(...samples.map(s=>s.rssBytes)),maxSampleGapMs:Math.max(...gaps)};summary.sampledPeakGrowthBytes=summary.sampledPeakRssBytes-samples[0].rssBytes;need(summary.rssDriftBytes<=p.closedRssDriftBytes,'settled-rss-drift');need(summary.mainHeapDriftBytes<=p.closedMainHeapDriftBytes,'settled-main-heap-drift');need(summary.closedRssSlopeBytesPerCycle<=p.closedRssSlopeBytesPerCycle,'closed-rss-slope');need(summary.sampledPeakGrowthBytes<=p.browserPeakGrowthBytes,'peak-growth');}
    return {status:issues.length?'failed':'passed',issues,summary};
}
export const runtimeSettledMedian=samples=>({rssBytes:median(samples.map(s=>s.rssBytes)),mainHeapBytes:median(samples.map(s=>s.mainHeapBytes))});
