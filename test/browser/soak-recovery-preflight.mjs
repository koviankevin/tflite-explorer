import assert from 'node:assert/strict';
import {writeFile,rm} from 'node:fs/promises';
import {randomBytes} from 'node:crypto';
import {once} from 'node:events';
import path from 'node:path';
import {chromium} from 'playwright';
import {customFixture} from '../custom-fixture.mjs';
import {editFileFingerprint} from '../../src/model-edit-session.js';
import {SOAK_RECOVERY_POLICY,createSoakRecovery,evaluateSoakRecovery} from './soak-recovery.mjs';
import {assertSoakExecution} from './lifecycle-soak-policy.mjs';
import {OwnedProcessTree,readProcessTable,findOwnedBrowserRoot} from './owned-processes.mjs';

// Fail fast on the *real* capacity controls before spending thirty minutes on
// twenty physical models. This is a separate small-model functional preflight;
// the subsequent two-hour measured browser still starts empty and is never reset.
export async function recoveryCapacityPreflight({base,directory,report}){
    assertSoakExecution(process.env,process.platform);Object.assign(report,{status:'failed',cycles:[],workers:[],errors:[],recoveryPolicy:SOAK_RECOVERY_POLICY,viewport:{width:1280,height:640}});
    const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms)),source=path.join(directory,'recovery-preflight.tflite'),marker=randomBytes(16).toString('hex');let browser,context,tree;
    try{
        const fixture=await customFixture({external:true});await writeFile(source,fixture.bytes,{flag:'wx'});
        report.fixture={file:source,bytes:fixture.bytes.length,editFingerprint:await editFileFingerprint(new File([fixture.bytes],'recovery-preflight.tflite'))};
        browser=await chromium.launch({headless:true,env:{...process.env,MODEL_LENS_PHYSICAL_OWNER:marker}});
        tree=new OwnedProcessTree(await findOwnedBrowserRoot(await readProcessTable(),process.pid,marker));tree.sample(await readProcessTable());
        context=await browser.newContext({viewport:report.viewport,acceptDownloads:true});
        await context.route('**/*',async route=>{const r=route.request();if(r.method()==='GET'&&r.url().startsWith(base+'/'))await route.continue();else{report.errors.push('Unexpected preflight network request');await route.abort();}});
        const page=await context.newPage(),cdp=await context.newCDPSession(page);page.setDefaultTimeout(30000);
        page.on('pageerror',e=>report.errors.push(e.message));page.on('crash',()=>report.errors.push('Preflight page crashed.'));
        page.on('dialog',async dialog=>{if(dialog.type()==='confirm'&&dialog.message()==='模型分頁有尚未匯出的編輯變更。要放棄並關閉嗎？')await dialog.accept();else{report.errors.push('Unexpected preflight dialog');await dialog.dismiss();}});
        page.on('worker',worker=>{const row={url:worker.url(),closed:false};report.workers.push(row);worker.once('close',()=>{row.closed=true;});});
        const read=async fn=>{const r=await cdp.send('Runtime.evaluate',{expression:`(${fn.toString()})()`,returnByValue:true});assert.equal(r.exceptionDetails,undefined);return r.result.value;};
        async function until(fn){const end=Date.now()+30000;while(!await read(fn)){assert.ok(Date.now()<end,'Small-model recovery preflight timed out.');await wait(75);}}
        await page.goto(base);await until(()=>typeof document.querySelector('#open-edit-draft').onclick==='function');
        const recovery=createSoakRecovery({page,directory,fixture:report.fixture});
        for(let cycle=1;cycle<=22;cycle++){
            const entry={cycle};report.cycles.push(entry);const chooser=page.waitForEvent('filechooser');await page.locator('#open-model').click();await(await chooser).setFiles(source);
            await until(()=>document.querySelector('#model-tabs').getAttribute('aria-busy')==='false'&&document.querySelector('#loading-card').hidden&&document.querySelector('#target').getAttribute('aria-busy')==='false');
            await page.locator('#query').fill('#0');await until(()=>document.querySelector('#result-count').textContent==='1 筆結果');await page.locator('.result-item').click();
            await until(()=>document.querySelector('#target').getAttribute('aria-busy')==='false');await page.locator('#edit-mode').click();
            await until(()=>document.body.classList.contains('editing-model')&&document.querySelector('#edit-workspace').getAttribute('aria-busy')==='false');
            await page.locator('#edit-font').selectOption('32');await page.locator('[data-edit-node="op:0:0"] .edit-node-title').click();await page.locator('#edit-add-after').click();await page.locator('#edit-expose').check();
            await recovery.ensureSaved(entry);
            const worker=page.workers().find(w=>/\/model-worker\.js(?:\?|$)/.test(w.url()));assert.ok(worker);let timeout;
            try{const closed=Promise.race([once(worker,'close'),new Promise((_,reject)=>{timeout=setTimeout(()=>reject(Error('Preflight model Worker remained.')),5000);})]);await page.locator('#close-model').click();await closed;}finally{clearTimeout(timeout);}
            await until(()=>document.querySelector('#model-file').files.length===0&&document.querySelector('#close-model').hidden);
            await recovery.finishCycle(entry);tree.sample(await readProcessTable());
        }
        report.evaluation=evaluateSoakRecovery(report.cycles,report.fixture,report.recoveryPolicy);assert.equal(report.evaluation.status,'passed');assert.equal(report.evaluation.removed,2);
        assert.equal(report.workers.filter(w=>/\/model-worker\.js(?:\?|$)/.test(w.url)).length,22);assert.equal(report.workers.filter(w=>/\/edit-recovery-worker\.js(?:\?|$)/.test(w.url)).length,22);
        assert.ok(report.workers.filter(w=>/\/(model-worker|edit-recovery-worker)\.js(?:\?|$)/.test(w.url)).every(w=>w.closed));assert.deepEqual(report.errors,[]);
    }catch(error){report.error=error.stack||String(error);throw error;}
    finally{
        let timeout;try{if(tree&&browser?.isConnected())tree.sample(await readProcessTable());await Promise.race([(async()=>{await context?.close();await browser?.close();})(),new Promise((_,reject)=>{timeout=setTimeout(()=>reject(Error('Preflight browser close timed out.')),10000);})]);}finally{clearTimeout(timeout);}
        if(tree){const end=Date.now()+10000;let live;do{live=tree.remaining(await readProcessTable());if(live.length)await wait(100);}while(live.length&&Date.now()<end);report.processCleanup={identities:tree.identities,remaining:live,allReaped:live.length===0};assert.equal(live.length,0);}
        report.browserClosed=Boolean(browser);await rm(source,{force:true});
    }
    report.status='passed';
}
