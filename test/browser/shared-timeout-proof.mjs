import assert from 'node:assert/strict';

// This validates the joint report; the producer must also match the two
// observers' actual Playwright Worker handle while the kernel is running.
// A saved report alone is never permission to skip a new execution.
export function assertSharedTimeoutProof(guide,active,{expectedBuild,expectedInfiniteSHA256}){
    assert.match(expectedBuild,/^[a-f0-9]{16}$/);assert.match(expectedInfiniteSHA256,/^[a-f0-9]{64}$/);
    const execution=guide.busyExecution,completion=guide.busyCompletion,event=active.timeoutObservation;
    assert.ok(execution&&completion&&event);assert.equal(execution.sharedWithActiveCompute,true);assert.equal(execution.nativeHandleMatched,true);
    for(const record of [execution,active]){assert.equal(record.deadlineMs,30000);assert.equal(record.networkHeld,false);assert.equal(record.fakeTimers,false);}
    assert.equal(active.preservedOriginalTabs,true);assert.equal(active.fixture.infiniteSHA256,expectedInfiniteSHA256);assert.equal(execution.fixture.sha256,expectedInfiniteSHA256);assert.equal(event.fixtureSHA256,expectedInfiniteSHA256);assert.equal(execution.fixture.bytes,active.fixture.bytes);
    // Restoring the original tab opens a new model Worker after each temporary
    // model closes. The parent guide must finish and close these too.
    assert.equal(active.restoredModelWorkers?.length,3);assert.equal(new Set(active.restoredModelWorkers.map(w=>w.id)).size,3);
    for(const restored of active.restoredModelWorkers){assert.equal(restored.closed,true);const source=new URL(restored.url);assert.ok(source.pathname.endsWith('/src/model-worker.js'));assert.equal(source.searchParams.get('v'),expectedBuild);}
    assert.ok(typeof event.eventId==='string'&&event.eventId.length>0);assert.equal(execution.workerId,event.eventId);
    const one=(rows,id)=>{const found=rows.filter(w=>w.id===id);assert.equal(found.length,1);return found[0];};
    const native=one(active.runtimeWorkers,event.eventId),peer=one(guide.runtimeWorkers,event.eventId);
    assert.equal(native.closed,true);assert.equal(peer.closed,true);assert.equal(peer.url,native.url);
    const url=new URL(native.url);assert.ok(url.pathname.endsWith('/src/tflite-runtime-worker.js'));assert.equal(url.searchParams.get('v'),expectedBuild);
    for(const n of [native.startedAt,native.closedAt,peer.createdObservedAt,peer.closeObservedAt,event.invokeObservedAt,execution.invokeObservedAt,execution.disabledObservedAt,completion.completedObservedAt])assert.ok(Number.isSafeInteger(n)&&n>0);
    assert.equal(event.invokeObservedAt,execution.invokeObservedAt);
    assert.ok(Math.max(native.startedAt,peer.createdObservedAt)<=event.invokeObservedAt&&event.invokeObservedAt<=execution.disabledObservedAt&&execution.disabledObservedAt<Math.min(native.closedAt,peer.closeObservedAt)&&Math.max(native.closedAt,peer.closeObservedAt)<=completion.completedObservedAt);
    assert.equal(native.lifetimeMs,native.closedAt-native.startedAt);assert.ok(native.lifetimeMs>=25000&&native.lifetimeMs<=40000);assert.ok(peer.closeObservedAt-peer.createdObservedAt>=25000&&peer.closeObservedAt-peer.createdObservedAt<=40000);
    assert.equal(event.status,'not-verified');assert.match(event.reason,/超過 30 秒.*終止 Worker/);assert.equal(event.downloadDisabled,true);assert.equal(event.checkEnabled,true);
    assert.equal(completion.status,'not-verified');assert.equal(completion.reason,'actual30s-timeout');
    for(const key of ['wasDisabled','guideOpen','reEnabled','editNavigated','runControlsRecovered','draftPreserved'])assert.equal(completion[key],true);
    return {status:'passed',workerId:event.eventId,fixtureSHA256:expectedInfiniteSHA256,build:expectedBuild,workerLifetimeMs:native.lifetimeMs,guideAndExecutionObservedSameNativeHandle:true};
}
