import {test} from 'node:test';
import assert from 'node:assert/strict';
import {startView} from '../src/view-startup.js';

test('Netron error-then-resolve startup is rejected and original runtime error reporting is restored',async()=>{
    let calls=0;const report=()=>{calls++;},view={error:report,async start(){this.error(Error('private source /work/model.mlir'));}};
    await assert.rejects(startView(view),error=>error.message==='網站圖形介面初始化失敗。');
    assert.equal(calls,0);assert.equal(view.error,report);view.error();assert.equal(calls,1);
});
test('successful, pending and directly rejected starts preserve the view error handler on every terminal path',async()=>{
    const report=()=>{},error=Error('original initialization failure');
    const success={error:report,start:async()=>{}};await startView(success);assert.equal(success.error,report);
    const rejected={error:report,start:()=>Promise.reject(error)};await assert.rejects(startView(rejected),reason=>reason===error);assert.equal(rejected.error,report);
    let finish;const view={error:report,start:()=>new Promise(resolve=>{finish=resolve;})},pending=startView(view);
    assert.notEqual(view.error,report);finish();await pending;assert.equal(view.error,report);
});
