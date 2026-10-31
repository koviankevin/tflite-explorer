import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {legacyShapeFixture} from '../legacy-shape-fixture.mjs';
import {parseLegacyShapeFixture} from '../legacy-shape-fixture.mjs';
import {verifyExportFiles} from '../../scripts/verify-export.mjs';
export async function legacyShapeValidationFlow({page,read,base,directory,check}){
    const workers=[],runtime=[],report={status:'failed',cases:[],modelWorkers:0,automaticRuntimeWorkers:0,errors:[]};let downloads=0;
    const onWorker=w=>{const row={closed:false};if(/\/model-worker\.js(?:\?|$)/.test(w.url()))workers.push(row);else if(/\/tflite-runtime-worker\.js(?:\?|$)/.test(w.url()))runtime.push(row);else return;w.once('close',()=>row.closed=true);};
    const onDownload=()=>downloads++;page.on('worker',onWorker);page.on('download',onDownload);
    const until=async(fn,...args)=>{const end=Date.now()+30000;while(!await read(fn,...args)){assert.ok(Date.now()<end,'Legacy shape UI timeout: '+fn);await new Promise(r=>setTimeout(r,60));}};
    const ready=()=>until(()=>document.querySelector('#model-tabs').getAttribute('aria-busy')==='false'&&document.querySelector('#loading-card').hidden&&document.querySelector('#target').getAttribute('aria-busy')==='false');
    const choose=async filename=>{const e=page.waitForEvent('filechooser');await page.locator('#open-model').click();await(await e).setFiles(filename);await ready();};
    const save=async(selector,name)=>{const e=page.waitForEvent('download');await page.locator(selector).click();const d=await e;assert.equal(await d.failure(),null);const p=path.join(directory,name);await d.saveAs(p);await d.delete();return p;};
    const close=async(discard=false)=>{const accept=d=>{assert.equal(d.type(),'confirm');assert.match(d.message(),/尚未匯出/);return d.accept();};if(discard)page.once('dialog',accept);try{await page.locator('#explore-mode').click();await page.locator('#close-model').click();await ready();}finally{page.off('dialog',accept);}};
    try{
        await page.goto(base,{waitUntil:'domcontentloaded'});await until(()=>!document.querySelector('#open-model').disabled);await page.setViewportSize({width:1280,height:640});
        for(const name of ['invalid-fc','valid-reshape']){
            const bad=name==='invalid-fc',f=bad?await legacyShapeFixture('FULLY_CONNECTED',[[2,3],[5,4]],{output:[2,5]}):await legacyShapeFixture('RESHAPE',[[2,3],[2]],{output:[2,3],values:[2,3]});
            const source=path.join(directory,name+'-source.tflite');await writeFile(source,f.bytes,{flag:'wx'});await choose(source);await page.locator('#layers-tab').click();await page.locator('#query').fill('#0');await until(()=>document.querySelector('#result-count').textContent==='1 筆結果');await page.locator('.result-item').click();await ready();await page.locator('#graph-font-size').selectOption('32');await ready();
            await page.locator('#edit-mode').click();await until(()=>document.body.classList.contains('editing-model')&&document.querySelector('#edit-workspace').getAttribute('aria-busy')==='false');await page.locator('#edit-font').selectOption('32');await page.locator('[data-edit-node="op:0:0"] .edit-node-title').click();await page.locator('#edit-add-after').click();await until(()=>document.querySelectorAll('.edit-node.added').length===1);await page.locator('#edit-expose').check();
            if(bad){
                const before=downloads;await page.locator('#edit-export').click();await until(()=>document.querySelector('#edit-workspace').getAttribute('aria-busy')==='false'&&document.querySelector('#edit-message').textContent.includes('input_size'));assert.equal(downloads,before);
                const reason=await page.locator('#edit-message').textContent();assert.match(reason,/FULLY_CONNECTED/);await page.screenshot({path:path.join(directory,'legacy-fc-rejected-32px.png')});report.cases.push({name,status:'rejected',downloads:0,reason});await close(true);continue;
            }
            const output=await save('#edit-export','legacy-reshape-edited.tflite');await until(()=>!document.querySelector('#edit-download-report').disabled);const record=await save('#edit-download-report','legacy-reshape.report.json'),r=JSON.parse(await readFile(record,'utf8'));
            assert.equal(r.operatorSummary.checked,2);assert.equal(r.operatorSummary.unchecked,0);assert.ok(r.operatorValidation.every(c=>c.type==='RESHAPE'&&c.status==='passed'));assert.ok(r.checks.filter(c=>c.id.startsWith('runtime')).every(c=>c.status==='not-run'));
            const bytes=new Uint8Array(await readFile(output)),candidate=await parseLegacyShapeFixture(bytes);for(let i=0;i<3;i++){assert.equal(candidate.raw.subgraphs[0].tensors[i].has_rank,false);assert.deepEqual(candidate.raw.subgraphs[0].tensors[i].shape,f.index.raw.subgraphs[0].tensors[i].shape);}
            const verified=await verifyExportFiles({report:r,source,output});assert.equal(verified.byteComparison.status,'passed');await page.locator('#edit-view-report').click();await until(()=>document.querySelector('#export-report-dialog').open);
            const layout=await read(()=>{const d=document.querySelector('#export-report-dialog'),r=d.getBoundingClientRect();return {width:innerWidth,height:innerHeight,documentWidth:document.documentElement.scrollWidth,left:r.left,right:r.right,top:r.top,bottom:r.bottom,scroll:d.scrollWidth,client:d.clientWidth};});assert.ok(layout.documentWidth<=layout.width+1&&layout.left>=0&&layout.right<=layout.width+1&&layout.top>=0&&layout.bottom<=layout.height+1&&layout.scroll<=layout.client+1);await page.screenshot({path:path.join(directory,'legacy-reshape-report-32px.png')});await page.locator('#close-export-report').click();
            await page.locator('#explore-mode').click();await choose(output);await page.locator('#layers-tab').click();await page.locator('#query').fill('Reshape');await until(()=>document.querySelector('#result-count').textContent==='2 筆結果');report.cases.push({name,status:'passed',checked:2,unchecked:0,flagsPreserved:true,weights:'identical',reopenedOperators:2,layout});while(await page.locator('#model-tabs [role="tab"]').count())await close();
        }
        const end=Date.now()+5000;while(workers.some(w=>!w.closed)&&Date.now()<end)await new Promise(r=>setTimeout(r,30));assert.ok(workers.length&&workers.every(w=>w.closed));assert.equal(runtime.length,0);report.modelWorkers=workers.length;report.automaticRuntimeWorkers=runtime.length;report.workersClosed=true;report.downloads=downloads;report.status='passed';check('legacy concrete shapes block invalid FC and verify unchanged RESHAPE constants, exports and reopen at32px');return report;
    }catch(error){report.error=error.stack||String(error);error.legacyShapeValidation=report;throw error;}
    finally{page.off('worker',onWorker);page.off('download',onDownload);}
}
