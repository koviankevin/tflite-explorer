// Public synthetic inputs, actual chooser/export UI; evaluate is read-only DOM.
import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {once} from 'node:events';
import path from 'node:path';
import {operandFixture} from '../operand-fixture.mjs';
import {physicalFixtureHeader} from '../physical-tflite-fixture.mjs';
import {verifyExportFiles} from '../../scripts/verify-export.mjs';
const t=(shape,type=0,values)=>({shape,type,...(values===undefined?{}:{values})});
export async function operatorValidationFlow({page,read,base,directory,check}){
    const report={cases:[],modelWorkers:0,automaticRuntimeWorkers:0};let downloads=0;
    const onDownload=()=>downloads++,runtimeWorkers=[];
    const onWorker=w=>{if(/tflite-runtime-worker/.test(w.url()))runtimeWorkers.push(w.url());};
    page.on('download',onDownload);page.on('worker',onWorker);
    const until=async fn=>{const end=Date.now()+30000;while(!await read(fn)){assert.ok(Date.now()<end,'OP verification UI timeout: '+fn);await new Promise(r=>setTimeout(r,75));}};
    const ready=()=>until(()=>document.querySelector('#model-tabs').getAttribute('aria-busy')==='false'&&document.querySelector('#loading-card').hidden&&document.querySelector('#target').getAttribute('aria-busy')==='false');
    const choose=async filename=>{const e=page.waitForEvent('filechooser');await page.locator('#open-model').click();await(await e).setFiles(filename);report.modelWorkers++;await ready();};
    const save=async(selector,name)=>{const e=page.waitForEvent('download');await page.locator(selector).click();const d=await e;assert.equal(await d.failure(),null);const filename=path.join(directory,name);await d.saveAs(filename);await d.delete();return filename;};
    const close=async(discard=false)=>{
        const w=page.workers().find(w=>/\/model-worker\.js(?:\?|$)/.test(w.url()));assert.ok(w);const closed=once(w,'close');
        const accept=d=>{assert.equal(d.type(),'confirm');assert.match(d.message(),/尚未匯出/);return d.accept();};
        if(discard)page.once('dialog',accept);
        try{await page.locator('#explore-mode').click();await page.locator('#close-model').click();await closed;}finally{page.off('dialog',accept);}
    };
    try{
        await page.goto(base,{waitUntil:'domcontentloaded'});await until(()=>!document.querySelector('#open-model').disabled);await page.setViewportSize({width:1280,height:640});
        for(const [name,inputs,outputs,options,expected]of [
            ['SPLIT',[t([],2,[1]),t([2,4])],[t([2,2]),t([2,2])],{num_splits:2},'passed'],
            ['PAD',[t([2]),t([1,2],2)],[t([5])],{},'not-run'],
            ['SLICE',[t([4]),t([1],2,[-1]),t([1],2,[2])],[t([2])],{},'rejected'],
            ['Large',[],[],{},'mixed']
        ]){
            let f;
            if(name==='Large'){const h=await physicalFixtureHeader({weightBytes:64}),bytes=new Uint8Array(h.payloadOffset+64);bytes.set(h.header);f={bytes};}
            else f=await operandFixture(name,inputs,outputs,options);
            const source=path.join(directory,`operand-${name}-source.tflite`);await writeFile(source,f.bytes,{flag:'wx'});await choose(source);
            await page.locator('#query').fill('#0');await until(()=>document.querySelector('#result-count').textContent==='1 筆結果');await page.locator('.result-item').click();await ready();
            await page.locator('#edit-mode').click();await until(()=>document.body.classList.contains('editing-model')&&document.querySelector('#edit-workspace').getAttribute('aria-busy')==='false');await page.locator('#edit-font').selectOption('32');
            await page.locator('[data-edit-node="op:0:0"] .edit-node-title').click();await page.locator('#edit-add-after').click();await until(()=>document.querySelectorAll('.edit-node.added').length===1);await page.locator('#edit-expose').check();
            if(expected==='rejected'){
                const before=downloads;await page.locator('#edit-export').click();await until(()=>document.querySelector('#edit-workspace').getAttribute('aria-busy')==='false'&&document.querySelector('#edit-message').textContent.includes('begin'));
                const reason=await page.locator('#edit-message').textContent();assert.match(reason,/Subgraph #0.*OP #0.*tensor.*begin/);assert.equal(downloads,before);report.cases.push({name,status:'rejected',reason,downloads:0});await close(true);continue;
            }
            const output=await save('#edit-export',`operand-${name}-edited.tflite`);await until(()=>!document.querySelector('#edit-download-report').disabled);
            const reportFile=await save('#edit-download-report',`operand-${name}.report.json`),reportText=await readFile(reportFile,'utf8'),record=JSON.parse(reportText);
            const count=name==='Large'?21006:2;assert.equal(record.operatorValidation.length,count);
            if(name==='Large'){assert.equal(record.operatorSummary.checked,21000);assert.equal(record.operatorSummary.unchecked,6);}
            else assert.ok(record.operatorValidation.every(c=>c.status===expected));
            assert.ok(record.checks.filter(c=>c.id.startsWith('runtime')).every(c=>c.status==='not-run'));
            const receipt=await verifyExportFiles({report:record,source,output});assert.ok(['passed','not-applicable'].includes(receipt.byteComparison.status));
            await page.locator('#edit-view-report').click();await page.locator('#export-report-operators summary').click();
            if(name==='Large'){
                await until(()=>document.querySelectorAll('#export-report-operators li').length===100);
                await page.locator('#export-report-operators button').click();await until(()=>document.querySelectorAll('#export-report-operators li').length===200);
            }else await until(()=>document.querySelectorAll('#export-report-operators li').length===2);
            const text=await page.locator('#export-report-operators').textContent();assert.match(text,expected==='passed'||name==='Large'?/已檢查（靜態規則）/:/未檢查.*動態/);assert.match(text,/OP #1/);
            const layout=await read(()=>{const d=document.querySelector('#export-report-dialog'),r=d.getBoundingClientRect();return {width:innerWidth,documentWidth:document.documentElement.scrollWidth,left:r.left,right:r.right,top:r.top,bottom:r.bottom,height:innerHeight,scroll:d.scrollWidth,client:d.clientWidth};});
            assert.ok(layout.documentWidth<=layout.width+1&&layout.left>=0&&layout.right<=layout.width+1&&layout.top>=0&&layout.bottom<=layout.height+1&&layout.scroll<=layout.client+1,JSON.stringify(layout));
            await page.screenshot({path:path.join(directory,`operand-${name}-report.png`)});await page.locator('#close-export-report').click();await close();
            if(name==='SPLIT'){await choose(output);await page.locator('#query').fill('Split');await until(()=>document.querySelector('#result-count').textContent==='2 筆結果');const w=page.workers().find(w=>/\/model-worker\.js(?:\?|$)/.test(w.url())),closed=once(w,'close');await page.locator('#close-model').click();await closed;}
            report.cases.push({name,status:expected,operators:count,...(name==='Large'?{reportBytes:Buffer.byteLength(reportText),visibleReportRows:200,scope:'full 21,005 OP structure with 64-byte synthetic weight; not a physical 1GiB claim'}:{}),byteStatus:receipt.byteComparison.status,outputSHA256:receipt.outputSHA256,layout});
        }
        assert.deepEqual(runtimeWorkers,[]);report.automaticRuntimeWorkers=runtimeWorkers.length;
        check('per-OP static validation, multi-output SPLIT export/reopen, dynamic reasons, invalid SLICE rejection and 32px/21k-OP paged report without automatic interpreter');return report;
    }catch(error){error.operatorValidation=report;throw error;}
    finally{page.off('download',onDownload);page.off('worker',onWorker);}
}
