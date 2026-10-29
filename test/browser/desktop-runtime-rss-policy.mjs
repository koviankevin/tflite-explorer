import {RUNTIME_LIFECYCLE_POLICY as original} from './runtime-lifecycle-policy.mjs';
import {median,slope} from './lifecycle-policy.mjs';

// An additional RSS-only protocol, never a replacement for Chromium's existing
// main-heap/CDP acceptance. Every shared numeric RSS/URL limit stays identical.
export const DESKTOP_RUNTIME_RSS_POLICY=Object.freeze({version:1,cycles:original.cycles,warmupCycles:original.warmupCycles,runsPerCycle:original.runsPerCycle,sampleIntervalMs:original.sampleIntervalMs,maxSampleGapMs:original.maxSampleGapMs,urlReleaseTimeoutMs:original.urlReleaseTimeoutMs,settleSamples:original.settleSamples,deadlineMs:original.deadlineMs,closedRssDriftBytes:original.closedRssDriftBytes,closedRssSlopeBytesPerCycle:original.closedRssSlopeBytesPerCycle,browserPeakGrowthBytes:original.browserPeakGrowthBytes});
export const DESKTOP_RUNTIME_MEASUREMENTS=Object.freeze({browser:'owned-process-tree-rss',worker:'included-in-owned-process-rss',mainHeap:null,workerIsolateHeap:null});
const array=x=>Array.isArray(x)?x:[],same=(a,b)=>JSON.stringify(a)===JSON.stringify(b),finite=x=>Number.isFinite(x)&&x>0,hash=x=>/^[a-f0-9]{64}$/.test(x||''),identity=x=>Number.isSafeInteger(x?.pid)&&x.pid>0&&/^\d+$/.test(x.startTicks);
export function evaluateDesktopRuntimeRSS(r={}){
    if(!r||typeof r!=='object')r={};
    const p=DESKTOP_RUNTIME_RSS_POLICY,issues=[],need=(value,key)=>{if(!value)issues.push(key);},cycles=array(r.cycles),samples=array(r.samples),urls=array(r.urls),models=array(r.modelWorkers),runtimes=array(r.runtimeWorkers);
    need(r.format==='model-lens-desktop-runtime-rss'&&r.version===1&&['firefox','webkit'].includes(r.engine),'format');need(same(r.policy,p),'policy');need(same(r.measurements,DESKTOP_RUNTIME_MEASUREMENTS),'memory-boundary');
    need(r.source?.dirty===false&&r.sourceUnchanged===true&&/^[a-f0-9]{40}$/.test(r.source?.tree||'')&&/^[a-f0-9]{40}$/.test(r.source?.commit||''),'source');
    need(r.forcedGC===false&&r.shortenedURLTimer===false,'natural-lifecycle');need(r.fixture?.modelBytes===4195488&&r.fixture?.inputBytes===4194304&&r.fixture?.outputBytes===4194304&&hash(r.fixture?.modelSHA256),'fixture');
    need(cycles.length===p.cycles,'cycle-count');
    const validSamples=samples.length>20&&samples.length<=2048&&samples.every((s,i)=>s&&finite(s.rssBytes)&&Number.isSafeInteger(s.processes)&&s.processes>0&&s.processes<=1024&&Number.isFinite(s.elapsedMs)&&s.elapsedMs>=0&&(!i||s.elapsedMs>=samples[i-1].elapsedMs&&s.elapsedMs-samples[i-1].elapsedMs<=p.maxSampleGapMs));
    need(validSamples,'samples');need(validSamples&&samples[0].elapsedMs<=p.maxSampleGapMs&&Number.isFinite(r.elapsedMs)&&r.elapsedMs>=samples.at(-1).elapsedMs&&r.elapsedMs-samples.at(-1).elapsedMs<=p.maxSampleGapMs&&r.elapsedMs<=p.deadlineMs,'sample-coverage');
    function settled(value,phase){const indices=array(value?.indices);if(indices.length!==p.settleSamples||new Set(indices).size!==indices.length||!indices.every(i=>Number.isSafeInteger(i)&&i>=0&&i<samples.length&&samples[i]?.phase===phase&&finite(samples[i]?.rssBytes)))return false;return value.rssBytes===median(indices.map(i=>samples[i].rssBytes));}
    for(const [i,c]of cycles.entries()){
        const runs=array(c?.runs),io=c?.io;
        need(c?.cycle===i+1&&runs.length===3&&runs.every((run,j)=>run?.status==='passed'&&run.input===i*3+j&&run.workerClosed===true)&&c.liveModelWorkers===0&&c.liveRuntimeWorkers===0&&c.fileInputEmpty===true&&finite(c.closedRssBytes)&&settled(c.settled,`cycle-${i+1}-settle`)&&c.closedRssBytes===c.settled.rssBytes,`cycle-${i+1}`);
        need(io?.input===i*3+2&&io.modelSHA256===r.fixture?.modelSHA256&&hash(io.sha256)&&hash(io.inputSHA256)&&hash(io.outputSHA256)&&io.inputBytes===4194304&&io.outputBytes===4194304&&io.bytesVerified===true&&io.crcVerified===true&&urls[i]?.id===io.urlId&&urls[i]?.bytes===io.zipBytes,`io-${i+1}`);
    }
    need(typeof r.base==='string'&&models.length===8&&runtimes.length===24&&models.every(w=>w?.closed===true&&typeof w.url==='string'&&w.url.startsWith(r.base)&&/\/model-worker\.js(?:\?|$)/.test(w.url))&&runtimes.every(w=>w?.closed===true&&typeof w.url==='string'&&w.url.startsWith(r.base)&&/\/tflite-runtime-worker\.js(?:\?|$)/.test(w.url)),'worker-close');
    need(urls.length===8&&new Set(urls.map(u=>u?.id)).size===8&&urls.every(u=>u?.bytes>=8388608&&Number.isFinite(u.createdAt)&&Number.isFinite(u.revokedAt)&&u.revokedAt-u.createdAt>=59950&&u.revokedAt-u.createdAt<=p.urlReleaseTimeoutMs),'native-url-lifetime');
    need(array(r.urlWindows).length===2&&r.urlWindows.every(w=>w?.before>0&&w.after===0&&w.elapsedMs>=0&&w.elapsedMs<=p.urlReleaseTimeoutMs)&&r.urlAuditOverflow===false,'url-release');
    need(settled(r.warmBaseline,'warmup-settle')&&settled(r.final,'final-settle'),'settled-metrics');
    need(r.inputCleanupRequired===true&&array(r.inputCleanup).length===24&&r.inputCleanup.every((c,i)=>c?.kind===`cycle-${Math.floor(i/3)+1}-run-${i%3+1}`&&c.open===false&&c.controls===0&&c.fileInputs===0&&c.callbackCleared===true&&c.error===''),'input-cleanup');
    const owned=array(r.ownedProcesses),exited=array(r.processCleanup?.identities),key=p=>`${p.pid}:${p.startTicks}`;
    need(r.browserClosed===true&&identity(r.ownership?.root)&&r.ownership?.method==='direct Node child plus exact per-launch random environment marker'&&owned.length>0&&owned.length<=1024&&owned.every(identity)&&new Set(owned.map(key)).size===owned.length&&owned.some(p=>key(p)===key(r.ownership.root))&&r.processCleanup?.allReaped===true&&same(r.processCleanup.remaining,[])&&exited.every(identity)&&same(owned.map(key).sort(),exited.map(key).sort()),'process-cleanup');
    need(array(r.errors).length===0&&Array.isArray(r.errors),'errors');
    need(typeof r.base==='string'&&array(r.requests).length>0&&r.requests.length<=2000&&r.requests.every(q=>q?.allowed===true&&q.method==='GET'&&typeof q.url==='string'&&q.url.startsWith(r.base)),'network');
    const temporary=r.temporary,files=array(temporary?.files),events=array(temporary?.events);
    need(typeof temporary?.directory==='string'&&files.length===33&&new Set(files.map(f=>f?.id)).size===33&&files.every(f=>f?.status==='removed'&&finite(f.bytes)&&typeof f.path==='string'&&f.path.startsWith(temporary.directory+'/')&&/^[a-z0-9.-]+$/.test(f.path.slice(temporary.directory.length+1))&&same(events.filter(e=>e?.artifact_id===f.id).map(e=>e.event),['create_intent','created','delete_intent','removed'])),'generated-file-cleanup');
    let summary=null;if(!issues.length){
        const measured=cycles.slice(p.warmupCycles);summary={measuredCycles:measured.length,rssDriftBytes:r.final.rssBytes-r.warmBaseline.rssBytes,closedRssSlopeBytesPerCycle:slope(measured.map(c=>c.closedRssBytes)),sampledPeakRssBytes:Math.max(...samples.map(s=>s.rssBytes)),maxSampleGapMs:Math.max(...samples.slice(1).map((s,i)=>s.elapsedMs-samples[i].elapsedMs))};summary.sampledPeakGrowthBytes=summary.sampledPeakRssBytes-samples[0].rssBytes;
        need(summary.rssDriftBytes<=p.closedRssDriftBytes,'settled-rss-drift');need(summary.closedRssSlopeBytesPerCycle<=p.closedRssSlopeBytesPerCycle,'closed-rss-slope');need(summary.sampledPeakGrowthBytes<=p.browserPeakGrowthBytes,'peak-growth');
    }
    return {status:issues.length?'failed':'passed',issues,summary};
}
