import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {spatialFixture} from '../spatial-fixture.mjs';
import {FlatbufferWriter} from '../../src/flatbuffer-writer.js';
import {verifyExportFiles} from '../../scripts/verify-export.mjs';
import {parseModel} from '../../src/model-engine.js';

export async function spatialMetadataValidationFlow({page,read,base,directory,check}){
    const workers=[],runtime=[],report={status:'failed',cases:[],modelWorkers:0,automaticRuntimeWorkers:0};let downloads=0;
    const onWorker=w=>{const row={closed:false};if(/\/model-worker\.js(?:\?|$)/.test(w.url()))workers.push(row);else if(/\/tflite-runtime-worker\.js(?:\?|$)/.test(w.url()))runtime.push(row);else return;w.once('close',()=>row.closed=true);};
    const onDownload=()=>downloads++;page.on('worker',onWorker);page.on('download',onDownload);
    const until=async fn=>{const end=Date.now()+30000;while(!await read(fn)){assert.ok(Date.now()<end,'Spatial UI timeout: '+fn);await new Promise(r=>setTimeout(r,60));}};
    const ready=()=>until(()=>document.querySelector('#model-tabs').getAttribute('aria-busy')==='false'&&document.querySelector('#loading-card').hidden&&document.querySelector('#target').getAttribute('aria-busy')==='false');
    const editReady=()=>until(()=>document.querySelector('#edit-workspace').getAttribute('aria-busy')==='false');
    const choose=async file=>{const e=page.waitForEvent('filechooser');await page.locator('#open-model').click();await(await e).setFiles(file);await ready();};
    const save=async(selector,name)=>{const e=page.waitForEvent('download');await page.locator(selector).click();const d=await e;assert.equal(await d.failure(),null);const p=path.join(directory,name);await d.saveAs(p);await d.delete();return p;};
    const close=async(discard=false)=>{const accept=d=>{assert.equal(d.type(),'confirm');assert.match(d.message(),/尚未匯出/);return d.accept();};if(discard)page.once('dialog',accept);try{await page.locator('#explore-mode').click();await page.locator('#close-model').click();await ready();}finally{page.off('dialog',accept);}};
    const metadata=JSON.parse(await readFile(new URL('../../vendor/netron/tflite-metadata.json',import.meta.url),'utf8'));
    const dynamic=g=>{g.tensors[0].shape_signature=Int32Array.of(-1,3,3,1);};
    const cases=[
        {name:'invalid-dynamic-filter-rank',type:'CONV_2D',mutate:g=>{dynamic(g);g.tensors[1].shape=Int32Array.of(1,2,2);},reject:/CONV_2D.*filter.*四維/},
        {name:'invalid-dynamic-bias-dtype',type:'DEPTHWISE_CONV_2D',mutate:g=>{dynamic(g);g.tensors[2].type=2;},reject:/DEPTHWISE_CONV_2D.*bias dtype/},
        {name:'invalid-dynamic-output-rank',type:'AVERAGE_POOL_2D',mutate:g=>{dynamic(g);g.tensors[1].shape=Int32Array.of(2,2,1);g.tensors[1].shape_signature=Int32Array.of(-1,2,1);},reject:/AVERAGE_POOL_2D.*output rank/},
        {name:'static-conv',type:'CONV_2D',status:'passed'},
        {name:'dynamic-depthwise',type:'DEPTHWISE_CONV_2D',mutate:dynamic,status:'not-run'},
        {name:'static-pool',type:'MAX_POOL_2D',status:'passed'}
    ];
    try{
        await page.goto(base,{waitUntil:'domcontentloaded'});await until(()=>!document.querySelector('#open-model').disabled);await page.setViewportSize({width:1280,height:640});
        for(const c of cases){
            const f=spatialFixture(c.type);c.mutate?.(f.model.subgraphs[0]);const blob=new FlatbufferWriter().finish(f.model,new Blob()),sourceBytes=new Uint8Array(await blob.arrayBuffer()),original=(await parseModel((o,n)=>sourceBytes.subarray(o,o+n),sourceBytes.length,metadata)).raw.subgraphs[0],source=path.join(directory,`spatial-${c.name}-source.tflite`);await writeFile(source,sourceBytes,{flag:'wx'});await choose(source);
            await page.locator('#layers-tab').click();await page.locator('#query').fill('#0');await until(()=>document.querySelector('#result-count').textContent==='1 筆結果');await page.locator('.result-item').click();await ready();await page.locator('#graph-font-size').selectOption('32');await ready();
            await page.locator('#edit-mode').click();await editReady();await page.locator('#edit-font').selectOption('32');await editReady();await page.locator('[data-edit-node="op:0:0"] .edit-node-title').click();await page.locator('#edit-add-after').click();await until(()=>document.querySelectorAll('.edit-node.added').length===1);await editReady();
            await page.locator('[data-edit-output="t:0:0"]').click();await page.locator('[data-edit-input="new:1"][data-edit-slot="0"]').click();await editReady();await page.locator('[data-edit-node="new:1"] .edit-node-title').click();await page.locator('#edit-expose').check();
            if(c.reject){
                const before=downloads;await page.locator('#edit-export').click();await editReady();await until(()=>document.querySelector('#edit-message').textContent.includes('Subgraph #0'));
                const reason=await page.locator('#edit-message').textContent();assert.match(reason,c.reject);assert.match(reason,/Subgraph #0.*OP #0.*inputs.*outputs/);assert.equal(downloads,before);
                await page.screenshot({path:path.join(directory,`spatial-${c.name}-rejected-32px.png`)});report.cases.push({name:c.name,type:c.type,status:'rejected',downloads:0,reason});await close(true);continue;
            }
            const output=await save('#edit-export',`spatial-${c.name}-edited.tflite`);await until(()=>!document.querySelector('#edit-download-report').disabled);const reportFile=await save('#edit-download-report',`spatial-${c.name}.report.json`),record=JSON.parse(await readFile(reportFile,'utf8'));
            assert.equal(record.operatorValidation.length,2);assert.ok(record.operatorValidation.every(v=>v.type===c.type&&v.status===c.status));assert.equal(record.operatorSummary.checked,c.status==='passed'?2:0);assert.equal(record.operatorSummary.unchecked,c.status==='passed'?0:2);assert.ok(record.checks.filter(v=>v.id.startsWith('runtime')).every(v=>v.status==='not-run'));
            const verified=await verifyExportFiles({report:record,source,output});assert.equal(verified.byteComparison.status,c.type==='MAX_POOL_2D'?'not-applicable':'passed');if(c.type==='MAX_POOL_2D')assert.equal(verified.byteComparison.bytes,0);const bytes=new Uint8Array(await readFile(output)),candidate=await parseModel((o,n)=>bytes.subarray(o,o+n),bytes.length,metadata),g=candidate.raw.subgraphs[0];assert.equal(g.operators.length,2);assert.equal(g.inputs.length,1);
            for(const op of g.operators){assert.deepEqual(Array.from(op.inputs),Array.from(original.operators[0].inputs));assert.deepEqual(op.builtin_options,original.operators[0].builtin_options);assert.equal(candidate.raw.operator_codes[op.opcode_index].version,f.model.operator_codes[0].version);}
            for(const [id,t]of original.tensors.entries()){assert.equal(g.tensors[id].type,t.type);assert.deepEqual(g.tensors[id].shape,t.shape);if(t.shape_signature)assert.deepEqual(g.tensors[id].shape_signature,t.shape_signature);}
            await page.locator('#edit-view-report').click();await until(()=>document.querySelector('#export-report-dialog').open);const details=page.locator('#export-report-operators details').filter({hasText:'逐 OP 靜態驗證'});await details.locator('summary').click();await until(()=>Array.from(document.querySelectorAll('#export-report-operators details')).find(d=>d.firstElementChild?.textContent.startsWith('逐 OP 靜態驗證'))?.querySelectorAll('li').length===2);
            const text=await details.textContent();assert.match(text,new RegExp(c.type));assert.match(text,c.status==='passed'?/已檢查（靜態規則）/:/未檢查/);if(c.status==='not-run')assert.match(text,/動態|未知/);await details.locator('li').last().scrollIntoViewIfNeeded();
            const layout=await read(()=>{const d=document.querySelector('#export-report-dialog'),r=d.getBoundingClientRect();return {width:innerWidth,height:innerHeight,documentWidth:document.documentElement.scrollWidth,left:r.left,right:r.right,top:r.top,bottom:r.bottom,scroll:d.scrollWidth,client:d.clientWidth,font:document.querySelector('#edit-font').value};});assert.equal(layout.font,'32');assert.ok(layout.documentWidth<=layout.width+1&&layout.left>=0&&layout.right<=layout.width+1&&layout.top>=0&&layout.bottom<=layout.height+1&&layout.scroll<=layout.client+1);await page.screenshot({path:path.join(directory,`spatial-${c.name}-report-32px.png`)});await page.locator('#close-export-report').click();
            await page.locator('#explore-mode').click();await choose(output);await page.locator('#layers-tab').click();await page.locator('#query').fill(candidate.graphs[0].graph.nodes[0].type.name);await until(()=>document.querySelector('#result-count').textContent==='2 筆結果');await page.locator('.result-item').first().click();await ready();report.cases.push({name:c.name,type:c.type,status:c.status,operators:2,reopenedOperators:2,checked:record.operatorSummary.checked,unchecked:record.operatorSummary.unchecked,weights:verified.byteComparison.status==='passed'?'identical':'not-applicable',comparedBytes:verified.byteComparison.bytes,outputSHA256:verified.outputSHA256,layout});await close();
        }
        const end=Date.now()+5000;while(workers.some(w=>!w.closed)&&Date.now()<end)await new Promise(r=>setTimeout(r,30));assert.equal(workers.length,9);assert.ok(workers.every(w=>w.closed));assert.equal(runtime.length,0);assert.equal(downloads,6);Object.assign(report,{status:'passed',modelWorkers:workers.length,automaticRuntimeWorkers:runtime.length,workersClosed:true,downloads});check('Spatial known-rank and bias-dtype rejection with dynamic extents, bounded static versus dynamic reports, native wiring, 32px, six actual downloads and reopen/search without automatic interpreter');return report;
    }catch(error){report.error=error.stack||String(error);error.spatialValidation=report;throw error;}
    finally{page.off('worker',onWorker);page.off('download',onDownload);}
}
