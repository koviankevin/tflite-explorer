import {test} from 'node:test';
import assert from 'node:assert/strict';
import {LIFECYCLE_SOAK_POLICY as soak,assertSoakExecution,needsSoakCycle,evaluateLifecycleSoak} from './browser/lifecycle-soak-policy.mjs';
import {MODEL_EDIT_LIFECYCLE_POLICY as memory} from './browser/lifecycle-policy.mjs';
import {SOAK_RECOVERY_POLICY,SOAK_CAPACITY_MESSAGE,SoakRecoveryLedger,inspectSoakBackup,evaluateSoakRecovery} from './browser/soak-recovery.mjs';
import {exportEditSession} from '../src/model-edit-session.js';
import {runInNewContext} from 'node:vm';
import {savedDraftRows,observeRecoveryStatus} from './browser/soak-recovery.mjs';

const env={GITHUB_ACTIONS:'true',GITHUB_REPOSITORY:'koviankevin/tflite-explorer',GITHUB_WORKFLOW:'Physical model two-hour soak',GITHUB_REF:'refs/heads/main',GITHUB_EVENT_NAME:'workflow_dispatch',LIFECYCLE_MODE:'soak'};
const MiB=1024**2;
const fixture={file:'/tmp/physical.tflite',bytes:1349965216,editFingerprint:'c'.repeat(64),weightSHA256:'a'.repeat(64)};
const draft=i=>({format:'model-lens-edit-draft',version:1,source:{name:'physical.tflite',bytes:fixture.bytes,format:'tflite',algorithm:'sha256-chunks-v1',fingerprint:fixture.editFingerprint},scope:{nodes:[{graph:0,node:0},{graph:0,node:1}],selected:['op:0:0'],signature:'d'.repeat(64)},history:{commands:[{kind:'clone',node:'op:0:0',side:'after'},{kind:'expose',node:'new:1',enabled:true}],redo:[]},view:{selected:'new:1',zoom:1,font:32,left:i,top:0},options:{updateSignatures:false}});
function retainedDrafts(count){
    const records=new Map(),cycles=[];
    for(let i=0;i<count;i++){
        const savedKey=(i+1).toString(16).padStart(32,'0'),backup=inspectSoakBackup(exportEditSession(draft(i)),fixture);let capacity=null;
        if(i>=20){const beforeKeys=[...records.keys()],key=beforeKeys[0],old=records.get(key);records.delete(key);capacity={message:SOAK_CAPACITY_MESSAGE,key,backup:old,beforeKeys,afterRemoveKeys:[...records.keys()],afterRetryKeys:[...records.keys(),savedKey],remainingUnchanged:true,retrySaved:true};}
        records.set(savedKey,backup);cycles.push({recoveryStorage:{version:1,capacity,savedKey,backup,retainedKeys:[...records.keys()]}});
    }
    return cycles;
}
function preflight(){return {status:'passed',browserClosed:true,viewport:{width:1280,height:640},errors:[],cycles:retainedDrafts(22).map((c,i)=>({...c,cycle:i+1})),fixture,recoveryPolicy:SOAK_RECOVERY_POLICY,evaluation:evaluateSoakRecovery(retainedDrafts(22),fixture,SOAK_RECOVERY_POLICY),workers:Array.from({length:44},(_,i)=>({url:'http://localhost/src/'+(i%2?'edit-recovery-worker.js':'model-worker.js'),closed:true})),processCleanup:{identities:[{pid:123,startTicks:'456'}],remaining:[],allReaped:true}};}
function good(){
    const fast=preflight();fast.fixture={...fixture,bytes:4096};for(const c of fast.cycles){c.recoveryStorage.backup.sourceBytes=4096;if(c.recoveryStorage.capacity)c.recoveryStorage.capacity.backup.sourceBytes=4096;}fast.evaluation=evaluateSoakRecovery(fast.cycles,fast.fixture,fast.recoveryPolicy);
    return {format:'model-lens-lifecycle-soak',version:2,policy:memory,soakPolicy:soak,recoveryPolicy:SOAK_RECOVERY_POLICY,recoveryPreflight:fast,sourceUnchanged:true,environment:{sourceDirty:false},soak:{activeDurationMs:soak.minActiveMs,viewport:{width:1280,height:640}},fixture,
        cycles:retainedDrafts(64).map((storage,i)=>({...storage,cycle:i+1,font:32,editFont:32,activeStartMs:i*112500,activeEndMs:(i+1)*112500,weightVerified:true,optionsVerified:true,patternSourceMatches:1,patternReopenMatches:1,negativePatternMatches:0,fileInputEmpty:true,liveModelWorkers:0,activeBlobUrls:0,closedRssBytes:300*MiB,closedMainHeapBytes:10*MiB,workerHeaps:[{usedSize:1,backingStorageSize:0},{usedSize:2,backingStorageSize:3},{usedSize:3,backingStorageSize:4}],modelEdit:{sourceOperators:21005,outputOperators:21006,readbackOperators:21006,bytes:1349966000,weightVerified:true,optionsVerified:true,weightSHA256:'a'.repeat(64),roundTrip:true,prefixMatches:1,branchMatches:1,byteComparison:'passed',comparedBytes:1342177280,byteRanges:7,sha256:'b'.repeat(64),exportMs:1000}})),
        samples:Array.from({length:7201},(_,i)=>({activeElapsedMs:i*1000,rssBytes:300*MiB,mainHeapBytes:10*MiB})),workerClosures:Array.from({length:256},(_,i)=>({url:'http://localhost/src/'+(i%4===3?'edit-recovery-worker.js':'model-worker.js'),closed:true}))};
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
    for(const mutate of [r=>r.cycles[60].modelEdit.optionsVerified=false,r=>r.cycles[60].workerHeaps=[],r=>r.cycles[60].liveModelWorkers=1,r=>r.cycles[60].activeBlobUrls=1,r=>r.workerClosures[200].closed=false,r=>r.workerClosures.pop(),r=>delete r.workerClosures,r=>r.cycles[60].font=16,r=>r.soak.viewport.width=640,r=>r.sourceUnchanged=false,r=>r.environment.sourceDirty=true,r=>r.policy={...memory,closedRssDriftBytes:memory.closedRssDriftBytes*2},r=>r.soakPolicy={...soak,minActiveMs:1}]){const r=good();mutate(r);assert.equal(evaluateLifecycleSoak(r).status,'failed');}
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

test('draft ledger removes only the oldest final backup and preserves the other nineteen records',()=>{
    const cycles=retainedDrafts(22),ledger=new SoakRecoveryLedger(fixture);
    for(const c of cycles.slice(0,20)){const r=c.recoveryStorage;assert.equal(ledger.saved(r.retainedKeys,r.backup),r.savedKey);}
    const r=cycles[20].recoveryStorage,e=r.capacity;
    assert.throws(()=>ledger.oldest([...e.beforeKeys.slice(1),'f'.repeat(32)]),/unknown or missing/);
    assert.throws(()=>ledger.authorizeRemoval(e.beforeKeys,e.key,{...e.backup,sha256:'e'.repeat(64)}),/changed/);
    assert.throws(()=>ledger.authorizeRemoval(e.beforeKeys,e.beforeKeys[1],e.backup));
    assert.throws(()=>ledger.removed(e.beforeKeys,e.afterRemoveKeys.slice(1),e.key,e.backup));
    assert.equal(ledger.records.size,20);
    ledger.removed(e.beforeKeys,e.afterRemoveKeys,e.key,e.backup);assert.equal(ledger.records.size,19);
    ledger.saved(r.retainedKeys,r.backup);assert.equal(ledger.records.size,20);assert.equal(ledger.records.has(e.key),false);
    const next=cycles[21].recoveryStorage;ledger.removed(next.capacity.beforeKeys,next.capacity.afterRemoveKeys,next.capacity.key,next.capacity.backup);
    assert.throws(()=>ledger.saved([...ledger.records.keys(),e.key],r.backup),/resurrected/);
    ledger.saved(next.retainedKeys,next.backup);assert.equal(ledger.records.size,20);
});

test('only parseable original-source backups with the actual clone/expose history authorize retention',()=>{
    const text=exportEditSession(draft(1));assert.equal(inspectSoakBackup(text,fixture).font,32);
    for(const mutate of [d=>d.source.bytes--,d=>d.source.fingerprint='b'.repeat(64),d=>d.source.name='other.tflite',d=>d.source.format='mlir',d=>d.view.font=16,d=>d.view.selected='op:0:0',d=>d.history.commands.pop(),d=>d.history.commands[0].side='before',d=>d.history.redo.push(d.history.commands.pop()),d=>d.scope.nodes=d.scope.nodes.slice(1)]){
        const d=draft(1);mutate(d);assert.throws(()=>inspectSoakBackup(exportEditSession(d),fixture));
    }
    assert.throws(()=>inspectSoakBackup('{bad',fixture));assert.throws(()=>inspectSoakBackup(' '.repeat(256*1024+1),fixture));
});

test('soak v2 requires backup, ownership, unchanged retention, explicit capacity error and retry for every late cycle',()=>{
    assert.deepEqual(evaluateSoakRecovery(retainedDrafts(64),fixture,SOAK_RECOVERY_POLICY),{status:'passed',issues:[],saved:64,removed:44,retained:20});
    for(const mutate of [r=>r.version=1,r=>delete r.recoveryPolicy,r=>r.recoveryPolicy={...SOAK_RECOVERY_POLICY,capacity:21},r=>delete r.cycles[5].recoveryStorage,r=>r.cycles[5].recoveryStorage.backup.parsed=false,r=>r.cycles[5].recoveryStorage.backup.sourceBytes--,r=>r.cycles[5].recoveryStorage.backup.bytes=256*1024+1,r=>r.cycles[5].recoveryStorage.backup.commands=1,r=>r.cycles[5].recoveryStorage.backup.font=16,r=>r.cycles[5].recoveryStorage.retainedKeys.pop(),r=>r.cycles[19].recoveryStorage.capacity={},r=>r.cycles[20].recoveryStorage.capacity.message='quota exceeded',r=>r.cycles[20].recoveryStorage.capacity.backup={...r.cycles[20].recoveryStorage.capacity.backup,sha256:'e'.repeat(64)},r=>r.cycles[20].recoveryStorage.capacity.retrySaved=false,r=>r.cycles[20].recoveryStorage.capacity.remainingUnchanged=false,r=>r.cycles[20].recoveryStorage.capacity.afterRemoveKeys.pop(),r=>r.cycles[20].recoveryStorage.capacity.afterRetryKeys.pop(),r=>r.cycles[20].recoveryStorage.savedKey=r.cycles[0].recoveryStorage.savedKey,r=>r.cycles[60].recoveryStorage.capacity.key=r.cycles[60].recoveryStorage.savedKey]){
        const r=good();mutate(r);assert.equal(evaluateLifecycleSoak(r).status,'failed');
    }
});

test('small real capacity preflight cannot substitute for duration or omit workers/process cleanup',()=>{
    for(const mutate of [r=>delete r.recoveryPreflight,r=>r.recoveryPreflight.status='running',r=>r.recoveryPreflight.cycles.pop(),r=>r.recoveryPreflight.cycles[21].cycle=1,r=>r.recoveryPreflight.evaluation.status='failed',r=>r.recoveryPreflight.workers.pop(),r=>r.recoveryPreflight.workers[5].closed=false,r=>r.recoveryPreflight.processCleanup.remaining.push({pid:123,startTicks:'456'}),r=>r.recoveryPreflight.processCleanup.allReaped=false,r=>r.recoveryPreflight.browserClosed=false,r=>r.recoveryPreflight.errors.push('error'),r=>r.soak.activeDurationMs=1]){const r=good();mutate(r);assert.equal(evaluateLifecycleSoak(r).status,'failed');}
});

test('saved-draft observation stays atomic while the UI replaces twenty options with nineteen',async()=>{
    const initial=Array.from({length:20},(_,i)=>({value:(i+1).toString(16).padStart(32,'0'),textContent:`synthetic · v${i+1}`}));let options=[...initial],reads=0;
    const read=async fn=>{reads++;const snapshot=JSON.parse(JSON.stringify(runInNewContext('('+fn.toString()+')()',{document:{querySelectorAll:()=>options}})));options=options.slice(0,19);return snapshot;};
    assert.deepEqual(await savedDraftRows(read),initial.map((o,i)=>({key:o.value,revision:i+1})));
    assert.equal(reads,1);assert.equal((await savedDraftRows(read)).length,19);assert.equal(reads,2);
});

test('recovery status never combines old fingerprint progress with a new capacity-error flag',async()=>{
    let state={message:'背景核對原模型 100% · 完成保存前請保留此分頁',error:false};
    const next={message:SOAK_CAPACITY_MESSAGE,error:true},element={get textContent(){return state.message;},getAttribute:()=>String(state.error)};
    const read=async fn=>{const snapshot=JSON.parse(JSON.stringify(runInNewContext('('+fn.toString()+')()',{document:{querySelector:()=>element}})));state=next;return snapshot;};
    assert.equal(await observeRecoveryStatus(read),null);
    assert.equal(await observeRecoveryStatus(read),SOAK_CAPACITY_MESSAGE);
    assert.equal(await observeRecoveryStatus(async()=>({message:'已保存本機編輯草稿 · 第 1 版',error:'false'})),'已保存本機編輯草稿 · 第 1 版');
    assert.equal(await observeRecoveryStatus(async()=>({message:'quota denied',error:'true'})),'quota denied');
    for(const value of [null,{message:'pending',error:null},{message:'已保存本機編輯草稿',error:'true'}])await assert.rejects(observeRecoveryStatus(async()=>value));
});
