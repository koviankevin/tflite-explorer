import assert from 'node:assert/strict';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {once} from 'node:events';
import path from 'node:path';
import {softmaxCases,softmaxFixture} from '../softmax-fixture.mjs';
import {parseModel} from '../../src/model-engine.js';
import {Archive} from '../../vendor/netron/zip.js';
import {verifyExportFiles} from '../../scripts/verify-export.mjs';
export const SOFTMAX_VALIDATION_CHECK='Softmax/LogSoftmax block malformed shape/dtype before export and runtime; float and mixed quantized edits reopen, manual float BIN outputs match at 32px';
const metadata=JSON.parse(await readFile(new URL('../../vendor/netron/tflite-metadata.json',import.meta.url),'utf8'));
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
export async function softmaxValidationFlow({page,read,base,directory,check}){
    const report={status:'failed',cases:[],modelWorkers:0,runtimeWorkers:0,downloads:0};
    const workers=[],onWorker=w=>{const runtime=/\/tflite-runtime-worker\.js(?:\?|$)/.test(w.url()),model=/\/model-worker\.js(?:\?|$)/.test(w.url());if(!runtime&&!model)return;report[runtime?'runtimeWorkers':'modelWorkers']++;const row={closed:false};workers.push(row);w.once('close',()=>row.closed=true);};
    const onDownload=()=>report.downloads++;page.on('worker',onWorker);page.on('download',onDownload);
    const until=async(fn,...args)=>{const end=Date.now()+35000;while(!await read(fn,...args)){assert.ok(Date.now()<end,'Softmax UI timeout: '+fn);await new Promise(r=>setTimeout(r,50));}};
    const ready=()=>until(()=>document.querySelector('#model-tabs').getAttribute('aria-busy')==='false'&&document.querySelector('#loading-card').hidden&&document.querySelector('#target').getAttribute('aria-busy')==='false');
    const choose=async(file,button='#open-model')=>{const e=page.waitForEvent('filechooser');await page.locator(button).click();await(await e).setFiles(file);if(button==='#open-model'){await until(name=>document.querySelector('#file-name').textContent===name,path.basename(file));await ready();}};
    const save=async(selector,name)=>{const e=page.waitForEvent('download');await page.locator(selector).click();const d=await e;assert.equal(await d.failure(),null);const file=path.join(directory,name);await d.saveAs(file);await d.delete();return file;};
    const close=async(discard=false)=>{const worker=page.workers().find(w=>/\/model-worker\.js(?:\?|$)/.test(w.url()));assert.ok(worker);const ended=once(worker,'close');if(discard)page.once('dialog',d=>d.accept());await page.locator('#explore-mode').click();await page.locator('#close-model').click();await ended;};
    const runtimeReady=async()=>{await page.locator('#run-mode').click();await until(()=>!document.querySelector('#run-workspace').hidden&&document.querySelector('#run-workspace').getAttribute('aria-busy')==='false');};
    const runtimeFinished=()=>until(()=>!!document.querySelector('#edit-runtime-result').dataset.status&&document.querySelector('#run-workspace').getAttribute('aria-busy')==='false');
    const copy=async()=>{
        await page.locator('#explore-mode').click();await page.locator('#layers-tab').click();await page.locator('#query').fill('#0');await until(()=>document.querySelector('#result-count').textContent==='1 筆結果');await page.locator('.result-item').click();await ready();
        await page.locator('#edit-mode').click();await until(()=>document.body.classList.contains('editing-model')&&document.querySelector('#edit-workspace').getAttribute('aria-busy')==='false');await page.locator('#edit-font').selectOption('32');
        await page.locator('[data-edit-node="op:0:0"] .edit-node-title').click();await page.locator('#edit-add-after').click();await until(()=>document.querySelectorAll('.edit-node.added').length===1);await page.locator('#edit-expose').check();
    };
    try{
        await mkdir(directory,{recursive:true});await page.setViewportSize({width:1280,height:640});await page.goto(base);await until(()=>!document.querySelector('#open-model').disabled);
        for(const name of ['SOFTMAX','LOG_SOFTMAX'])for(const [suffix,options,reason]of [['shape',{output:[6]},'rank'],['dtype',{outputType:2},'dtype']]){
            const f=await softmaxFixture({name,...options}),label=name+'-bad-'+suffix,source=path.join(directory,label+'.tflite');await writeFile(source,f.bytes);await choose(source);
            const before={workers:report.runtimeWorkers,downloads:report.downloads};await runtimeReady();await page.locator('#edit-runtime-check').click();await runtimeFinished();
            assert.equal(await page.locator('#edit-runtime-result').getAttribute('data-status'),'not-verified');const preflight=await page.locator('#edit-runtime-result').textContent();assert.match(preflight,new RegExp('subgraph 0.*OP #0.*'+name+'.*'+reason));assert.equal(await page.locator('#edit-runtime-dialog').getAttribute('open'),null);assert.equal(report.runtimeWorkers,before.workers);
            await copy();await page.locator('#edit-export').click();await until(needle=>document.querySelector('#edit-workspace').getAttribute('aria-busy')==='false'&&document.querySelector('#edit-message').textContent.includes(needle),reason);
            const error=await page.locator('#edit-message').textContent();assert.match(error,new RegExp('Subgraph #0.*OP #0.*'+name));assert.equal(report.downloads,before.downloads);assert.equal(report.runtimeWorkers,before.workers);await page.screenshot({path:path.join(directory,label+'.png')});
            report.cases.push({name:label,modelSHA256:sha(f.bytes),status:'rejected',preflight,error,runtimeWorkers:0,downloads:0});await close(true);
        }
        for(const f of (await softmaxCases()).filter(c=>c.options.inputType===undefined||c.options.outputType===7)){
            const source=path.join(directory,f.name+'.tflite');await writeFile(source,f.bytes);await choose(source);await page.locator('#graph-font-size').selectOption('32');await ready();
            const row={name:f.name,modelSHA256:sha(f.bytes),status:f.options.inputType===undefined?'passed':'not-run',automaticRuntime:false};
            if(row.status==='passed'){
                const before=report.runtimeWorkers,input=path.join(directory,f.name+'.bin');await writeFile(input,Buffer.from(f.values.buffer,f.values.byteOffset,f.values.byteLength));await runtimeReady();assert.equal(report.runtimeWorkers,before);await page.locator('#edit-runtime-check').click();await until(()=>document.querySelector('#edit-runtime-dialog').open);
                await page.locator('#runtime-input-mode-0').selectOption('bin');await choose(input,'#runtime-input-file-0');await page.locator('#edit-runtime-run').click();await runtimeFinished();assert.equal(await page.locator('#edit-runtime-result').getAttribute('data-status'),'passed',await page.locator('#edit-runtime-result').textContent());
                const zipFile=await save('#edit-runtime-download',f.name+'-io.zip'),bytes=new Uint8Array(await readFile(zipFile)),zip=Archive.open(bytes,'zip');assert.equal(sha(zip.entries.get('inputs-0.bin').peek()),sha(await readFile(input)));
                const manifest=JSON.parse(new TextDecoder().decode(zip.entries.get('manifest.json').peek()));assert.equal(manifest.modelSHA256,row.modelSHA256);row.output=[...new Float32Array(zip.entries.get('outputs-0.bin').peek().slice().buffer)];row.expected=f.expected;row.zipSHA256=sha(bytes);row.inputsMatch=true;
                assert.equal(row.output.length,f.expected.length);row.output.forEach((v,i)=>assert.ok(Math.abs(v-f.expected[i])<=1e-6));row.numericMatches=true;assert.equal(report.runtimeWorkers,before+1);
            }
            const before=report.runtimeWorkers;await copy();const output=await save('#edit-export',f.name+'-edited.tflite');await until(()=>!document.querySelector('#edit-download-report').disabled);
            const reportFile=await save('#edit-download-report',f.name+'-report.json'),record=JSON.parse(await readFile(reportFile,'utf8'));assert.deepEqual(record.operatorValidation.map(o=>o.status),[row.status,row.status]);assert.ok(record.checks.filter(c=>c.id.startsWith('runtime')).every(c=>c.status==='not-run'));assert.match(record.operatorValidation[0].reason,row.status==='passed'?/未讀 payload/:/混合/);
            const audit=await verifyExportFiles({report:record,source,output});assert.equal(audit.byteComparison.status,'not-applicable');row.byteComparison=audit.byteComparison.status;row.outputSHA256=audit.outputSHA256;assert.equal(report.runtimeWorkers,before);assert.equal(await read(()=>document.documentElement.scrollWidth<=innerWidth),true);await page.screenshot({path:path.join(directory,f.name+'.png')});await close();
            const bytes=new Uint8Array(await readFile(output)),index=await parseModel((o,n)=>bytes.subarray(o,o+n),bytes.length,metadata);assert.equal(index.raw.subgraphs[0].operators.length,2);
            for(const op of index.raw.subgraphs[0].operators)for(const id of op.outputs){const out=index.raw.subgraphs[0].tensors[id],original=f.model.subgraphs[0].tensors[1];assert.deepEqual(Array.from(out.shape),[2,3]);assert.equal(out.type,original.type);assert.deepEqual(out.quantization,original.quantization);}
            await choose(output);await until(()=>document.querySelector('#file-stats').textContent.includes('2 layers'));await close();Object.assign(row,{operators:2,reopened:true,quantizationPreserved:true});report.cases.push(row);
        }
        assert.equal(report.cases.length,10);assert.equal(report.modelWorkers,16);assert.equal(report.runtimeWorkers,4);assert.equal(report.downloads,16);const closeDeadline=Date.now()+5000;while(workers.some(w=>!w.closed)&&Date.now()<closeDeadline)await new Promise(r=>setTimeout(r,25));assert.ok(workers.every(w=>w.closed));report.allWorkersClosed=true;report.status='passed';check(SOFTMAX_VALIDATION_CHECK);return report;
    }finally{page.off('worker',onWorker);page.off('download',onDownload);}
}
