import {LIFECYCLE_POLICY,median,slope} from '../../test/browser/lifecycle-policy.mjs';
export const DESKTOP_PHYSICAL_POLICY=Object.freeze({version:1,cycles:8,warmupCycles:2,sampleIntervalMs:500,urlReleaseTimeoutMs:80000,settleSamples:5,
    maxReadBytes:LIFECYCLE_POLICY.maxReadBytes,realmReadBytes:LIFECYCLE_POLICY.realmReadBytes,browserPeakGrowthBytes:LIFECYCLE_POLICY.browserPeakGrowthBytes,closedRssDriftBytes:LIFECYCLE_POLICY.closedRssDriftBytes,closedRssSlopeBytesPerCycle:LIFECYCLE_POLICY.closedRssSlopeBytesPerCycle,
    maxMeanSampleMs:1000,maxSampleGapMs:10000});
export function desktopPhysicalSettings(env,platform){
    if(platform!=='linux'||env.GITHUB_ACTIONS!=='true'||env.GITHUB_REPOSITORY!=='koviankevin/tflite-explorer'||env.GITHUB_WORKFLOW!=='Desktop physical model lifecycle'||env.GITHUB_REF!=='refs/heads/main'||env.GITHUB_EVENT_NAME!=='workflow_dispatch')throw Error('Physical desktop acceptance is restricted to this repository on hosted main CI.');
    if(!['firefox','webkit'].includes(env.DESKTOP_ENGINE))throw Error('Expected the pinned Firefox or WebKit engine.');
    return {engine:env.DESKTOP_ENGINE,target:'candidate',expectedBuild:null,expectedSiteId:null,base:null};
}
export function evaluateDesktopPhysical(r={}){
    const p=DESKTOP_PHYSICAL_POLICY,issues=[],require=(value,name)=>{if(!value)issues.push(name);},cycles=Array.isArray(r.cycles)?r.cycles:[],samples=Array.isArray(r.samples)?r.samples:[],same=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
    require(r.format==='model-lens-desktop-physical'&&r.version===1&&['firefox','webkit'].includes(r.engine),'wrong-desktop-physical-format');
    require(same(r.policy,p),'changed-physical-limits');require(r.source?.dirty===false&&r.sourceUnchanged===true,'missing-unchanged-source');
    require(same(r.viewport,{width:1280,height:640})&&cycles.length===p.cycles,'missing-eight-laptop-cycles');
    require(same(r.measurements,{browser:'owned-process-tree-rss',worker:'included-in-owned-process-rss',workerIsolateHeap:null,mainHeap:null}),'misrepresented-worker-memory');
    const objects=cycles.every(c=>c&&typeof c==='object');
    if(objects)for(const [i,c] of cycles.entries()){
        require(c.cycle===i+1&&c.font===32&&c.editFont===32&&c.weightVerified===true&&c.optionsVerified===true&&c.patternSourceMatches===1&&c.patternReopenMatches===1&&c.negativePatternMatches===0&&c.fileInputEmpty===true&&c.liveModelWorkers===0&&c.activeBlobUrls===0&&Number.isFinite(c.closedRssBytes)&&c.closedRssBytes>0,`cycle-${i+1}-incomplete`);
        require(Number.isFinite(c.startedMs)&&Number.isFinite(c.endedMs)&&c.startedMs>=0&&c.endedMs-c.startedMs>=60000&&c.endedMs-c.startedMs<=300000&&c.startedMs-(i?cycles[i-1].endedMs:0)>=0&&c.startedMs-(i?cycles[i-1].endedMs:0)<=5000,`cycle-${i+1}-time`);
        const e=c.modelEdit;require(e?.workspaceNative===true&&e.sourceOperators===21005&&e.outputOperators===21006&&e.readbackOperators===21006&&e.roundTrip===true&&e.bytes>1024**3&&e.weightVerified===true&&e.optionsVerified===true&&e.weightSHA256===r.fixture?.weightSHA256&&e.prefixMatches===1&&e.branchMatches===1&&e.byteComparison==='passed'&&e.comparedBytes>1024**3&&e.byteRanges>0&&/^[a-f0-9]{64}$/.test(e.sha256||''),`cycle-${i+1}-edit`);
        require(Array.isArray(c.rssCheckpoints)&&same(c.rssCheckpoints.map(s=>s.phase),['source','edited-model','reopen'])&&c.rssCheckpoints.every(s=>Number.isFinite(s.rssBytes)&&s.rssBytes>0&&Number.isSafeInteger(s.processes)&&s.processes>0),`cycle-${i+1}-worker-process-memory`);
        require(c.recovery?.complete===true&&c.recovery.bytes===r.fixture?.bytes&&c.recovery.fingerprint===r.fixture?.editFingerprint&&c.recovery.maxRead<=p.maxReadBytes&&same(c.recovery.violations,[]),`cycle-${i+1}-fingerprint`);
    }else issues.push('malformed-cycles');
    const native=Array.isArray(r.workers)?r.workers:[],models=native.filter(w=>/\/model-worker\.js(?:\?|$)/.test(w?.url||'')),identities=native.filter(w=>/\/edit-recovery-worker\.js(?:\?|$)/.test(w?.url||''));require(models.length===p.cycles*3&&identities.length===p.cycles&&[...models,...identities].every(w=>w.closed===true),'missing-native-worker-close');
    require(r.browserClosed===true&&r.processCleanup?.allReaped===true&&Array.isArray(r.processCleanup.identities)&&r.processCleanup.identities.length>0&&r.processCleanup.identities.every(p=>Number.isSafeInteger(p.pid)&&p.pid>0&&/^\d+$/.test(p.startTicks))&&same(r.processCleanup.remaining,[]),'retained-browser-process');
    const validSamples=samples.length>1&&samples.every((s,i)=>s&&Number.isFinite(s.rssBytes)&&s.rssBytes>0&&Number.isFinite(s.elapsedMs)&&(!i||s.elapsedMs>samples[i-1].elapsedMs&&s.elapsedMs-samples[i-1].elapsedMs<=p.maxSampleGapMs));require(validSamples,'missing-process-rss');
    require(validSamples&&Number.isFinite(r.measurementEndedMs)&&r.measurementEndedMs>=cycles.at(-1)?.endedMs&&r.measurementEndedMs-cycles.at(-1)?.endedMs<=5000&&samples[0].elapsedMs<=1000&&r.measurementEndedMs>=samples.at(-1).elapsedMs&&r.measurementEndedMs-samples.at(-1).elapsedMs<=1000,'uncovered-process-rss');
    let summary=null;
    if(validSamples&&objects&&cycles.length===p.cycles&&cycles.every(c=>Number.isFinite(c.closedRssBytes)&&c.closedRssBytes>0)){
        const rss=cycles.slice(p.warmupCycles).map(c=>c.closedRssBytes);summary={measuredCycles:rss.length,rssSlopeBytesPerCycle:slope(rss),rssDriftBytes:median(rss.slice(-3))-cycles[p.warmupCycles-1].closedRssBytes,sampledPeakRssBytes:Math.max(...samples.map(s=>s.rssBytes)),sampledPeakGrowthBytes:Math.max(...samples.map(s=>s.rssBytes))-samples[0].rssBytes,meanSampleMs:(samples.at(-1).elapsedMs-samples[0].elapsedMs)/(samples.length-1),maxSampleGapMs:Math.max(...samples.slice(1).map((s,i)=>s.elapsedMs-samples[i].elapsedMs))};
        require(summary.rssSlopeBytesPerCycle<=p.closedRssSlopeBytesPerCycle,'closed-rss-slope');require(summary.rssDriftBytes<=p.closedRssDriftBytes,'closed-rss-drift');require(summary.sampledPeakGrowthBytes<=p.browserPeakGrowthBytes,'browser-peak-growth');require(summary.meanSampleMs<=p.maxMeanSampleMs,'sparse-process-rss');
    }
    require(Array.isArray(r.errors)&&r.errors.length===0,'browser-errors');return {status:issues.length?'failed':'passed',issues,summary};
}
