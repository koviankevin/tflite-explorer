import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {batchMatmulFixture} from '../batch-matmul-fixture.mjs';
import {verifyExportFiles} from '../../scripts/verify-export.mjs';
import {parseModel} from '../../src/model-engine.js';
export async function batchMatmulValidationFlow({page,read,base,directory,check}){
    const workers=[],runtime=[],report={status:'failed',cases:[],modelWorkers:0,automaticRuntimeWorkers:0};let downloads=0;
    const onWorker=w=>{const row={closed:false};if(/\/model-worker\.js(?:\?|$)/.test(w.url()))workers.push(row);else if(/\/tflite-runtime-worker\.js(?:\?|$)/.test(w.url()))runtime.push(row);else return;w.once('close',()=>row.closed=true);};
    const onDownload=()=>downloads++;page.on('worker',onWorker);page.on('download',onDownload);
    const until=async fn=>{const end=Date.now()+30000;while(!await read(fn)){assert.ok(Date.now()<end,'BMM UI timeout: '+fn);await new Promise(r=>setTimeout(r,60));}};
    const ready=()=>until(()=>document.querySelector('#model-tabs').getAttribute('aria-busy')==='false'&&document.querySelector('#loading-card').hidden&&document.querySelector('#target').getAttribute('aria-busy')==='false');
    const editReady=()=>until(()=>document.querySelector('#edit-workspace').getAttribute('aria-busy')==='false');
    const choose=async file=>{const e=page.waitForEvent('filechooser');await page.locator('#open-model').click();await(await e).setFiles(file);await ready();};
    const save=async(selector,name)=>{const e=page.waitForEvent('download');await page.locator(selector).click();const d=await e;assert.equal(await d.failure(),null);const p=path.join(directory,name);await d.saveAs(p);await d.delete();return p;};
    const close=async(discard=false)=>{const accept=d=>{assert.equal(d.type(),'confirm');assert.match(d.message(),/尚未匯出/);return d.accept();};if(discard)page.once('dialog',accept);try{await page.locator('#explore-mode').click();await page.locator('#close-model').click();await ready();}finally{page.off('dialog',accept);}};
    const quantization={scale:Float32Array.of(1),zero_point:BigInt64Array.of(0n),quantized_dimension:0};
    const metadata=JSON.parse(await readFile(new URL('../../vendor/netron/tflite-metadata.json',import.meta.url),'utf8'));
    const cases=[
        {name:'invalid-result-dtype',spec:{output:{shape:[2,2],type:2}},reject:/BATCH_MATMUL.*dtype/},
        {name:'invalid-rank',spec:{lhs:{shape:[1,1,1,1,2,2],type:0},output:{shape:[1,1,1,1,2,2],type:0}},reject:/BATCH_MATMUL.*rank/},
        {name:'hybrid',spec:{rhs:{shape:[2,2],type:9,values:[1,0,0,1],quantization},options:{asymmetric_quantize_inputs:true}},status:'passed'},
        {name:'int8-to-int32',spec:{lhs:{shape:[2,2],type:9},rhs:{shape:[2,2],type:9,values:[1,0,0,1]},output:{shape:[2,2],type:2}},status:'passed'},
        {name:'mixed-precision-unknown',spec:{rhs:{shape:[2,2],type:1,values:[0x3c00,0,0,0x3c00]}},status:'not-run'}
    ];
    try{
        await page.goto(base,{waitUntil:'domcontentloaded'});await until(()=>!document.querySelector('#open-model').disabled);await page.setViewportSize({width:1280,height:640});
        for(const c of cases){
            const f=await batchMatmulFixture(c.spec),source=path.join(directory,`matmul-${c.name}-source.tflite`);await writeFile(source,f.bytes,{flag:'wx'});await choose(source);
            await page.locator('#layers-tab').click();await page.locator('#query').fill('#0');await until(()=>document.querySelector('#result-count').textContent==='1 筆結果');await page.locator('.result-item').click();await ready();await page.locator('#graph-font-size').selectOption('32');await ready();
            await page.locator('#edit-mode').click();await editReady();await page.locator('#edit-font').selectOption('32');await editReady();await page.locator('[data-edit-node="op:0:0"] .edit-node-title').click();await page.locator('#edit-add-after').click();await until(()=>document.querySelectorAll('.edit-node.added').length===1);await editReady();
            // The accumulator's int32 output is not a valid int8 lhs. Copy the
            // original input edge through the same native wiring UI instead.
            await page.locator('[data-edit-output="t:0:0"]').click();await page.locator('[data-edit-input="new:1"][data-edit-slot="0"]').click();await editReady();await page.locator('[data-edit-node="new:1"] .edit-node-title').click();await page.locator('#edit-expose').check();
            if(c.reject){
                const before=downloads;await page.locator('#edit-export').click();await editReady();await until(()=>document.querySelector('#edit-message').textContent.includes('BATCH_MATMUL'));
                const reason=await page.locator('#edit-message').textContent();assert.match(reason,c.reject);assert.match(reason,/Subgraph #0.*OP #0.*inputs.*outputs/);assert.equal(downloads,before);
                await page.screenshot({path:path.join(directory,`matmul-${c.name}-rejected-32px.png`)});report.cases.push({name:c.name,status:'rejected',downloads:0,reason});await close(true);continue;
            }
            const output=await save('#edit-export',`matmul-${c.name}-edited.tflite`);await until(()=>!document.querySelector('#edit-download-report').disabled);const reportFile=await save('#edit-download-report',`matmul-${c.name}.report.json`),record=JSON.parse(await readFile(reportFile,'utf8'));
            assert.equal(record.operatorValidation.length,2);assert.ok(record.operatorValidation.every(v=>v.type==='BATCH_MATMUL'&&v.status===c.status));assert.equal(record.operatorSummary.checked,c.status==='passed'?2:0);assert.equal(record.operatorSummary.unchecked,c.status==='passed'?0:2);assert.ok(record.checks.filter(v=>v.id.startsWith('runtime')).every(v=>v.status==='not-run'));
            const verified=await verifyExportFiles({report:record,source,output});assert.equal(verified.byteComparison.status,'passed');const bytes=new Uint8Array(await readFile(output)),candidate=await parseModel((o,n)=>bytes.subarray(o,o+n),bytes.length,metadata),g=candidate.raw.subgraphs[0];assert.equal(g.operators.length,2);assert.deepEqual(Array.from(g.operators[1].inputs),[0,1]);assert.equal(g.tensors[3].type,f.model.subgraphs[0].tensors[2].type);
            assert.deepEqual(g.tensors[1].quantization,f.model.subgraphs[0].tensors[1].quantization);assert.ok(g.operators.every(op=>op.builtin_options.asymmetric_quantize_inputs===!!c.spec.options?.asymmetric_quantize_inputs));
            await page.locator('#edit-view-report').click();await until(()=>document.querySelector('#export-report-dialog').open);await page.locator('#export-report-operators summary').click();await until(()=>document.querySelectorAll('#export-report-operators li').length===2);const text=await page.locator('#export-report-operators').textContent();assert.match(text,/BATCH_MATMUL/);assert.match(text,c.status==='passed'?/已檢查（靜態規則）/:/未檢查/);
            const layout=await read(()=>{const d=document.querySelector('#export-report-dialog'),r=d.getBoundingClientRect();return {width:innerWidth,height:innerHeight,documentWidth:document.documentElement.scrollWidth,left:r.left,right:r.right,top:r.top,bottom:r.bottom,scroll:d.scrollWidth,client:d.clientWidth,font:document.querySelector('#edit-font').value};});assert.equal(layout.font,'32');assert.ok(layout.documentWidth<=layout.width+1&&layout.left>=0&&layout.right<=layout.width+1&&layout.top>=0&&layout.bottom<=layout.height+1&&layout.scroll<=layout.client+1);await page.screenshot({path:path.join(directory,`matmul-${c.name}-report-32px.png`)});await page.locator('#close-export-report').click();
            await page.locator('#explore-mode').click();await choose(output);await page.locator('#layers-tab').click();await page.locator('#query').fill('BatchMatMul');await until(()=>document.querySelector('#result-count').textContent==='2 筆結果');await page.locator('.result-item').first().click();await ready();report.cases.push({name:c.name,status:c.status,operators:2,reopenedOperators:2,checked:record.operatorSummary.checked,unchecked:record.operatorSummary.unchecked,weights:'identical',outputSHA256:verified.outputSHA256,layout});await close();
        }
        const end=Date.now()+5000;while(workers.some(w=>!w.closed)&&Date.now()<end)await new Promise(r=>setTimeout(r,30));assert.equal(workers.length,8);assert.ok(workers.every(w=>w.closed));assert.equal(runtime.length,0);assert.equal(downloads,6);Object.assign(report,{status:'passed',modelWorkers:workers.length,automaticRuntimeWorkers:runtime.length,workersClosed:true,downloads});check('BMM dtype/rank rejection, legal hybrid/int32 accumulator native wiring, unknown mixed precision, 32px reports, six actual downloads and reopen/search without interpreter');return report;
    }catch(error){report.error=error.stack||String(error);error.matmulValidation=report;throw error;}
    finally{page.off('worker',onWorker);page.off('download',onDownload);}
}
