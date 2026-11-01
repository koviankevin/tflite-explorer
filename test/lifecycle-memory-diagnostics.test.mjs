import test from 'node:test';
import assert from 'node:assert/strict';
import {createProcessMemoryProbe} from './browser/process-memory-profile.mjs';
import {createLifecycleMemoryDiagnostics} from './browser/lifecycle-memory-diagnostics.mjs';
const identity={pid:12,startTicks:'12'},anchor=(elapsedMs=10,phase='cycle-1-release')=>({phase,elapsedMs,rssBytes:102400,processes:1,mainHeapBytes:32});
const procStat=(start='12')=>`12 (chrome) S 10 ${Array(17).fill('0').join(' ')} ${start} 0`;
const status='Name:\tchrome\nVmRSS:\t105 kB\nRssAnon:\t80 kB\nRssFile:\t20 kB\nRssShmem:\t5 kB\n';
function setup({readText=async p=>p.endsWith('/stat')?procStat():status}={}){
    const commands=[];let elapsed=20;
    const now=()=>elapsed,probe=createProcessMemoryProbe({now,readText});
    const browserCDP={send:async method=>{commands.push(method);assert.equal(method,'SystemInfo.getProcessInfo');return {processInfo:[{id:12,type:'renderer'},{id:999,type:'foreign'}]};}};
    const cdp={send:async method=>{commands.push(method);if(method==='Runtime.getHeapUsage')return {usedSize:32,totalSize:160,embedderHeapUsedSize:24,backingStorageSize:64};assert.equal(method,'Memory.getDOMCounters');return {documents:1,nodes:10,jsEventListeners:2};}};
    return {diagnostic:createLifecycleMemoryDiagnostics({now,probe,cdp,browserCDP}),commands,clock:value=>elapsed=value};
}
const metrics=[{name:'JSHeapUsedSize',value:32},{name:'JSHeapTotalSize',value:128}];
test('supplementary real probe keeps RSS anchor/differences and only queries readonly owned-process metadata',async()=>{
    const {diagnostic,commands}=setup(),sample=anchor(),before=structuredClone(sample);await diagnostic.capture(0,[identity],sample,metrics);
    const p=diagnostic.finish([sample]);assert.deepEqual(sample,before);assert.equal(p.summary.completeObservations,1);assert.equal(p.samples[0].gateRssBytes,102400);assert.equal(p.samples[0].totals.rssBytes,107520);assert.equal(p.samples[0].differenceFromGateRSSBytes,5120);
    assert.deepEqual(commands.sort(),['Memory.getDOMCounters','Runtime.getHeapUsage','SystemInfo.getProcessInfo']);assert.equal(p.releaseEvidenceEligible,false);assert.equal(p.forcedGC,false);
    assert.deepEqual(p.details[0].processes,[{...identity,observation:'present',type:'renderer'}]);assert.deepEqual(p.details[0].performanceHeap,{usedBytes:32,totalBytes:128});assert.equal(p.details[0].runtimeHeap.backingStorageSize,64);assert.equal(p.details[0].runtimeHeap.embedderHeapUsedSize,24);
});
test('phase/ten-second detail cadence does not suppress the original per-sample native observations',async()=>{
    const {diagnostic,commands,clock}=setup(),samples=[anchor(),anchor(100),anchor(10011),anchor(10012,'cycle-2-source')];
    for(const [i,s]of samples.entries()){clock(s.elapsedMs+1);await diagnostic.capture(i,[identity],s,metrics);}
    const p=diagnostic.finish(samples);assert.equal(p.samples.length,4);assert.equal(p.details.length,3);assert.equal(commands.length,9);assert.equal(p.summary.observations,4);
});
test('overlapping captures retain their original sample indices rather than completion order',async()=>{
    let release;const barrier=new Promise(resolve=>release=resolve);let reads=0;
    const {diagnostic,clock}=setup({readText:async p=>{if(++reads===1)await barrier;return p.endsWith('/stat')?procStat():status;}}),samples=[anchor(),anchor(11)];clock(30);
    const first=diagnostic.capture(0,[identity],samples[0],metrics);await diagnostic.capture(1,[identity],samples[1],metrics);release();await first;
    const p=diagnostic.finish(samples);assert.deepEqual(p.samples.map(s=>s.elapsedMs),[10,11]);assert.equal(p.summary.completeObservations,2);
});
test('exited/reused processes remain missing observations and cannot be attributed to a foreign replacement',async()=>{
    const {diagnostic}=setup({readText:async p=>p.endsWith('/stat')?procStat('999'):status}),sample=anchor();await diagnostic.capture(0,[identity],sample,metrics);const p=diagnostic.finish([sample]);assert.equal(p.summary.completeObservations,0);assert.equal(p.summary.reusedPidObservations,1);assert.equal(p.samples[0].totals.rssBytes,null);assert.equal(p.details[0].processes[0].type,'unknown');
});
test('supplementary records only admit identity and numeric counters, never caller annotations or model paths',async()=>{
    const {diagnostic}=setup(),sample=anchor();await diagnostic.capture(0,[{...identity,modelPath:'private/model.tflite',token:'secret'}],sample,[...metrics,{name:'private/model.tflite',value:1}]);const serialized=JSON.stringify(diagnostic.finish([sample]));assert.ok(!serialized.includes('private/model'));assert.ok(!serialized.includes('secret'));
});
test('missing, repeated, mismatched and out-of-budget sample anchors fail rather than inventing data',async()=>{
    const {diagnostic}=setup(),sample=anchor();await assert.rejects(diagnostic.capture(0,[],sample,metrics));await assert.rejects(diagnostic.capture(4000,[identity],sample,metrics));await diagnostic.capture(0,[identity],sample,metrics);await assert.rejects(diagnostic.capture(0,[identity],sample,metrics));assert.throws(()=>diagnostic.finish([sample,anchor(11)]),/Missing/);
});

test('an unexpected stream of phase changes is bounded before more readonly CDP requests are issued',async()=>{
    const {diagnostic,clock,commands}=setup();for(let i=0;i<512;i++){const s=anchor(i+10,`cycle-1-phase-${i}`);clock(i+11);await diagnostic.capture(i,[identity],s,metrics);}
    const before=commands.length;clock(1000);await assert.rejects(diagnostic.capture(512,[identity],anchor(999,'cycle-1-excess'),metrics),/detail budget/);assert.equal(commands.length,before);
});
