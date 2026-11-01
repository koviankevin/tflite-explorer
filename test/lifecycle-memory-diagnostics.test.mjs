import {mkdir,mkdtemp,readFile,rm} from 'node:fs/promises';
import {spawnSync} from 'node:child_process';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
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

test('every RSS anchor retains heap capacity and explicit settle points retain backing details',async()=>{
    const {diagnostic,commands,clock}=setup(),samples=[anchor(),anchor(11),anchor(12)];
    for(const [i,s]of samples.entries()){clock(s.elapsedMs+1);await diagnostic.capture(i,[identity],s,[{name:'JSHeapUsedSize',value:32},{name:'JSHeapTotalSize',value:128+i}],{settle:i===2});}
    const p=diagnostic.finish(samples);assert.deepEqual(p.samples.map(s=>s.performanceHeap.totalBytes),[128,129,130]);assert.equal(p.details.length,2);assert.equal(p.details[1].trigger,'settle');assert.equal(commands.length,6);
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

// Execute the actual entry point and stop at its first resource preflight.
// No physical fixture, application build or browser is created. The synthetic
// platform and fs boundary are confined to this disposable child process.
test('actual lifecycle entry admits readonly diagnostic mode before resource checks and rejects unknown modes',async()=>{
    const build=fileURLToPath(new URL('../build/',import.meta.url));await mkdir(build,{recursive:true});
    const directory=await mkdtemp(path.join(build,'lifecycle-entry-'));
    try{
        for(const mode of ['memory-diagnostic','gate','unknown-profile']){
            const report=path.join(directory,mode+'.json');
            const code=`import fs from 'node:fs';import {syncBuiltinESMExports} from 'node:module';Object.defineProperty(process,'platform',{value:'linux'});fs.promises.statfs=async()=>{throw Error('ENTRY_TEST_RESOURCE_BOUNDARY');};syncBuiltinESMExports();await import(${JSON.stringify(new URL('./browser/model-lifecycle.mjs',import.meta.url).href)});`;
            const result=spawnSync(process.execPath,['--input-type=module','-e',code],{env:{...process.env,LIFECYCLE_MODE:mode,LIFECYCLE_REPORT:report},encoding:'utf8',timeout:20000,windowsHide:true});
            assert.equal(result.error,undefined);assert.equal(result.status,1);
            const r=JSON.parse(await readFile(report,'utf8').catch(error=>assert.fail(`${error.message}\n${result.stderr}\n${result.stdout}`)));assert.equal(r.status,'failed');assert.deepEqual(r.cycles,[]);assert.deepEqual(r.samples,[]);assert.equal(r.fixture,undefined);assert.equal(r.environment,undefined);
            assert.match(r.error,mode==='unknown-profile'?/Unknown lifecycle profile/:/ENTRY_TEST_RESOURCE_BOUNDARY/);
            if(mode==='memory-diagnostic'){assert.equal(r.purpose,'readonly-native-memory-attribution');assert.equal(r.releaseEvidenceEligible,false);assert.equal(r.forcedGC,false);}
        }
    }finally{await rm(directory,{recursive:true,force:true});}
});
