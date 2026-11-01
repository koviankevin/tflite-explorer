// Hosted-only real CPU loop. No route holds, fake timers or app API calls.
// The website owns the Worker and enforces its normal thirty-second limit.
import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {createHash,randomUUID} from 'node:crypto';
import path from 'node:path';
import {runtimeLoopFixture} from '../runtime-loop-fixture.mjs';
import {runtimePlan,RUNTIME_LIMITS} from '../../src/tflite-runtime-policy.js';
import {Archive} from '../../vendor/netron/zip.js';
export async function activeComputeFlow({page,read,directory,check,preserveModelTabs=false,beforeTimeout,afterTimeout}){
    assert.equal(process.env.GITHUB_ACTIONS,'true');assert.equal(process.platform,'linux');assert.equal(RUNTIME_LIMITS.timeoutMs,30000);
    const report={cases:[],runtimeWorkers:[],modelWorkers:[],restoredModelWorkers:[],deadlineMs:RUNTIME_LIMITS.timeoutMs,networkHeld:false,fakeTimers:false},hash=bytes=>createHash('sha256').update(bytes).digest('hex'),executionId=randomUUID(),handles=new WeakMap();let restoringOriginalTabs=false;
    const originalTabs=preserveModelTabs?await read(()=>Array.from(document.querySelectorAll('[data-model-tab]'),e=>e.getAttribute('data-model-tab'))):[];
    if(preserveModelTabs)assert.ok(originalTabs.length>0);
    const worker=w=>{const list=/\/tflite-runtime-worker\.js(?:\?|$)/.test(w.url())?report.runtimeWorkers:/\/model-worker\.js(?:\?|$)/.test(w.url())?(restoringOriginalTabs?report.restoredModelWorkers:report.modelWorkers):null;if(list){const row={id:executionId+':'+(list===report.runtimeWorkers?'runtime':list===report.restoredModelWorkers?'restored':'model')+':'+(list.length+1),url:w.url(),startedAt:Date.now(),closed:false};list.push(row);handles.set(row,w);w.on('close',()=>{row.closed=true;row.closedAt=Date.now();row.lifetimeMs=row.closedAt-row.startedAt;});}};
    const until=async(fn,...args)=>{const end=Date.now()+45000;while(!await read(fn,...args)){if(Date.now()>end)throw Error('Active CPU DOM timeout: '+fn);await new Promise(r=>setTimeout(r,60));}};
    const choose=async(file,button='#open-model')=>{const next=page.waitForEvent('filechooser');await page.locator(button).click();await(await next).setFiles(file);};
    const ready=()=>until(()=>document.querySelector('#model-tabs').getAttribute('aria-busy')!=='true'&&document.querySelector('#loading-card').hidden&&document.querySelector('#target').getAttribute('aria-busy')==='false'&&document.querySelector('#layer-count').textContent!=='—');
    const opened=async(file)=>{await choose(file);await ready();const n=report.runtimeWorkers.length;await page.locator('#run-mode').click();await until(()=>document.querySelector('#run-workspace').getAttribute('aria-busy')==='false'&&document.querySelectorAll('#run-interface p').length===2);assert.equal(report.runtimeWorkers.length,n);};
    const close=async()=>{
        if(!preserveModelTabs){await page.locator('#close-model').click();await until(()=>document.querySelector('#model-tabs').hidden);return;}
        restoringOriginalTabs=true;
        try{await page.locator('.model-tab:has([data-model-tab][aria-selected="true"]) .close-model-tab').click();await until(ids=>{const tabs=Array.from(document.querySelectorAll('[data-model-tab]'),e=>e.getAttribute('data-model-tab'));return tabs.length===ids.length&&tabs.every((id,i)=>id===ids[i]);},originalTabs);await ready();assert.deepEqual(await read(()=>Array.from(document.querySelectorAll('[data-model-tab]'),e=>e.getAttribute('data-model-tab'))),originalTabs);}finally{restoringOriginalTabs=false;}
    };
    async function start(input){
        const n=report.runtimeWorkers.length;await page.locator('#edit-runtime-check').click();await until(()=>document.querySelector('#edit-runtime-dialog').open);
        if(input){await page.locator('#runtime-input-mode-0').selectOption('bin');await choose(input,'#runtime-input-file-0');}
        await page.locator('#edit-runtime-run').click();assert.ok(report.runtimeWorkers.length<=n+1);return n;
    }
    const invoked=()=>until(()=>document.querySelector('#run-workspace').getAttribute('aria-busy')==='true'&&document.querySelector('#run-progress').textContent.includes('使用指定測試輸入執行'));
    async function finished(status){
        await until(()=>document.querySelector('#run-workspace').getAttribute('aria-busy')==='false'&&!!document.querySelector('#edit-runtime-result').dataset.status);
        const state=await read(()=>({status:document.querySelector('#edit-runtime-result').dataset.status,detail:document.querySelector('#edit-runtime-result').textContent,downloadDisabled:document.querySelector('#edit-runtime-download').disabled,checkEnabled:!document.querySelector('#edit-runtime-check').disabled}));assert.equal(state.status,status,JSON.stringify(state));
        const end=Date.now()+5000;while(report.runtimeWorkers.some(w=>!w.closed)&&Date.now()<end)await new Promise(r=>setTimeout(r,30));assert.ok(report.runtimeWorkers.every(w=>w.closed));return state;
    }
    async function saveIO(name,expectedSHA){
        const event=page.waitForEvent('download');await page.locator('#edit-runtime-download').click();const item=await event;assert.equal(await item.failure(),null);const file=path.join(directory,name);await item.saveAs(file);await item.delete();const bytes=await readFile(file),zip=Archive.open(new Uint8Array(bytes),'zip'),manifest=JSON.parse(new TextDecoder().decode(zip.entries.get('manifest.json').peek()));assert.equal(manifest.modelSHA256,expectedSHA);const output=Array.from(new Float32Array(zip.entries.get('outputs-0.bin').peek().slice().buffer));assert.deepEqual(output,[7]);return {sha256:hash(bytes),modelSHA256:manifest.modelSHA256,output};
    }
    page.on('worker',worker);
    try{
        await page.bringToFront();report.visibility=await read(()=>document.visibilityState);assert.equal(report.visibility,'visible');
        const finite=await runtimeLoopFixture(false),infinite=await runtimeLoopFixture(true),delta=[];assert.equal(finite.bytes.length,infinite.bytes.length);for(let i=0;i<finite.bytes.length;i++)if(finite.bytes[i]!==infinite.bytes[i])delta.push(i);assert.equal(delta.length,1);assert.equal(finite.bytes[delta[0]],0);assert.equal(infinite.bytes[delta[0]],1);assert.equal(runtimePlan(infinite.model,infinite.bytes.length).eligible,true);assert.equal(runtimePlan(infinite.model,infinite.bytes.length).controlFlow,true);
        report.fixture={bytes:finite.bytes.length,finiteSHA256:hash(finite.bytes),infiniteSHA256:hash(infinite.bytes),onlyChangedByte:delta[0],falseByte:0,trueByte:1,subgraphs:3,builtins:['WHILE','ADD'],input:{dtype:'float32',shape:[1]}};
        const control=path.join(directory,'active-cpu-control.tflite'),loop=path.join(directory,'active-cpu-loop.tflite'),input=path.join(directory,'active-cpu-input.bin');await writeFile(control,finite.bytes,{flag:'wx'});await writeFile(loop,infinite.bytes,{flag:'wx'});await writeFile(input,Buffer.from(Float32Array.of(7).buffer),{flag:'wx'});
        await opened(control);await start(input);const baseline=await finished('passed');assert.equal(baseline.downloadDisabled,false);report.cases.push({kind:'finite-control',status:baseline.status,io:await saveIO('active-cpu-baseline-io.zip',report.fixture.finiteSHA256)});await close();
        await opened(loop);let n=await start();await invoked();assert.equal(report.runtimeWorkers.length,n+1);const cancelWorker=report.runtimeWorkers.at(-1);report.cancelInvokeObservedAt=Date.now();
        await page.keyboard.press('F1');await until(()=>document.querySelector('#usage-guide').open);assert.equal(await page.locator('#guide-tab-run').getAttribute('aria-selected'),'true');assert.equal(cancelWorker.closed,false);assert.equal(await page.locator('#run-workspace').getAttribute('aria-busy'),'true');report.uiResponseMs=Date.now()-report.cancelInvokeObservedAt;assert.ok(report.uiResponseMs<5000);report.mainThreadResponsive=true;await page.keyboard.press('Escape');await until(()=>!document.querySelector('#usage-guide').open);
        const cancelledAt=Date.now();await page.locator('#edit-runtime-cancel').click();const cancelled=await finished('not-verified');assert.match(cancelled.detail,/取消/);assert.equal(cancelled.downloadDisabled,true);assert.equal(cancelled.checkEnabled,true);assert.ok(cancelWorker.closedAt-cancelledAt<5000);report.cases.push({kind:'in-kernel-cancel',invokeObserved:true,mainThreadResponsive:true,status:cancelled.status,cancelToCloseMs:cancelWorker.closedAt-cancelledAt,downloadDisabled:true});
        n=await start();await invoked();assert.equal(report.runtimeWorkers.length,n+1);const timedWorker=report.runtimeWorkers.at(-1);report.timeoutInvokeObservedAt=Date.now();
        if(beforeTimeout)await beforeTimeout({fixture:report.fixture,worker:timedWorker,nativeWorker:handles.get(timedWorker),invokeObservedAt:report.timeoutInvokeObservedAt});
        const timed=await finished('not-verified');assert.match(timed.detail,/超過 30 秒.*終止 Worker/);assert.equal(timed.downloadDisabled,true);assert.equal(timed.checkEnabled,true);assert.ok(timedWorker.lifetimeMs>=25000&&timedWorker.lifetimeMs<=40000,JSON.stringify(timedWorker));report.cases.push({kind:'in-kernel-timeout',invokeObserved:true,status:timed.status,workerLifetimeMs:timedWorker.lifetimeMs,reason:timed.detail,downloadDisabled:true});
        report.timeoutObservation={eventId:timedWorker.id,fixtureSHA256:report.fixture.infiniteSHA256,invokeObservedAt:report.timeoutInvokeObservedAt,status:timed.status,reason:timed.detail,downloadDisabled:timed.downloadDisabled,checkEnabled:timed.checkEnabled};
        await page.screenshot({path:path.join(directory,'active-cpu-timeout.png')});report.screenshot=true;report.screenshotContext=afterTimeout?'guide-open-after-timeout':'runtime-after-timeout';
        if(afterTimeout)await afterTimeout({fixture:report.fixture,worker:timedWorker,state:timed});
        await close();
        await opened(control);await start(input);const recovered=await finished('passed');report.cases.push({kind:'finite-recovery',status:recovered.status,io:await saveIO('active-cpu-recovery-io.zip',report.fixture.finiteSHA256)});await close();
        assert.equal(report.modelWorkers.length,3);assert.equal(report.runtimeWorkers.length,4);assert.ok([...report.modelWorkers,...report.runtimeWorkers].every(w=>w.closed));if(preserveModelTabs){assert.deepEqual(await read(()=>Array.from(document.querySelectorAll('[data-model-tab]'),e=>e.getAttribute('data-model-tab'))),originalTabs);assert.equal(report.restoredModelWorkers.length,3);report.preservedOriginalTabs=true;}check('real WHILE kernel: responsive UI and native cancellation, actual30s timeout, closed Workers and finite CPU/IO recovery');return report;
    }catch(error){report.error=error.stack||String(error);error.activeCompute=report;throw error;}finally{page.off('worker',worker);}
}
