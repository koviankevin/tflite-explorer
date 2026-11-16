import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {once} from 'node:events';
import path from 'node:path';
import {axisTransformFixture} from '../axis-transform-fixture.mjs';
import {verifyExportFiles} from '../../scripts/verify-export.mjs';
export const AXIS_TRANSFORM_CHECK='TRANSPOSE/EXPAND_DIMS reject invalid axis metadata before download; valid int64, signed and dynamic parameters export/reopen at 32px';
export async function axisTransformFlow({page,read,base,directory,check}){
    const report={status:'failed',cases:[],modelWorkers:0,runtimeWorkers:0};let downloads=0;
    const onDownload=()=>downloads++,onWorker=w=>{if(/\/tflite-runtime-worker\.js(?:\?|$)/.test(w.url()))report.runtimeWorkers++;};
    page.on('download',onDownload);page.on('worker',onWorker);
    const until=async(fn,...args)=>{const end=Date.now()+30000;while(!await read(fn,...args)){assert.ok(Date.now()<end,'Axis metadata UI timeout: '+fn);await new Promise(r=>setTimeout(r,60));}};
    const ready=()=>until(()=>document.querySelector('#model-tabs').getAttribute('aria-busy')==='false'&&document.querySelector('#loading-card').hidden&&document.querySelector('#target').getAttribute('aria-busy')==='false');
    const choose=async file=>{const e=page.waitForEvent('filechooser');await page.locator('#open-model').click();await(await e).setFiles(file);report.modelWorkers++;await until(name=>document.querySelector('#file-name').textContent===name,path.basename(file));await ready();};
    const close=async(discard=false)=>{
        const worker=page.workers().find(w=>/\/model-worker\.js(?:\?|$)/.test(w.url()));assert.ok(worker);const closed=once(worker,'close');
        if(discard)page.once('dialog',dialog=>dialog.accept());await page.locator('#explore-mode').click();await page.locator('#close-model').click();await closed;
    };
    const save=async(selector,name)=>{const e=page.waitForEvent('download');await page.locator(selector).click();const d=await e;assert.equal(await d.failure(),null);const file=path.join(directory,name);await d.saveAs(file);await d.delete();return file;};
    try{
        await page.setViewportSize({width:1280,height:640});await page.goto(base);await until(()=>!document.querySelector('#open-model').disabled);
        for(const [name,options,expected,reason] of [
            ['transpose-matrix',{axisShape:[1,2]},'rejected','一維'],
            ['expand-float',{name:'EXPAND_DIMS',axes:[1],axisShape:[],axisType:0,output:[2,1,3],dynamic:true},'rejected','int64'],
            ['expand-count',{name:'EXPAND_DIMS',axes:[0,1],axisShape:[2],output:[1,2,3],dynamic:true},'rejected','1 個元素'],
            ['transpose-signed',{axes:[-1,0]},'passed'],
            ['expand-int64',{name:'EXPAND_DIMS',axes:[-1],axisShape:[],axisType:4,output:[2,3,1]},'passed'],
            ['expand-dynamic',{name:'EXPAND_DIMS',axes:[0],axisShape:[1],output:[1,2,3],axisInput:true},'not-run']
        ]){
            const f=await axisTransformFixture(options),source=path.join(directory,name+'.tflite');await writeFile(source,f.bytes);await choose(source);
            await page.locator('#query').fill('#0');await until(()=>document.querySelector('#result-count').textContent==='1 筆結果');await page.locator('.result-item').click();await ready();
            await page.locator('#edit-mode').click();await until(()=>document.body.classList.contains('editing-model')&&document.querySelector('#edit-workspace').getAttribute('aria-busy')==='false');await page.locator('#edit-font').selectOption('32');
            await page.locator('[data-edit-node="op:0:0"] .edit-node-title').click();await page.locator('#edit-add-after').click();await until(()=>document.querySelectorAll('.edit-node.added').length===1);await page.locator('#edit-expose').check();
            if(expected==='rejected'){
                const before=downloads;await page.locator('#edit-export').click();await until(needle=>document.querySelector('#edit-workspace').getAttribute('aria-busy')==='false'&&document.querySelector('#edit-message').textContent.includes(needle),reason);
                const text=await page.locator('#edit-message').textContent();assert.match(text,/Subgraph #0.*OP #0/);assert.equal(downloads,before);await page.screenshot({path:path.join(directory,name+'.png')});
                report.cases.push({name,status:'rejected',reason:text,downloads:0});await close(true);continue;
            }
            const output=await save('#edit-export',name+'-edited.tflite');await until(()=>!document.querySelector('#edit-download-report').disabled);
            const recordFile=await save('#edit-download-report',name+'-report.json'),record=JSON.parse(await readFile(recordFile,'utf8'));
            assert.deepEqual(record.operatorValidation.map(o=>o.status),[expected,expected]);assert.ok(record.checks.filter(c=>c.id.startsWith('runtime')).every(c=>c.status==='not-run'));
            const audit=await verifyExportFiles({report:record,source,output});assert.equal(audit.byteComparison.status,'passed');
            await page.screenshot({path:path.join(directory,name+'.png')});await close();await choose(output);await until(()=>document.querySelector('#file-stats').textContent.includes('2 layers'));await close();
            report.cases.push({name,status:expected,operators:2,reopened:true,byteComparison:true,automaticRuntime:false});
        }
        assert.equal(report.modelWorkers,9);assert.equal(report.runtimeWorkers,0);assert.equal(await read(()=>document.documentElement.scrollWidth<=innerWidth),true);
        report.status='passed';check(AXIS_TRANSFORM_CHECK);return report;
    }finally{page.off('download',onDownload);page.off('worker',onWorker);}
}
