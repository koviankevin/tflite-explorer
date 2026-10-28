import {test} from 'node:test';
import assert from 'node:assert/strict';
import {LIFECYCLE_SOAK_POLICY as soak,assertSoakExecution,needsSoakCycle,evaluateLifecycleSoak} from './browser/lifecycle-soak-policy.mjs';
import {MODEL_EDIT_LIFECYCLE_POLICY as memory} from './browser/lifecycle-policy.mjs';

const env={GITHUB_ACTIONS:'true',GITHUB_REPOSITORY:'koviankevin/tflite-explorer',GITHUB_WORKFLOW:'Physical model two-hour soak',GITHUB_REF:'refs/heads/main',GITHUB_EVENT_NAME:'workflow_dispatch',LIFECYCLE_MODE:'soak'};
const MiB=1024**2;
function good(){
    return {format:'model-lens-lifecycle-soak',version:1,policy:memory,soakPolicy:soak,sourceUnchanged:true,environment:{sourceDirty:false},soak:{activeDurationMs:soak.minActiveMs,viewport:{width:1280,height:640}},fixture:{weightSHA256:'a'.repeat(64)},
        cycles:Array.from({length:64},(_,i)=>({cycle:i+1,font:32,editFont:32,activeStartMs:i*112500,activeEndMs:(i+1)*112500,weightVerified:true,optionsVerified:true,patternSourceMatches:1,patternReopenMatches:1,negativePatternMatches:0,fileInputEmpty:true,liveModelWorkers:0,activeBlobUrls:0,closedRssBytes:300*MiB,closedMainHeapBytes:10*MiB,workerHeaps:[{usedSize:1,backingStorageSize:0},{usedSize:2,backingStorageSize:3},{usedSize:3,backingStorageSize:4}],modelEdit:{sourceOperators:21005,outputOperators:21006,readbackOperators:21006,bytes:1349966000,weightVerified:true,optionsVerified:true,weightSHA256:'a'.repeat(64),roundTrip:true,prefixMatches:1,branchMatches:1,byteComparison:'passed',comparedBytes:1342177280,byteRanges:7,sha256:'b'.repeat(64),exportMs:1000}})),
        samples:Array.from({length:7201},(_,i)=>({activeElapsedMs:i*1000,rssBytes:300*MiB,mainHeapBytes:10*MiB}))};
}
test('two-hour soak requires hosted manual main CI before any browser launch',()=>{
    assert.doesNotThrow(()=>assertSoakExecution(env,'linux'));
    for(const [key,value] of Object.entries({GITHUB_ACTIONS:'false',GITHUB_REPOSITORY:'other/repo',GITHUB_WORKFLOW:'other',GITHUB_REF:'refs/pull/1/merge',GITHUB_EVENT_NAME:'push',LIFECYCLE_MODE:'quick'}))assert.throws(()=>assertSoakExecution({...env,[key]:value},'linux'),key);
    for(const os of ['win32','darwin'])assert.throws(()=>assertSoakExecution(env,os));
});
test('soak cannot finish early by duration, low operation count, partial batch or unbounded budget',()=>{
    assert.equal(needsSoakCycle(0,0),true);assert.equal(needsSoakCycle(64,soak.minActiveMs-1),true);assert.equal(needsSoakCycle(63,soak.minActiveMs),true);assert.equal(needsSoakCycle(65,soak.minActiveMs),true);assert.equal(needsSoakCycle(64,soak.minActiveMs),false);
    for(const [count,time] of [[128,1],[136,soak.minActiveMs],[64,soak.maxActiveMs+1],[-1,0],[1,NaN],[1,-1]])assert.throws(()=>needsSoakCycle(count,time));
});
test('soak accepts two hours of complete full-model operations with unchanged eight-cycle gates',()=>{
    const result=evaluateLifecycleSoak(good());assert.equal(result.status,'passed');assert.equal(result.batches.length,8);assert.equal(result.summary.measuredCycles,62);assert.equal(result.summary.rssSlopeBytesPerHour,0);
});
test('soak rejects missing duration, idle padding, time jumps, short or sparse measurement coverage',()=>{
    const mutations=[r=>r.soak.activeDurationMs--,r=>r.soak.activeDurationMs+=6000,r=>r.cycles.pop(),r=>r.cycles[2].activeStartMs+=6000,r=>r.cycles[4].activeEndMs=r.cycles[4].activeStartMs,r=>r.cycles[4].activeEndMs+=soak.maxCycleMs,r=>r.samples=r.samples.filter((_,i)=>i%2===0),r=>r.samples.splice(40,11),r=>r.samples[5].activeElapsedMs=-1,r=>r.samples.at(-1).activeElapsedMs=NaN,r=>r.samples=r.samples.slice(2),r=>r.samples=r.samples.slice(0,-2)];
    for(const [i,mutate] of mutations.entries()){const r=good();mutate(r);assert.equal(evaluateLifecycleSoak(r).status,'failed',String(i));}
});
test('soak rejects a late bad export, retained worker, changed limits or unverified source',()=>{
    for(const mutate of [r=>r.cycles[60].modelEdit.optionsVerified=false,r=>r.cycles[60].workerHeaps=[],r=>r.cycles[60].liveModelWorkers=1,r=>r.cycles[60].activeBlobUrls=1,r=>r.cycles[60].font=16,r=>r.soak.viewport.width=640,r=>r.sourceUnchanged=false,r=>r.environment.sourceDirty=true,r=>r.policy={...memory,closedRssDriftBytes:memory.closedRssDriftBytes*2},r=>r.soakPolicy={...soak,minActiveMs:1}]){const r=good();mutate(r);assert.equal(evaluateLifecycleSoak(r).status,'failed');}
});
test('soak catches slow sustained RSS growth that passes each original eight-cycle window',()=>{
    const r=good();for(const c of r.cycles)c.closedRssBytes+=c.activeEndMs/3600000*17*MiB;
    const result=evaluateLifecycleSoak(r);assert.ok(result.batches.every(b=>b.status==='passed'));assert.ok(result.issues.includes('soak-rss-slope'));
});
test('soak keeps the initial warm baseline and catches temporary late RSS/heap drift even after recovery',()=>{
    for(const [field,growth,issue] of [['closedRssBytes',129*MiB,'soak-closed-rss-drift'],['closedMainHeapBytes',33*MiB,'soak-main-heap-drift']]){
        const r=good();for(let i=16;i<48;i++)r.cycles[i][field]+=growth;
        const result=evaluateLifecycleSoak(r);assert.ok(result.issues.includes(issue));assert.ok(result.summary[field==='closedRssBytes'?'maxClosedRssDriftBytes':'maxClosedMainHeapDriftBytes']>growth-1);
    }
});
