import test from 'node:test';
import assert from 'node:assert/strict';
import {assertSharedTimeoutProof} from './browser/shared-timeout-proof.mjs';

const build='6d032862ea5b71d5',infinite='e24ec3ce32ef0f49ddc49ac1ac630d68185dcb0d5ffb7ca8de9c840198cafe77';
function observed(){
    const url=`https://example.test/versions/${build}/src/tflite-runtime-worker.js?v=${build}`,id='run-123:runtime:3';
    const active={deadlineMs:30000,networkHeld:false,fakeTimers:false,preservedOriginalTabs:true,fixture:{bytes:2300,infiniteSHA256:infinite},runtimeWorkers:[{id,url,startedAt:100000,closed:true,closedAt:132000,lifetimeMs:32000}],timeoutObservation:{eventId:id,fixtureSHA256:infinite,invokeObservedAt:100100,status:'not-verified',reason:'超過 30 秒，已終止 Worker',downloadDisabled:true,checkEnabled:true}};
    const guide={runtimeWorkers:[{id,url,createdObservedAt:100000,closed:true,closeObservedAt:132000}],busyExecution:{sharedWithActiveCompute:true,fixture:{bytes:2300,sha256:infinite},workerId:id,nativeHandleMatched:true,networkHeld:false,fakeTimers:false,deadlineMs:30000,invokeObservedAt:100100,disabledObservedAt:100200},busyCompletion:{wasDisabled:true,status:'not-verified',reason:'actual30s-timeout',guideOpen:true,reEnabled:true,completedObservedAt:132100,editNavigated:true,runControlsRecovered:true,draftPreserved:true}};
    return {guide,active};
}
const verify=({guide,active})=>assertSharedTimeoutProof(guide,active,{expectedBuild:build,expectedInfiniteSHA256:infinite});
test('one real timeout can carry both guide and execution assertions with a shared worker identity',()=>{
    const record=observed(),before=structuredClone(record),proof=verify(record);
    assert.equal(proof.workerLifetimeMs,32000);assert.equal(proof.fixtureSHA256,infinite);assert.equal(proof.workerId,record.active.timeoutObservation.eventId);assert.equal(proof.status,'passed');assert.deepEqual(record,before);
});
for(const [name,mutate] of [
    ['another model',r=>r.guide.busyExecution.fixture.sha256='0'.repeat(64)],
    ['another build',r=>r.guide.runtimeWorkers[0].url=r.guide.runtimeWorkers[0].url.replace(build,'bad-build')],
    ['another native worker',r=>r.guide.busyExecution.workerId='other-worker'],
    ['unmatched native handle',r=>r.guide.busyExecution.nativeHandleMatched=false],
    ['duplicate matching worker',r=>r.active.runtimeWorkers.push({...r.active.runtimeWorkers[0]})],
    ['early worker close',r=>{r.active.runtimeWorkers[0].closedAt=101000;r.active.runtimeWorkers[0].lifetimeMs=1000;}],
    ['unclosed guide worker',r=>r.guide.runtimeWorkers[0].closed=false],
    ['stale guide busy observation',r=>r.guide.busyExecution.disabledObservedAt=133000],
    ['guide not refreshed',r=>r.guide.busyCompletion.reEnabled=false],
    ['guide was closed at completion',r=>r.guide.busyCompletion.guideOpen=false],
    ['navigation not tested',r=>r.guide.busyCompletion.editNavigated=false],
    ['run controls not restored',r=>r.guide.busyCompletion.runControlsRecovered=false],
    ['original draft lost',r=>r.guide.busyCompletion.draftPreserved=false],
    ['original model tabs lost',r=>r.active.preservedOriginalTabs=false],
    ['network-held simulation',r=>r.active.networkHeld=true],
    ['fake timer',r=>r.guide.busyExecution.fakeTimers=true],
    ['shortened deadline',r=>r.active.deadlineMs=1000],
    ['download still enabled',r=>r.active.timeoutObservation.downloadDisabled=false],
    ['run still disabled',r=>r.active.timeoutObservation.checkEnabled=false],
    ['kernel error instead of timeout',r=>r.active.timeoutObservation.reason='Failed to allocate tensors'],
    ['missing shared event',r=>delete r.active.timeoutObservation]
])test(`shared timeout rejects ${name}`,()=>{const record=observed();mutate(record);assert.throws(()=>verify(record));});
