import assert from 'node:assert/strict';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {once} from 'node:events';
import path from 'node:path';
import {runtimeSupportFixtures} from '../runtime-support-fixture.mjs';
import {assertRuntimeSupportProof} from './runtime-support-proof.mjs';
import {Archive} from '../../vendor/netron/zip.js';
export const RUNTIME_SUPPORT_CHECK='Missing builtin version is not-verified; genuine input errors remain failed; manual Interpreter control and exact BIN IO pass at 32px';
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
export async function runtimeSupportFlow({page,read,base,directory,check}){
 const report={status:'failed',cases:[],modelWorkers:0,runtimeWorkers:0,downloads:0},workers=[];
 const onWorker=w=>{const kind=/\/model-worker\.js(?:\?|$)/.test(w.url())?'modelWorkers':/\/tflite-runtime-worker\.js(?:\?|$)/.test(w.url())?'runtimeWorkers':null;if(!kind)return;report[kind]++;const row={closed:false};workers.push(row);w.once('close',()=>row.closed=true);};
 const onDownload=()=>report.downloads++;page.on('worker',onWorker);page.on('download',onDownload);
 const until=async(fn,...args)=>{const end=Date.now()+35000;while(!await read(fn,...args)){assert.ok(Date.now()<end,'Runtime support UI timeout: '+fn);await new Promise(r=>setTimeout(r,50));}};
 const ready=()=>until(()=>document.querySelector('#model-tabs').getAttribute('aria-busy')==='false'&&document.querySelector('#loading-card').hidden&&document.querySelector('#target').getAttribute('aria-busy')==='false');
 const choose=async(file,button)=>{const event=page.waitForEvent('filechooser');await page.locator(button).click();await(await event).setFiles(file);};
 try{
  await mkdir(directory,{recursive:true});await page.setViewportSize({width:1280,height:640});await page.goto(base);await until(()=>!document.querySelector('#open-model').disabled);
  for(const f of await runtimeSupportFixtures()){
   const file=path.join(directory,f.name+'.tflite');await writeFile(file,f.bytes);const bins=[];
   for(const [i,v]of f.values.entries()){const bin=path.join(directory,f.name+'-'+i+'.bin');await writeFile(bin,new Uint8Array(v.buffer,v.byteOffset,v.byteLength));bins.push(bin);}
   await choose(file,'#open-model');await until(name=>document.querySelector('#file-name').textContent===name,path.basename(file));await ready();await page.locator('#graph-font-size').selectOption('32');await ready();
   const before=report.runtimeWorkers;await page.locator('#run-mode').click();await until(()=>!document.querySelector('#run-workspace').hidden&&document.querySelector('#run-workspace').getAttribute('aria-busy')==='false');assert.equal(report.runtimeWorkers,before);
   await page.locator('#edit-runtime-check').click();await until(()=>document.querySelector('#edit-runtime-dialog').open);
   for(const [i,bin]of bins.entries()){await page.locator('#runtime-input-mode-'+i).selectOption('bin');await choose(bin,'#runtime-input-file-'+i);}
   await page.locator('#edit-runtime-run').click();await until(()=>!!document.querySelector('#edit-runtime-result').dataset.status&&document.querySelector('#run-workspace').getAttribute('aria-busy')==='false');
   const status=await page.locator('#edit-runtime-result').getAttribute('data-status'),message=await page.locator('#edit-runtime-result').textContent();assert.equal(status,f.status,message);assert.equal(report.runtimeWorkers,before+1);
   const row={name:f.name,modelSHA256:sha(f.bytes),inputSHA256:await Promise.all(bins.map(async b=>sha(await readFile(b)))),status,message,automaticRuntime:false};
   if(status==='not-verified'){assert.equal(await page.locator('#edit-runtime-download').isDisabled(),true);row.ioAbsent=true;}
   else{
    const event=page.waitForEvent('download');await page.locator('#edit-runtime-download').click();const d=await event;assert.equal(await d.failure(),null);const output=path.join(directory,f.name+'-io.zip');await d.saveAs(output);await d.delete();
    const bytes=new Uint8Array(await readFile(output)),zip=Archive.open(bytes,'zip'),manifest=JSON.parse(new TextDecoder().decode(zip.entries.get('manifest.json').peek()));assert.equal(manifest.modelSHA256,row.modelSHA256);
    for(const [i,hash]of row.inputSHA256.entries())assert.equal(sha(zip.entries.get('inputs-'+i+'.bin').peek()),hash);
    Object.assign(row,{zipSHA256:sha(bytes),recordedStatus:manifest.validation.status,compiled:manifest.validation.compiled,invoked:manifest.validation.invoked,inputsMatch:true});
    row.outputSaved=zip.entries.has('outputs-0.bin');
    if(status==='passed'){const raw=zip.entries.get('outputs-0.bin').peek().slice(),values=[...new Float32Array(raw.buffer)];assert.deepEqual(values,f.expected);Object.assign(row,{outputSHA256:sha(raw),output:values,numericMatches:true});}
   }
   assert.equal(await read(()=>document.documentElement.scrollWidth<=innerWidth),true);await page.screenshot({path:path.join(directory,f.name+'.png')});report.cases.push(row);
   const worker=page.workers().find(w=>/\/model-worker\.js(?:\?|$)/.test(w.url()));assert.ok(worker);const closed=once(worker,'close');await page.locator('#explore-mode').click();await page.locator('#close-model').click();await closed;
  }
  const end=Date.now()+5000;while(workers.some(w=>!w.closed)){assert.ok(Date.now()<end,'Runtime support Worker remained open');await new Promise(r=>setTimeout(r,25));}
  report.allWorkersClosed=true;report.status='passed';assertRuntimeSupportProof(report);check(RUNTIME_SUPPORT_CHECK);return report;
 }finally{page.off('worker',onWorker);page.off('download',onDownload);}
}
