import {evaluateLifecycle,MODEL_EDIT_LIFECYCLE_POLICY,median} from './lifecycle-policy.mjs';

const hour=60*60*1000,MiB=1024**2;
// This is an additional duration gate. It cannot replace the immutable eight
// cycle release gate, and does not take caller-selected durations or limits.
export const LIFECYCLE_SOAK_POLICY=Object.freeze({version:1,minActiveMs:2*hour,maxActiveMs:2.5*hour,minCycles:64,maxCycles:128,batchCycles:8,
    maxCycleMs:5*60*1000,maxIntercycleGapMs:5000,maxSampleGapMs:10000,maxMeanSampleMs:1000,closedRssSlopeBytesPerHour:16*MiB});

export function assertSoakExecution(env,platform){
    if(platform!=='linux'||env.GITHUB_ACTIONS!=='true'||env.GITHUB_REPOSITORY!=='koviankevin/tflite-explorer'||env.GITHUB_WORKFLOW!=='Physical model two-hour soak'||env.GITHUB_REF!=='refs/heads/main'||env.GITHUB_EVENT_NAME!=='workflow_dispatch'||env.LIFECYCLE_MODE!=='soak')throw Error('Two-hour soak is restricted to this repository on hosted main CI.');
}
export function needsSoakCycle(cycles,elapsedMs){
    if(!Number.isSafeInteger(cycles)||cycles<0||!Number.isFinite(elapsedMs)||elapsedMs<0)throw Error('Missing monotonic soak progress.');
    const p=LIFECYCLE_SOAK_POLICY,needed=cycles<p.minCycles||cycles%p.batchCycles!==0||elapsedMs<p.minActiveMs;
    if(cycles>p.maxCycles||elapsedMs>p.maxActiveMs||needed&&cycles>=p.maxCycles)throw Error('Two-hour soak exceeded its fixed time/cycle budget.');
    return needed;
}
function timedSlope(rows){
    const xs=rows.map(c=>c.activeEndMs/3600000),ys=rows.map(c=>c.closedRssBytes),x=xs.reduce((a,b)=>a+b,0)/xs.length,y=ys.reduce((a,b)=>a+b,0)/ys.length;
    return xs.reduce((n,v,i)=>n+(v-x)*(ys[i]-y),0)/xs.reduce((n,v)=>n+(v-x)**2,0);
}
export function evaluateLifecycleSoak(report){
    const p=LIFECYCLE_SOAK_POLICY,r=report||{},issues=[],batches=[],cycles=Array.isArray(r.cycles)?r.cycles:[],samples=Array.isArray(r.samples)?r.samples:[];
    const require=(value,name)=>{if(!value)issues.push(name);},same=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
    require(r.format==='model-lens-lifecycle-soak'&&r.version===1,'wrong-soak-format');
    require(same(r.policy,MODEL_EDIT_LIFECYCLE_POLICY)&&same(r.soakPolicy,p),'changed-soak-limits');
    require(r.sourceUnchanged===true&&r.environment?.sourceDirty===false,'missing-clean-unchanged-source');
    require(cycles.length>=p.minCycles&&cycles.length<=p.maxCycles&&cycles.length%p.batchCycles===0,'missing-soak-cycles');
    require(same(r.soak?.viewport,{width:1280,height:640})&&cycles.every(c=>c?.font===32&&c?.editFont===32),'missing-laptop-32px');
    const elapsed=r.soak?.activeDurationMs;
    require(Number.isFinite(elapsed)&&elapsed>=p.minActiveMs&&elapsed<=p.maxActiveMs,'missing-two-hour-duration');
    const objects=cycles.every(c=>c&&typeof c==='object');
    const times=objects&&cycles.length>0&&cycles.every((c,i)=>c.cycle===i+1&&Number.isFinite(c.activeStartMs)&&Number.isFinite(c.activeEndMs)&&c.activeStartMs>=0&&c.activeEndMs>c.activeStartMs&&c.activeEndMs-c.activeStartMs<=p.maxCycleMs&&c.activeStartMs-(i?cycles[i-1].activeEndMs:0)>=0&&c.activeStartMs-(i?cycles[i-1].activeEndMs:0)<=p.maxIntercycleGapMs);
    require(times&&Number.isFinite(elapsed)&&elapsed>=cycles.at(-1)?.activeEndMs&&elapsed-cycles.at(-1)?.activeEndMs<=p.maxIntercycleGapMs,'uncovered-soak-duration');
    if(objects)for(let at=0;at<cycles.length;at+=p.batchCycles){
        const batch=evaluateLifecycle({...r,cycles:cycles.slice(at,at+p.batchCycles).map((c,i)=>({...c,cycle:i+1}))},MODEL_EDIT_LIFECYCLE_POLICY);
        batches.push({firstCycle:at+1,lastCycle:Math.min(at+p.batchCycles,cycles.length),...batch});
        require(batch.status==='passed',`batch-${at/p.batchCycles+1}-failed`);
    }
    const active=samples.filter(s=>s&&Number.isFinite(s.activeElapsedMs));
    const coverage=Number.isFinite(elapsed)&&active.length>=2&&active.every((s,i)=>s.activeElapsedMs>=0&&s.activeElapsedMs<=elapsed+p.maxMeanSampleMs&&(!i||s.activeElapsedMs>active[i-1].activeElapsedMs)&&(!i||s.activeElapsedMs-active[i-1].activeElapsedMs<=p.maxSampleGapMs))&&active[0].activeElapsedMs<=p.maxMeanSampleMs&&elapsed-active.at(-1).activeElapsedMs<=p.maxMeanSampleMs&&elapsed/(active.length-1)<=p.maxMeanSampleMs;
    require(coverage,'missing-continuous-soak-samples');
    let summary=null;
    if(times&&batches.length&&batches.every(b=>b.status==='passed')&&coverage){
        const measured=cycles.slice(MODEL_EDIT_LIFECYCLE_POLICY.warmupCycles),baseline=cycles[MODEL_EDIT_LIFECYCLE_POLICY.warmupCycles-1],rss=measured.map(c=>c.closedRssBytes),heap=measured.map(c=>c.closedMainHeapBytes);
        const rollingMax=values=>Math.max(...values.map((_,i)=>median(values.slice(Math.max(0,i-2),i+1))));
        summary={activeDurationMs:elapsed,cycles:cycles.length,measuredCycles:measured.length,batches:batches.length,rssSlopeBytesPerHour:timedSlope(measured),maxClosedRssDriftBytes:rollingMax(rss)-baseline.closedRssBytes,maxClosedMainHeapDriftBytes:rollingMax(heap)-baseline.closedMainHeapBytes,meanSampleMs:elapsed/(active.length-1),maxSampleGapMs:Math.max(...active.slice(1).map((s,i)=>s.activeElapsedMs-active[i].activeElapsedMs))};
        require(Number.isFinite(summary.rssSlopeBytesPerHour)&&summary.rssSlopeBytesPerHour<=p.closedRssSlopeBytesPerHour,'soak-rss-slope');
        require(summary.maxClosedRssDriftBytes<=MODEL_EDIT_LIFECYCLE_POLICY.closedRssDriftBytes,'soak-closed-rss-drift');
        require(summary.maxClosedMainHeapDriftBytes<=MODEL_EDIT_LIFECYCLE_POLICY.closedMainHeapDriftBytes,'soak-main-heap-drift');
    }
    return {status:issues.length?'failed':'passed',issues,summary,batches};
}
