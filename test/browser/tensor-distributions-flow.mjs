// Hosted-only native UI; the browser receives no generated specs or injected
// editor state. Node reads actual downloads for bytes and CPU result checks.
import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {runtimeFixture} from '../runtime-fixture.mjs';
import {randomTensor} from '../../src/tflite-new-ops.js';
import {runtimeInput,littleEndianBytes} from '../../src/tflite-runtime-inputs.js';
import {BinaryReader} from '../../vendor/netron/flatbuffers.js';
import {tflite as schema} from '../../vendor/netron/tflite-schema.js';
import {Archive} from '../../vendor/netron/zip.js';
import {parseEditSession} from '../../src/model-edit-session.js';
import {chooseEditDraft} from './edit-draft-chooser.mjs';
const hash=b=>createHash('sha256').update(b).digest('hex');
export async function tensorDistributionsFlow({page,read,until,open,choose,ready,download,finished,directory,report,enterRuntime,returnToEdit}){
    const detail=report.distributions={defaults:{},executions:[]},spec={seed:1,distribution:'truncated-normal',mean:0,std:.05,min:-.1,max:.1},f=await runtimeFixture({inputShapes:[[1,1024],[1,1024]],outputShape:[1,1024]}),source=path.join(directory,'distribution-source.tflite');await writeFile(source,f.bytes,{flag:'wx'});
    await open(source);await page.locator('#edit-font').selectOption('32');await page.locator('#edit-new-ops details').nth(1).locator('summary').first().click();await page.locator('#edit-random-slot').selectOption('1');await page.locator('#edit-random-like').selectOption('t:0:0');
    const preset=()=>read(()=>({distribution:document.querySelector('#edit-random-distribution').value,mean:Number(document.querySelector('#edit-random-mean').value),std:Number(document.querySelector('#edit-random-std').value),min:Number(document.querySelector('#edit-random-min').value),max:Number(document.querySelector('#edit-random-max').value),probability:Number(document.querySelector('#edit-random-probability').value),advanced:document.querySelector('#edit-random-seed').closest('details').open}));
    detail.defaults.weight=await preset();assert.deepEqual(detail.defaults.weight,{distribution:'truncated-normal',mean:0,std:.05,min:-.1,max:.1,probability:0,advanced:false});
    for(const distribution of ['normal','bernoulli','truncated-normal']){
        await page.locator('#edit-random-distribution').selectOption(distribution);const current=await preset();if(distribution==='normal'){assert.equal(current.mean,0);assert.equal(current.std,.05);}if(distribution==='bernoulli')assert.equal(current.probability,.5);await page.locator('#edit-random-apply').click();await until(()=>document.querySelector('#edit-change-list').textContent.includes('亂數輸入 2'));
    }
    await page.locator('#edit-expose').check();await page.locator('#edit-undo').click();const draftFile=await download('#save-edit-draft','distribution-draft.json'),draft=parseEditSession(await readFile(draftFile,'utf8'));assert.equal(draft.version,3);assert.equal(draft.history.redo.length,1);assert.deepEqual(draft.history.commands.filter(c=>c.kind==='random').map(c=>c.distribution),['normal','bernoulli','truncated-normal']);detail.draft={version:3,redo:1,distributions:['normal','bernoulli','truncated-normal']};await page.locator('#edit-redo').click();
    const exported=await download('#edit-export','distribution-edited.tflite'),bytes=new Uint8Array(await readFile(exported)),model=schema.Model.create(BinaryReader.open(bytes)),g=model.subgraphs[0],tensor=g.tensors[g.operators[1].inputs[1]],buffer=model.buffers[tensor.buffer],weight=buffer.size?bytes.subarray(Number(buffer.offset),Number(buffer.offset+buffer.size)):buffer.data;assert.deepEqual(weight,randomTensor(f.model.subgraphs[0].tensors[0],spec));detail.constSHA256=hash(weight);detail.outputSHA256=hash(bytes);
    await enterRuntime();
    for(const first of ['normal','truncated-normal']){
        await page.locator('#edit-runtime-check').click();await until(()=>document.querySelector('#edit-runtime-dialog').open);for(const i of [0,1])await page.locator(`#runtime-input-mode-${i}`).selectOption('random');
        assert.equal(await page.locator('#runtime-input-distribution-0').inputValue(),'normal');assert.equal(await page.locator('#runtime-input-mean-0').inputValue(),'0');assert.equal(await page.locator('#runtime-input-std-0').inputValue(),'1');assert.equal(await read(()=>document.querySelector('#runtime-input-seed-0').closest('details').open),false);
        await page.locator('#runtime-input-distribution-0').selectOption(first);await page.locator('#runtime-input-distribution-1').selectOption(first==='normal'?'bernoulli':'uniform');
        const specs=first==='normal'?[{seed:1,distribution:'normal',mean:0,std:1},{seed:1,distribution:'bernoulli',probability:.5}]:[{seed:1,distribution:'truncated-normal',mean:0,std:1,min:-2,max:2},{seed:1,min:0,max:1}];
        await page.locator('#edit-runtime-run').click();await finished('passed');const file=await download('#edit-runtime-download',`distribution-${first}-io.zip`),zip=Archive.open(new Uint8Array(await readFile(file)),'zip'),manifest=JSON.parse(new TextDecoder().decode(zip.entries.get('manifest.json').peek()));assert.equal(manifest.modelSHA256,hash(bytes));
        const values=[];for(const [i,s]of specs.entries()){const expected=await runtimeInput({dtype:'float32',shape:[1,1024]},{mode:'random',...s});assert.deepEqual(zip.entries.get(`inputs-${i}.bin`).peek(),littleEndianBytes(expected,'float32'));assert.equal(manifest.inputs[i].distribution,s.distribution??'uniform');assert.equal(manifest.inputs[i].seed,1);values.push(expected);}
        const w=new Float32Array(weight.slice().buffer);for(const [i,right]of [[0,values[1]],[1,w]]){const actual=new Float32Array(zip.entries.get(`outputs-${i}.bin`).peek().slice().buffer);assert.deepEqual([...actual],[...values[0]].map((v,n)=>Math.fround(v+right[n])));}
        detail.executions.push({first,inputs:manifest.inputs.map(x=>({distribution:x.distribution,algorithm:x.algorithm,seed:x.seed,mean:x.mean,std:x.std,min:x.min,max:x.max,probability:x.probability})),modelSHA256:manifest.modelSHA256,cpuValues:true});
    }
    await returnToEdit();await page.locator('#close-model').click();await chooseEditDraft(page,draftFile);await until(()=>!document.querySelector('#choose-edit-draft-model').hidden);await choose(source,'#choose-edit-draft-model');await ready();await until(()=>!document.querySelector('#edit-workspace').hidden&&document.querySelector('#edit-workspace').getAttribute('aria-busy')==='false');assert.equal(await page.locator('#edit-font').inputValue(),'32');await page.locator('#edit-redo').click();const again=await download('#edit-export','distribution-restored.tflite');assert.equal(hash(await readFile(again)),hash(bytes));await page.locator('#edit-open-result').click();await ready();assert.equal(await page.locator('#layer-count').textContent(),'2');await page.locator('#close-model').click();detail.restoredEqualBytes=true;
    report.cases.push('shared beginner presets and all four random distributions preserve exact typed const/input bytes and actual CPU outputs');report.cases.push('v3 random-rule draft restores distribution/seed, 32px view and redo, then exports identical TFLite bytes and reopens');
}
