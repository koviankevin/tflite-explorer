// Hosted-only native chooser handles remain observable after DOM detachment.
// Reads inspect DOM/FileList metadata, never application APIs or private data.
import assert from 'node:assert/strict';
import {readFile,lstat} from 'node:fs/promises';
import path from 'node:path';
import {sha256} from '../../scripts/lib/release-artifact.mjs';
import {runtimeLoopFixture} from '../runtime-loop-fixture.mjs';

export async function retainedRuntimeInputFlow({browser,base,coreBasePath,buildId,directory,createReader}){
    assert.equal(process.env.GITHUB_ACTIONS,'true');assert.equal(process.platform,'linux');
    const report={format:'model-lens-retained-runtime-input',version:1,status:'failed',workers:[],requests:[],errors:[],cases:[],downloads:0,contextClosed:false},handles=[];
    let context,page,read;
    const wait=ms=>new Promise(r=>setTimeout(r,ms));
    async function until(fn){const end=Date.now()+35000;while(!await read(fn)){assert.ok(Date.now()<end,'Retained input DOM observation timed out');await wait(60);}}
    async function choose(file,button){const event=page.waitForEvent('filechooser');await page.locator(button).click();const chooser=await event;await chooser.setFiles(file);return chooser.element();}
    const inspect=handle=>handle.evaluate(e=>({connected:e.isConnected,type:e.type,files:e.files.length,valueEmpty:e.value===''}));
    async function closed(){const end=Date.now()+5000;while(report.workers.some(w=>!w.closed)&&Date.now()<end)await wait(25);assert.ok(report.workers.every(w=>w.closed));}
    try{
        const fixture=await runtimeLoopFixture(false),model=path.join(directory,'active-cpu-control.tflite'),input=path.join(directory,'active-cpu-input.bin');
        for(const [file,bytes]of [[model,fixture.bytes],[input,new Uint8Array(Float32Array.of(7).buffer)]]){const info=await lstat(file);assert.ok(info.isFile()&&!info.isSymbolicLink());assert.equal(info.size,bytes.length);assert.equal(sha256(await readFile(file)),sha256(bytes));}
        report.modelSHA256=sha256(fixture.bytes);report.inputSHA256=sha256(new Uint8Array(Float32Array.of(7).buffer));
        context=await browser.newContext({viewport:{width:1280,height:640},acceptDownloads:true});await context.route('**/*',async route=>{const request=route.request(),u=new URL(request.url());if(['blob:','data:'].includes(u.protocol)){await route.continue();return;}const allowed=request.method()==='GET'&&request.url().startsWith(base);report.requests.push({url:request.url(),method:request.method(),allowed});assert.ok(report.requests.length<=1000);if(!allowed){report.errors.push('Unexpected external/non-GET request');await route.abort();}else await route.continue();});
        page=await context.newPage();page.on('filechooser',()=>{});page.on('download',()=>report.downloads++);page.on('pageerror',e=>report.errors.push(e.message));page.on('crash',()=>report.errors.push('Page crash'));page.on('worker',worker=>{const kind=/\/model-worker\.js(?:\?|$)/.test(worker.url())?'model':/\/tflite-runtime-worker\.js(?:\?|$)/.test(worker.url())?'runtime':null;if(!kind)return;const row={kind,url:worker.url(),closed:false};report.workers.push(row);worker.on('close',()=>row.closed=true);assert.equal(row.url,new URL(coreBasePath+`src/${kind==='model'?'model-worker':'tflite-runtime-worker'}.js?v=${buildId}`,base).href);});
        read=await createReader(page,context);await page.goto(base,{waitUntil:'domcontentloaded'});await until(()=>!document.querySelector('#autosave-enabled').disabled);const modelHandle=await choose(model,'#open-model');await modelHandle.dispose();await until(()=>document.querySelector('#target').getAttribute('aria-busy')==='false'&&document.querySelector('#loading-card').hidden&&document.querySelector('#layer-count').textContent!=='—');await page.locator('#graph-font-size').selectOption('32');await until(()=>document.querySelector('#target').getAttribute('aria-busy')==='false');await page.locator('#run-mode').click();await until(()=>document.querySelector('#run-workspace').getAttribute('aria-busy')==='false');
        for(const action of ['confirm','cancel']){
            await page.locator('#edit-runtime-check').click();await until(()=>document.querySelector('#edit-runtime-dialog').open);await page.locator('#runtime-input-mode-0').selectOption('bin');const handle=await choose(input,'#runtime-input-file-0');handles.push(handle);const before=await inspect(handle);assert.deepEqual(before,{connected:true,type:'file',files:1,valueEmpty:false});
            if(action==='confirm'){await page.locator('#edit-runtime-run').click();await until(()=>document.querySelector('#run-workspace').getAttribute('aria-busy')==='false'&&document.querySelector('#edit-runtime-result').dataset.status==='passed');assert.equal(await page.locator('#edit-runtime-download').isDisabled(),false);}
            else{await page.locator('#edit-runtime-dialog-close').click();await until(()=>!document.querySelector('#edit-runtime-dialog').open&&document.querySelector('#run-workspace').getAttribute('aria-busy')==='false');assert.equal(await page.locator('#edit-runtime-download').isDisabled(),true);}
            const after=await inspect(handle);assert.deepEqual(after,{connected:false,type:'file',files:0,valueEmpty:true});report.cases.push({action,before,after});await handle.dispose();handles.pop();
        }
        await page.locator('#close-model').click();await until(()=>document.querySelector('#model-tabs').hidden);await closed();assert.equal(report.workers.filter(w=>w.kind==='model').length,1);assert.equal(report.workers.filter(w=>w.kind==='runtime').length,1);assert.equal(report.downloads,0);assert.deepEqual(report.errors,[]);
    }catch(error){report.error=error.stack||String(error);throw Object.assign(error,{retainedRuntimeInputs:report});}
    finally{for(const handle of handles)await handle.dispose().catch(()=>{});try{await context?.close();report.contextClosed=Boolean(context);}catch(error){report.errors.push('Context shutdown: '+error.message);}report.finishedAt=new Date().toISOString();}
    if(!report.contextClosed||report.errors.length||report.workers.some(w=>!w.closed))throw Object.assign(Error('Retained input cleanup incomplete'),{retainedRuntimeInputs:report});report.status='passed';return report;
}
