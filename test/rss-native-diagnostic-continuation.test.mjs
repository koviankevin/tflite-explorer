import {test} from 'node:test';
import assert from 'node:assert/strict';
import {afterRSSDiagnostics} from './browser/rss-native-diagnostic-continuation.mjs';
const failure=()=>Object.assign(Error('original RSS failure'),{desktopRuntimeRSS:{browserClosed:true,processCleanup:{allReaped:true},evaluation:{status:'failed',summary:{closedRssSlopeBytesPerCycle:18691686.4},issues:['closed-rss-slope']}},diagnosticContinuation:{originalFailurePreserved:true,coldError:'earlier cold error'}});

test('complete numerical RSS failure remains the identical primary error after a successful native diagnosis',async()=>{
    const original=failure(),diagnostic={status:'passed'};let calls=0;await assert.rejects(afterRSSDiagnostics(async()=>{throw original;},async()=>{calls++;return diagnostic;}),error=>{assert.equal(error,original);assert.equal(error.firefoxNativeControl,diagnostic);assert.equal(error.message,'original RSS failure');assert.equal(error.diagnosticContinuation.coldError,'earlier cold error');return true;});assert.equal(calls,1);
});
test('failed native diagnosis cannot replace original numerical failure or earlier cold evidence',async()=>{
    const original=failure(),diagnostic={status:'failed'},error=Object.assign(Error('native unavailable'),{firefoxNativeControl:diagnostic});await assert.rejects(afterRSSDiagnostics(async()=>{throw original;},async()=>{throw error;}),actual=>{assert.equal(actual,original);assert.equal(actual.firefoxNativeControl,diagnostic);assert.match(actual.diagnosticContinuation.nativeMemoryError,/native unavailable/);assert.equal(actual.diagnosticContinuation.coldError,'earlier cold error');return true;});
});
test('protocol failures or live processes stop before collecting any native report',async()=>{
    for(const change of [r=>r.browserClosed=false,r=>r.processCleanup.allReaped=false,r=>r.evaluation.issues=['worker-close'],r=>r.evaluation.summary=null]){const error=failure();change(error.desktopRuntimeRSS);let calls=0;await assert.rejects(afterRSSDiagnostics(async()=>{throw error;},async()=>{calls++;}),actual=>actual===error);assert.equal(calls,0);}
});
test('successful RSS preserves outcome while native failures remain visible and no collector is inert',async()=>{
    const value={rss:{status:'passed'},cold:{status:'passed'}},diagnostic={status:'passed'};assert.deepEqual(await afterRSSDiagnostics(async()=>value,async()=>diagnostic),{...value,firefoxNativeControl:diagnostic});const error=Error('native failure');await assert.rejects(afterRSSDiagnostics(async()=>value,async()=>{throw error;}),e=>e===error);assert.equal(await afterRSSDiagnostics(async()=>value,null),value);
});
