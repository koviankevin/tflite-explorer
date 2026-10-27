import {test} from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {evaluateLifecycle,LIFECYCLE_POLICY as policy,MODEL_EDIT_LIFECYCLE_POLICY,median,slope} from './browser/lifecycle-policy.mjs';
import {modelWorkerHeap} from './browser/worker-heap.mjs';

const good=()=>({cycles:Array.from({length:8},(_,i)=>({cycle:i+1,weightVerified:true,optionsVerified:true,patternSourceMatches:1,patternReopenMatches:1,negativePatternMatches:0,fileInputEmpty:true,liveModelWorkers:0,activeBlobUrls:0,closedRssBytes:300*1024**2,closedMainHeapBytes:10*1024**2,workerHeaps:[{usedSize:1,backingStorageSize:0},{usedSize:2,backingStorageSize:3}]})),samples:[{rssBytes:300*1024**2},{rssBytes:700*1024**2}]});
test('lifecycle gate accepts complete bounded eight-cycle measurements',()=>{
    const result=evaluateLifecycle(good());assert.equal(result.status,'passed');assert.equal(result.summary.measuredCycles,6);
    assert.equal(median([1,4,3,2]),2.5);assert.equal(slope([2,4,6]),2);
});
test('lifecycle gate rejects missing evidence and references left after close',()=>{
    for(const [field,value] of Object.entries({weightVerified:false,optionsVerified:false,patternSourceMatches:2,patternReopenMatches:0,negativePatternMatches:1,fileInputEmpty:false,liveModelWorkers:1,activeBlobUrls:1,closedRssBytes:null,closedMainHeapBytes:0,workerHeaps:[]})){
        const report=good();report.cycles[3][field]=value;assert.equal(evaluateLifecycle(report).status,'failed',field);
    }
    for(const change of [r=>r.cycles.pop(),r=>r.samples=[],r=>r.samples[1].rssBytes=null,r=>r.cycles[0].workerHeaps[0].backingStorageSize=undefined,r=>r.cycles[0].workerHeaps[0].usedSize=policy.modelWorkerUsedBytes+1]){const r=good();change(r);assert.equal(evaluateLifecycle(r).status,'failed');}
});
test('lifecycle gate rejects steady RSS accumulation, drift and peak growth',()=>{
    const r=good();r.cycles.forEach((c,i)=>c.closedRssBytes+=i*17*1024**2);assert.ok(evaluateLifecycle(r).issues.includes('closed-rss-slope'));
    const drift=good();drift.cycles.slice(2).forEach(c=>c.closedRssBytes+=129*1024**2);assert.ok(evaluateLifecycle(drift).issues.includes('closed-rss-drift'));
    const heap=good();heap.cycles.slice(2).forEach(c=>c.closedMainHeapBytes+=33*1024**2);assert.ok(evaluateLifecycle(heap).issues.includes('closed-main-heap-drift'));
    const peak=good();peak.samples[1].rssBytes=peak.samples[0].rssBytes+policy.browserPeakGrowthBytes+1;assert.ok(evaluateLifecycle(peak).issues.includes('sampled-browser-peak-growth'));
});
function goodEdit(){const report=good();report.policy=MODEL_EDIT_LIFECYCLE_POLICY;report.fixture={weightSHA256:'a'.repeat(64)};for(const c of report.cycles){c.workerHeaps.push({usedSize:3,backingStorageSize:4});c.modelEdit={sourceOperators:21005,outputOperators:21006,readbackOperators:21006,bytes:1349966000,weightVerified:true,optionsVerified:true,weightSHA256:'a'.repeat(64),roundTrip:true,prefixMatches:1,branchMatches:1,byteComparison:'passed',comparedBytes:1342177280,byteRanges:7,sha256:'b'.repeat(64),exportMs:1000};}return report;}
test('v2 lifecycle requires full physical model editing in all eight cycles under unchanged memory limits',()=>{
    assert.equal(evaluateLifecycle(goodEdit()).status,'passed');assert.equal(evaluateLifecycle(good()).status,'passed','Historical v1 reports remain usable.');
    assert.deepEqual({...MODEL_EDIT_LIFECYCLE_POLICY,version:1},policy);
    for(const [key,value] of Object.entries({sourceOperators:20000,outputOperators:21005,readbackOperators:4,bytes:1024**3,weightVerified:false,optionsVerified:false,weightSHA256:'c'.repeat(64),roundTrip:false,prefixMatches:0,branchMatches:2,byteComparison:'not-run',comparedBytes:1024,byteRanges:0,sha256:'bad',exportMs:0})){
        const r=goodEdit();r.cycles[3].modelEdit[key]=value;assert.ok(evaluateLifecycle(r).issues.includes('cycle-4-model-edit-incomplete'),key);
    }
    for(const mutate of [r=>delete r.cycles[3].modelEdit,r=>r.cycles[3].workerHeaps.pop()]){const r=goodEdit();mutate(r);assert.equal(evaluateLifecycle(r).status,'failed');}
});
class FakeCDP extends EventEmitter {
    calls=[];result={usedSize:12,totalSize:40,backingStorageSize:8};
    async send(method,args){this.calls.push({method,args});if(method==='Target.getTargets')return {targetInfos:[{type:'worker',url:'http://localhost/src/model-worker.js?v=123',targetId:'worker-1'}]};if(method==='Target.attachToTarget')return {sessionId:'session-1'};if(method==='Target.sendMessageToTarget' && this.result!==null)queueMicrotask(()=>this.emit('Target.receivedMessageFromTarget',{sessionId:'session-1',message:JSON.stringify({id:1,result:this.result})}));return {};}
}
test('Worker CDP reads actual isolate metrics and always detaches observer',async()=>{
    const cdp=new FakeCDP();assert.equal((await modelWorkerHeap(cdp)).backingStorageSize,8);assert.equal(cdp.listenerCount('Target.receivedMessageFromTarget'),0);assert.equal(cdp.calls.at(-1).method,'Target.detachFromTarget');
    for(const result of [null,{usedSize:12}]){const bad=new FakeCDP();bad.result=result;await assert.rejects(modelWorkerHeap(bad,{timeoutMs:10}),/timed out|unavailable/);assert.equal(bad.listenerCount('Target.receivedMessageFromTarget'),0);assert.equal(bad.calls.at(-1).method,'Target.detachFromTarget');}
});
