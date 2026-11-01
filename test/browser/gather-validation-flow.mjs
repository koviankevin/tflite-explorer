import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {gatherFixture} from '../gather-fixture.mjs';
import {verifyExportFiles} from '../../scripts/verify-export.mjs';
import {parseModel} from '../../src/model-engine.js';
export async function gatherValidationFlow({page,read,base,directory,check}){
    const workers=[],runtime=[],report={status:'failed',cases:[],modelWorkers:0,automaticRuntimeWorkers:0};let downloads=0;
    const onWorker=w=>{const row={closed:false};if(/\/model-worker\.js(?:\?|$)/.test(w.url()))workers.push(row);else if(/\/tflite-runtime-worker\.js(?:\?|$)/.test(w.url()))runtime.push(row);else return;w.once('close',()=>row.closed=true);};
    const onDownload=()=>downloads++;page.on('worker',onWorker);page.on('download',onDownload);
    const until=async fn=>{const end=Date.now()+30000;while(!await read(fn)){assert.ok(Date.now()<end,'GATHER UI timeout: '+fn);await new Promise(r=>setTimeout(r,60));}};
    const ready=()=>until(()=>document.querySelector('#model-tabs').getAttribute('aria-busy')==='false'&&document.querySelector('#loading-card').hidden&&document.querySelector('#target').getAttribute('aria-busy')==='false');
    const editReady=()=>until(()=>document.querySelector('#edit-workspace').getAttribute('aria-busy')==='false');
    const choose=async file=>{const e=page.waitForEvent('filechooser');await page.locator('#open-model').click();await(await e).setFiles(file);await ready();};
    const save=async(selector,name)=>{const e=page.waitForEvent('download');await page.locator(selector).click();const d=await e;assert.equal(await d.failure(),null);const p=path.join(directory,name);await d.saveAs(p);await d.delete();return p;};
    const close=async(discard=false)=>{const accept=d=>{assert.equal(d.type(),'confirm');assert.match(d.message(),/尚未匯出/);return d.accept();};if(discard)page.once('dialog',accept);try{await page.locator('#explore-mode').click();await page.locator('#close-model').click();await ready();}finally{page.off('dialog',accept);}};
    const metadata=JSON.parse(await readFile(new URL('../../vendor/netron/tflite-metadata.json',import.meta.url),'utf8'));
    const cases=[
        {name:'invalid-dynamic-result-dtype',spec:{params:{shape:[2,3],type:0,shape_signature:[-1,3]},output:{shape:[2,2],type:2}},reject:/GATHER.*dtype/},
        {name:'invalid-dynamic-indices',spec:{params:{shape:[2,3],type:0,shape_signature:[-1,3]},indices:{shape:[2],type:0,values:[0,1]}},reject:/GATHER.*indices/},
        {name:'negative-batch',spec:{params:{shape:[2,2,3],type:0},indices:{shape:[2,2],type:2,values:[0,2,1,0]},output:{shape:[2,2,2],type:0},options:{axis:-1,batch_dims:-1}},status:'passed'},
        {name:'empty-indices',spec:{indices:{shape:[0],type:2,values:[]},output:{shape:[2,0],type:0}},status:'passed'},
        {name:'dynamic-valid',spec:{params:{shape:[2,3],type:0,shape_signature:[-1,3]},output:{shape:[2,2],type:0,shape_signature:[-1,2]}},status:'not-run'}
    ];
    try{
        await page.goto(base,{waitUntil:'domcontentloaded'});await until(()=>!document.querySelector('#open-model').disabled);await page.setViewportSize({width:1280,height:640});
        for(const c of cases){
            const f=await gatherFixture(c.spec),source=path.join(directory,`gather-${c.name}-source.tflite`);await writeFile(source,f.bytes,{flag:'wx'});await choose(source);
            await page.locator('#layers-tab').click();await page.locator('#query').fill('#0');await until(()=>document.querySelector('#result-count').textContent==='1 筆結果');await page.locator('.result-item').click();await ready();await page.locator('#graph-font-size').selectOption('32');await ready();
            await page.locator('#edit-mode').click();await editReady();await page.locator('#edit-font').selectOption('32');await editReady();await page.locator('[data-edit-node="op:0:0"] .edit-node-title').click();await page.locator('#edit-add-after').click();await until(()=>document.querySelectorAll('.edit-node.added').length===1);await editReady();
            // Rewire both copies to the original params tensor through native ports.
            await page.locator('[data-edit-output="t:0:0"]').click();await page.locator('[data-edit-input="new:1"][data-edit-slot="0"]').click();await editReady();await page.locator('[data-edit-node="new:1"] .edit-node-title').click();await page.locator('#edit-expose').check();
            if(c.reject){
                const before=downloads;await page.locator('#edit-export').click();await editReady();await until(()=>document.querySelector('#edit-message').textContent.includes('GATHER'));
                const reason=await page.locator('#edit-message').textContent();assert.match(reason,c.reject);assert.match(reason,/Subgraph #0.*OP #0.*inputs.*outputs/);assert.equal(downloads,before);
                await page.screenshot({path:path.join(directory,`gather-${c.name}-rejected-32px.png`)});report.cases.push({name:c.name,status:'rejected',downloads:0,reason});await close(true);continue;
            }
            const output=await save('#edit-export',`gather-${c.name}-edited.tflite`);await until(()=>!document.querySelector('#edit-download-report').disabled);const reportFile=await save('#edit-download-report',`gather-${c.name}.report.json`),record=JSON.parse(await readFile(reportFile,'utf8'));
            assert.equal(record.operatorValidation.length,2);assert.ok(record.operatorValidation.every(v=>v.type==='GATHER'&&v.status===c.status));assert.equal(record.operatorSummary.checked,c.status==='passed'?2:0);assert.equal(record.operatorSummary.unchecked,c.status==='passed'?0:2);assert.ok(record.checks.filter(v=>v.id.startsWith('runtime')).every(v=>v.status==='not-run'));
            const verified=await verifyExportFiles({report:record,source,output});if(c.name==='empty-indices')assert.deepEqual(verified.byteComparison,{status:'not-applicable',ranges:[],bytes:0});else assert.equal(verified.byteComparison.status,'passed');const bytes=new Uint8Array(await readFile(output)),candidate=await parseModel((o,n)=>bytes.subarray(o,o+n),bytes.length,metadata),g=candidate.raw.subgraphs[0];assert.equal(g.operators.length,2);assert.deepEqual(Array.from(g.operators[1].inputs),[0,1]);assert.equal(g.tensors[3].type,f.model.subgraphs[0].tensors[2].type);if(c.name==='empty-indices'){const t=g.tensors[1],b=candidate.raw.buffers[t.buffer];assert.ok(t.buffer>0);assert.deepEqual(Array.from(t.shape),[0]);assert.ok(b.data instanceof Uint8Array);assert.equal(b.data.byteLength,0);}
            assert.deepEqual(g.tensors[1].quantization,f.model.subgraphs[0].tensors[1].quantization);assert.ok(g.operators.every(op=>op.builtin_options.axis===(c.spec.options?.axis??1)&&op.builtin_options.batch_dims===(c.spec.options?.batch_dims??0)));assert.equal(g.inputs.length,1);
            await page.locator('#edit-view-report').click();await until(()=>document.querySelector('#export-report-dialog').open);
            const operatorDetails=page.locator('#export-report-operators details').filter({hasText:'逐 OP 靜態驗證'});
            await operatorDetails.locator('summary').click();await until(()=>Array.from(document.querySelectorAll('#export-report-operators details')).find(d=>d.firstElementChild?.textContent.startsWith('逐 OP 靜態驗證'))?.querySelectorAll('li').length===2);
            const text=await operatorDetails.textContent();assert.match(text,/GATHER/);assert.match(text,c.status==='passed'?/已檢查（靜態規則）/:/未檢查/);await operatorDetails.locator('li').last().scrollIntoViewIfNeeded();
            const layout=await read(()=>{const d=document.querySelector('#export-report-dialog'),r=d.getBoundingClientRect();return {width:innerWidth,height:innerHeight,documentWidth:document.documentElement.scrollWidth,left:r.left,right:r.right,top:r.top,bottom:r.bottom,scroll:d.scrollWidth,client:d.clientWidth,font:document.querySelector('#edit-font').value};});assert.equal(layout.font,'32');assert.ok(layout.documentWidth<=layout.width+1&&layout.left>=0&&layout.right<=layout.width+1&&layout.top>=0&&layout.bottom<=layout.height+1&&layout.scroll<=layout.client+1);await page.screenshot({path:path.join(directory,`gather-${c.name}-report-32px.png`)});await page.locator('#close-export-report').click();
            await page.locator('#explore-mode').click();await choose(output);await page.locator('#layers-tab').click();await page.locator('#query').fill('Gather');await until(()=>document.querySelector('#result-count').textContent==='2 筆結果');await page.locator('.result-item').first().click();await ready();report.cases.push({name:c.name,status:c.status,operators:2,reopenedOperators:2,checked:record.operatorSummary.checked,unchecked:record.operatorSummary.unchecked,weights:c.name==='empty-indices'?'explicit-empty-vectors-preserved':'identical',byteComparisonStatus:verified.byteComparison.status,comparedBytes:verified.byteComparison.bytes,outputSHA256:verified.outputSHA256,layout});await close();
        }
        const end=Date.now()+5000;while(workers.some(w=>!w.closed)&&Date.now()<end)await new Promise(r=>setTimeout(r,30));assert.equal(workers.length,8);assert.ok(workers.every(w=>w.closed));assert.equal(runtime.length,0);assert.equal(downloads,6);Object.assign(report,{status:'passed',modelWorkers:workers.length,automaticRuntimeWorkers:runtime.length,workersClosed:true,downloads});check('GATHER dtype/rank rejection, negative batch and empty indices native wiring, explicit dynamic unknown status, 32px reports, six actual downloads and reopen/search without interpreter');return report;
    }catch(error){report.error=error.stack||String(error);error.gatherValidation=report;throw error;}
    finally{page.off('worker',onWorker);page.off('download',onDownload);}
}
