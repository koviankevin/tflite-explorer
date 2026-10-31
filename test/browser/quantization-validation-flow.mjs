import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {quantizationFixture} from '../quantization-fixture.mjs';
import {parseModel} from '../../src/model-engine.js';
import {verifyExportFiles} from '../../scripts/verify-export.mjs';
const metadata=JSON.parse(await readFile(new URL('../../vendor/netron/tflite-metadata.json',import.meta.url),'utf8'));
export async function quantizationValidationFlow({page,read,base,directory,check}){
    const workers=[],runtime=[],report={status:'failed',cases:[],modelWorkers:0,automaticRuntimeWorkers:0,errors:[]};let downloads=0;
    const onWorker=w=>{const row={closed:false};if(/\/model-worker\.js(?:\?|$)/.test(w.url()))workers.push(row);else if(/\/tflite-runtime-worker\.js(?:\?|$)/.test(w.url()))runtime.push(row);else return;w.once('close',()=>row.closed=true);};
    const onDownload=()=>downloads++;page.on('worker',onWorker);page.on('download',onDownload);
    const until=async(fn,...args)=>{const end=Date.now()+30000;while(!await read(fn,...args)){assert.ok(Date.now()<end,'Quantization UI timeout: '+fn);await new Promise(r=>setTimeout(r,60));}};
    const ready=()=>until(()=>document.querySelector('#model-tabs').getAttribute('aria-busy')==='false'&&document.querySelector('#loading-card').hidden&&document.querySelector('#target').getAttribute('aria-busy')==='false');
    const choose=async filename=>{const e=page.waitForEvent('filechooser');await page.locator('#open-model').click();await(await e).setFiles(filename);await ready();};
    const save=async(selector,name)=>{const e=page.waitForEvent('download');await page.locator(selector).click();const d=await e;assert.equal(await d.failure(),null);const p=path.join(directory,name);await d.saveAs(p);await d.delete();return p;};
    const select=async()=>{await page.locator('#layers-tab').click();await page.locator('#query').fill('#0');await until(()=>document.querySelector('#result-count').textContent==='1 筆結果');await page.locator('.result-item').click();await ready();};
    const close=async(discard=false)=>{const accept=d=>{assert.equal(d.type(),'confirm');assert.match(d.message(),/尚未匯出/);return d.accept();};if(discard)page.once('dialog',accept);try{await page.locator('#explore-mode').click();await page.locator('#close-model').click();await ready();}finally{page.off('dialog',accept);}};
    const layout=()=>read(()=>{const d=document.querySelector('#export-report-dialog'),r=d.getBoundingClientRect();return {width:innerWidth,height:innerHeight,documentWidth:document.documentElement.scrollWidth,left:r.left,right:r.right,top:r.top,bottom:r.bottom,scroll:d.scrollWidth,client:d.clientWidth};});
    const assertLayout=l=>assert.ok(l.documentWidth<=l.width+1&&l.left>=0&&l.right<=l.width+1&&l.top>=0&&l.bottom<=l.height+1&&l.scroll<=l.client+1,JSON.stringify(l));
    try{
        await page.goto(base,{waitUntil:'domcontentloaded'});await until(()=>!document.querySelector('#open-model').disabled);await page.setViewportSize({width:1280,height:640});
        for(const [name,options,expected]of [['bad',{rank:false,scale:[.25,.5],dimension:3},'failed'],['opaque',{dimension:99,customDetails:true},'not-run']]){
            const f=await quantizationFixture(options),source=path.join(directory,'quantization-'+name+'-source.tflite');await writeFile(source,f.bytes,{flag:'wx'});await choose(source);await select();
            await page.locator('#graph-font-size').selectOption('32');await ready();await page.locator('#pick-pattern').click();await page.locator('#target .node[data-model-node="0"] .node-item-type').click();await until(()=>document.querySelector('#capture-count').textContent.startsWith('已選取 1 個'));
            const output=await save('#export-submodel','quantization-'+name+'-cut.tflite');await page.locator('#export-report-button').click();await until(()=>document.querySelector('#export-report-dialog').open);
            const recordPath=await save('#download-export-report','quantization-'+name+'.report.json'),r=JSON.parse(await readFile(recordPath,'utf8'));
            assert.equal(r.checks.find(c=>c.id==='quantization-metadata').status,expected);assert.equal(r.quantizationValidation[0].status,expected);assert.ok(r.checks.filter(c=>c.id.startsWith('runtime')).every(c=>c.status==='not-run'));
            await page.locator('#export-report-operators summary').filter({hasText:'量化 metadata'}).click();await until(()=>document.querySelectorAll('#export-report-operators details:first-child li').length===3);
            const text=await page.locator('#export-report-operators').textContent();assert.match(text,expected==='failed'?/失敗.*tensor #0.*quantized_dimension/s:/未驗證.*QuantizationDetails/s);
            const l=await layout();assertLayout(l);await page.screenshot({path:path.join(directory,'quantization-'+name+'-32px.png')});
            const raw=new Uint8Array(await readFile(output)),reopened=await parseModel((o,n)=>raw.subarray(o,o+n),raw.length,metadata);assert.deepEqual(reopened.raw.subgraphs[0].tensors.map(t=>t.quantization),f.index.raw.subgraphs[0].tensors.map(t=>t.quantization));
            const bytes=await verifyExportFiles({report:r,source,output});assert.ok(['passed','not-applicable'].includes(bytes.byteComparison.status));await page.locator('#close-export-report').click();
            if(name==='bad'){
                if(await page.locator('#pick-pattern').getAttribute('aria-pressed')==='true')await page.locator('#pick-pattern').click();
                await page.locator('#edit-mode').click();await until(()=>document.body.classList.contains('editing-model')&&document.querySelector('#edit-workspace').getAttribute('aria-busy')==='false');await page.locator('#edit-font').selectOption('32');await page.locator('[data-edit-node="op:0:0"] .edit-node-title').click();await page.locator('#edit-add-after').click();await until(()=>document.querySelectorAll('.edit-node.added').length===1);await page.locator('#edit-expose').check();
                const before=downloads;await page.locator('#edit-export').click();await until(()=>document.querySelector('#edit-workspace').getAttribute('aria-busy')==='false'&&document.querySelector('#edit-message').textContent.includes('quantized_dimension'));assert.equal(downloads,before);
                report.cases.push({name,status:expected,quantization:r.quantizationSummary,preserved:true,blockedRewire:true,layout:l});await close(true);
            }else{report.cases.push({name,status:expected,quantization:r.quantizationSummary,preserved:true,layout:l});await close();}
        }
        const f=await quantizationFixture({layers:201}),source=path.join(directory,'quantization-large-source.tflite');await writeFile(source,f.bytes,{flag:'wx'});await choose(source);await select();await page.locator('#edit-mode').click();await until(()=>document.body.classList.contains('editing-model')&&document.querySelector('#edit-workspace').getAttribute('aria-busy')==='false');await page.locator('#edit-font').selectOption('32');await page.locator('[data-edit-node="op:0:0"] .edit-node-title').click();await page.locator('#edit-add-after').click();await until(()=>document.querySelectorAll('.edit-node.added').length===1);await page.locator('#edit-expose').check();
        const output=await save('#edit-export','quantization-large-edited.tflite');await until(()=>!document.querySelector('#edit-download-report').disabled);const recordPath=await save('#edit-download-report','quantization-large.report.json'),r=JSON.parse(await readFile(recordPath,'utf8'));assert.equal(r.quantizationSummary.checked,204);assert.equal(r.quantizationSummary.failed,0);assert.equal(r.quantizationSummary.unchecked,0);
        await page.locator('#edit-view-report').click();await page.locator('#export-report-operators summary').filter({hasText:'量化 metadata'}).click();await until(()=>document.querySelectorAll('#export-report-operators details:first-child li').length===100);await page.locator('#export-report-operators details:first-child button').click();await until(()=>document.querySelectorAll('#export-report-operators details:first-child li').length===200);
        const l=await layout();assertLayout(l);await page.screenshot({path:path.join(directory,'quantization-large-32px.png')});await page.locator('#close-export-report').click();const bytes=await verifyExportFiles({report:r,source,output});assert.ok(['passed','not-applicable'].includes(bytes.byteComparison.status));await page.locator('#explore-mode').click();await choose(output);await page.locator('#layers-tab').click();await page.locator('#query').fill('Add');await until(()=>document.querySelector('#result-count').textContent==='202 筆結果');
        report.cases.push({name:'large',status:'passed',quantization:r.quantizationSummary,visibleRows:200,reopenedOperators:202,layout:l});while(await page.locator('#model-tabs [role="tab"]').count())await close();
        const end=Date.now()+5000;while(workers.some(w=>!w.closed)&&Date.now()<end)await new Promise(r=>setTimeout(r,30));assert.ok(workers.length&&workers.every(w=>w.closed));assert.equal(runtime.length,0);report.modelWorkers=workers.length;report.automaticRuntimeWorkers=runtime.length;report.workersClosed=true;report.downloads=downloads;report.status='passed';check('affine quantization metadata, blocked rewires, preserved cuts, unknown codecs and bounded report pages at32px');return report;
    }catch(error){report.error=error.stack||String(error);error.quantizationValidation=report;throw error;}
    finally{page.off('worker',onWorker);page.off('download',onDownload);}
}

