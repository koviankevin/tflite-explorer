import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import path from 'node:path';
import {legacyShapeFixture} from '../legacy-shape-fixture.mjs';
import {Archive} from '../../vendor/netron/zip.js';
const hash=b=>createHash('sha256').update(b).digest('hex');

export async function runtimePartialIOFlow({page,read,base,directory,check}){
    const workers=[],report={status:'failed',cases:[],modelWorkers:0,manualRuntimeWorkers:0,downloads:0};
    const onWorker=w=>{const row={url:w.url(),closed:false};workers.push(row);w.once('close',()=>{row.closed=true;});};
    const onDownload=()=>report.downloads++;page.on('worker',onWorker);page.on('download',onDownload);
    const until=async(fn,...args)=>{const end=Date.now()+35000;while(!await read(fn,...args)){assert.ok(Date.now()<end,'Partial IO UI timeout: '+fn);await new Promise(r=>setTimeout(r,60));}};
    const ready=()=>until(()=>document.querySelector('#model-tabs').getAttribute('aria-busy')==='false'&&document.querySelector('#loading-card').hidden&&document.querySelector('#target').getAttribute('aria-busy')==='false');
    try{
        await page.goto(base,{waitUntil:'domcontentloaded'});await until(()=>!document.querySelector('#open-model').disabled);await page.setViewportSize({width:1280,height:640});
        for(const invalid of [true,false]){
            const f=await legacyShapeFixture('FULLY_CONNECTED',[[2,invalid?3:4],[5,4]],{output:[2,5]}),source=path.join(directory,invalid?'partial-io-invalid-fc.tflite':'partial-io-valid-fc.tflite');await writeFile(source,f.bytes,{flag:'wx'});
            const before=workers.filter(w=>/\/tflite-runtime-worker\.js/.test(w.url)).length,choose=page.waitForEvent('filechooser');await page.locator('#open-model').click();await(await choose).setFiles(source);await ready();await page.locator('#graph-font-size').selectOption('32');await page.locator('#run-mode').click();await until(()=>!document.querySelector('#run-workspace').hidden&&document.querySelector('#run-workspace').getAttribute('aria-busy')==='false');
            assert.equal(workers.filter(w=>/\/tflite-runtime-worker\.js/.test(w.url)).length,before);assert.equal(await page.locator('#edit-runtime-download').isDisabled(),true);
            for(const mode of invalid?['zero','random']:['zero']){
                await page.locator('#edit-runtime-check').click();await until(()=>document.querySelector('#edit-runtime-dialog').open);
                for(let i=0;i<3;i++)await page.locator(`#runtime-input-mode-${i}`).selectOption(mode);
                const downloads=report.downloads;await page.locator('#edit-runtime-run').click();await until(()=>document.querySelector('#run-workspace').getAttribute('aria-busy')==='false'&&!!document.querySelector('#edit-runtime-result').dataset.status);
                const text=await page.locator('#edit-runtime-result').textContent();assert.equal(await page.locator('#edit-runtime-result').getAttribute('data-status'),invalid?'failed':'passed');
                if(invalid){assert.match(text,/執行後輸出 shape/);assert.match(text,/部分保存/);assert.match(text,/strides or padding/);}else assert.ok(!text.includes('部分保存'));
                assert.equal(report.downloads,downloads);assert.equal(await page.locator('#edit-runtime-download').isDisabled(),false);
                const event=page.waitForEvent('download');await page.locator('#edit-runtime-download').click();const d=await event;assert.equal(await d.failure(),null);const filename=path.join(directory,`runtime-${invalid?'partial':'complete'}-${mode}.zip`);await d.saveAs(filename);await d.delete();
                const bytes=new Uint8Array(await readFile(filename)),zip=Archive.open(bytes,'zip'),m=JSON.parse(new TextDecoder().decode(zip.entries.get('manifest.json').peek()));assert.equal(m.version,invalid?2:1);assert.equal(m.modelSHA256,hash(f.bytes));assert.equal(m.validation.status,invalid?'failed':'passed');assert.equal(m.validation.invoked,true);assert.equal(m.inputs.length,3);
                for(let i=0;i<3;i++){const row=m.inputs[i];assert.equal(row.source,mode);assert.equal(zip.entries.get(`inputs-${i}.bin`).peek().byteLength,row.bytes);if(mode==='zero')assert.ok(zip.entries.get(`inputs-${i}.bin`).peek().every(n=>n===0));}
                if(invalid){assert.equal(m.capture.status,'partial');assert.equal(m.capture.saved,3);assert.equal(m.capture.missing.length,1);assert.equal(m.outputs[0].file,null);assert.equal(m.outputs[0].status,'not-saved');assert.match(m.outputs[0].reason,/strides or padding/);assert.equal(zip.entries.has('outputs-0.bin'),false);}else{assert.equal(m.capture,undefined);assert.deepEqual([...new Float32Array(zip.entries.get('outputs-0.bin').peek().slice().buffer)],new Array(10).fill(0));}
                const layout=await read(()=>({width:innerWidth,height:innerHeight,documentWidth:document.documentElement.scrollWidth,run:document.querySelector('#run-workspace').getBoundingClientRect().toJSON(),header:document.querySelector('.app-header').getBoundingClientRect().toJSON(),font:document.querySelector('#graph-font-size').value}));assert.ok(layout.documentWidth<=layout.width+1&&layout.run.top>=layout.header.bottom-1&&layout.run.height>=300);assert.equal(layout.font,'32');
                await page.screenshot({path:path.join(directory,`runtime-${invalid?'partial':'complete'}-${mode}-32px.png`)});
                report.cases.push({invalid,mode,status:m.validation.status,version:m.version,invoked:m.validation.invoked,archiveSHA256:hash(bytes),modelSHA256:m.modelSHA256,inputs:m.inputs.map(({file,bytes,source})=>({file,bytes,source})),outputs:m.outputs.map(({file,status,expectedBytes,bytes,reason})=>({file,status,expectedBytes,bytes,reason})),capture:m.capture??null,layout});
            }
            await page.locator('#close-model').click();await ready();assert.equal(await page.locator('#edit-runtime-download').isDisabled(),true);
        }
        const end=Date.now()+5000;while(workers.some(w=>!w.closed)&&Date.now()<end)await new Promise(r=>setTimeout(r,30));assert.ok(workers.every(w=>w.closed));report.modelWorkers=workers.filter(w=>/\/model-worker\.js/.test(w.url)).length;report.manualRuntimeWorkers=workers.filter(w=>/\/tflite-runtime-worker\.js/.test(w.url)).length;assert.equal(report.modelWorkers,2);assert.equal(report.manualRuntimeWorkers,3);assert.equal(report.downloads,3);report.workersClosed=true;report.status='passed';check('manual CPU failure preserves readable inputs in partial IO ZIP with missing padded output; complete IO remains v1 at32px');return report;
    }catch(error){report.error=error.stack||String(error);error.runtimePartialIO=report;throw error;}
    finally{page.off('worker',onWorker);page.off('download',onDownload);}
}
