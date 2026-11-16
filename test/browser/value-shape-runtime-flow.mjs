import assert from 'node:assert/strict';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {once} from 'node:events';
import path from 'node:path';
import {valueShapeFixtures} from '../value-shape-fixture.mjs';
import {Archive} from '../../vendor/netron/zip.js';
import {RUNTIME_ENGINE,RUNTIME_INTERPRETER_ENGINE} from '../../src/tflite-runtime-policy.js';
export const VALUE_SHAPE_RUNTIME_CHECK='Manual runtime preserves exact BIN inputs and numerical outputs for input-dependent TRANSPOSE/EXPAND_DIMS/RESHAPE, literal counterparts and integer controls; no automatic execution';
export async function valueShapeRuntimeFlow({page,read,directory,check}){
    const report={status:'failed',cases:[],modelWorkers:0,runtimeWorkers:0,downloads:0};
    const onWorker=w=>{if(/\/model-worker\.js(?:\?|$)/.test(w.url()))report.modelWorkers++;else if(/\/tflite-runtime-worker\.js(?:\?|$)/.test(w.url()))report.runtimeWorkers++;};
    const onDownload=()=>report.downloads++;
    page.on('worker',onWorker);page.on('download',onDownload);
    const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
    const until=async(fn,...args)=>{const end=Date.now()+35000;while(!await read(fn,...args)){assert.ok(Date.now()<end,'Value-shape runtime timeout: '+fn);await new Promise(r=>setTimeout(r,50));}};
    const choose=async(file,button)=>{const event=page.waitForEvent('filechooser');await page.locator(button).click();await(await event).setFiles(file);};
    const ready=()=>until(()=>document.querySelector('#model-tabs').getAttribute('aria-busy')==='false'&&document.querySelector('#loading-card').hidden&&document.querySelector('#target').getAttribute('aria-busy')==='false');
    try{
        await mkdir(directory,{recursive:true});
        for(const c of await valueShapeFixtures()){
            const file=path.join(directory,c.name+'.tflite');await writeFile(file,c.bytes);const files=[];
            for(const [i,values]of c.values.entries()){const bin=path.join(directory,c.name+'-'+i+'.bin');await writeFile(bin,Buffer.from(values.buffer,values.byteOffset,values.byteLength));files.push(bin);}
            await choose(file,'#open-model');await until(name=>document.querySelector('#file-name').textContent===name,path.basename(file));await ready();
            await page.locator('#graph-font-size').selectOption('32');await ready();
            const before=report.runtimeWorkers;await page.locator('#run-mode').click();await until(()=>!document.querySelector('#run-workspace').hidden&&document.querySelector('#run-workspace').getAttribute('aria-busy')==='false');
            assert.equal(report.runtimeWorkers,before);await page.locator('#edit-runtime-check').click();await until(()=>document.querySelector('#edit-runtime-dialog').open);
            assert.equal(await page.locator('#edit-runtime-inputs fieldset').count(),files.length);
            for(const [i,bin]of files.entries()){await page.locator('#runtime-input-mode-'+i).selectOption('bin');await choose(bin,'#runtime-input-file-'+i);}
            await page.locator('#edit-runtime-run').click();await until(()=>!!document.querySelector('#edit-runtime-result').dataset.status&&document.querySelector('#run-workspace').getAttribute('aria-busy')==='false');
            const status=await page.locator('#edit-runtime-result').getAttribute('data-status'),message=await page.locator('#edit-runtime-result').textContent();assert.equal(status,'passed',c.name+': '+message);
            const event=page.waitForEvent('download');await page.locator('#edit-runtime-download').click();const download=await event;assert.equal(await download.failure(),null);
            const zipFile=path.join(directory,c.name+'.zip');await download.saveAs(zipFile);await download.delete();
            const bytes=new Uint8Array(await readFile(zipFile)),zip=Archive.open(bytes,'zip'),manifest=JSON.parse(new TextDecoder().decode(zip.entries.get('manifest.json').peek()));
            assert.equal(manifest.modelSHA256,sha(c.bytes));assert.equal(manifest.validation.engine,c.axisInput?RUNTIME_INTERPRETER_ENGINE:RUNTIME_ENGINE);
            for(const [i,bin]of files.entries())assert.equal(sha(zip.entries.get('inputs-'+i+'.bin').peek()),sha(await readFile(bin)));
            const output=zip.entries.get('outputs-0.bin').peek().slice(),values=[...new (c.values[0].constructor)(output.buffer)];assert.deepEqual(values,c.expected,c.name);
            assert.equal(await read(()=>document.documentElement.scrollWidth<=innerWidth),true);
            await page.screenshot({path:path.join(directory,c.name+'.png')});
            const worker=page.workers().find(w=>/\/model-worker\.js(?:\?|$)/.test(w.url()));assert.ok(worker);
            const closed=once(worker,'close');await page.locator('#explore-mode').click();await page.locator('#close-model').click();await closed;
            await until(()=>document.querySelector('#file-name').textContent==='尚未開啟模型'||document.querySelector('#model-tabs').children.length===0);
            assert.equal(report.runtimeWorkers,before+1);
            report.cases.push({name:c.name,modelSHA256:sha(c.bytes),zipSHA256:sha(bytes),engine:manifest.validation.engine,status,inputsMatch:true,numericMatches:true,expected:c.expected,output:values,outputShape:manifest.outputs[0].shape,automaticRuntime:false});
        }
        assert.equal(report.modelWorkers,8);assert.equal(report.runtimeWorkers,8);assert.equal(report.downloads,8);report.status='passed';check(VALUE_SHAPE_RUNTIME_CHECK);return report;
    }finally{page.off('worker',onWorker);page.off('download',onDownload);}
}
