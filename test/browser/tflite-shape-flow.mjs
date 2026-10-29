// Hosted-only native form/download/chooser/runtime coverage. DOM evaluation is
// read-only; all public synthetic model mutations go through the real editor.
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {tflite as schema} from '../../vendor/netron/tflite-schema.js';
import {BinaryReader} from '../../vendor/netron/flatbuffers.js';
import {Archive} from '../../vendor/netron/zip.js';
export async function tfliteShapeFlow({page,read,until,open,choose,ready,download,finished,source,directory,report,enterRuntime=async()=>{},returnToEdit=async()=>{}}){
    const detail=report.shapeValidation={},before={workers:report.workers.length,requests:report.requests.length,downloads:report.downloads};
    await open(source);await page.setViewportSize({width:1280,height:640});await page.locator('#edit-font').selectOption('32');
    await page.locator('#edit-new-ops details').first().locator('summary').click();await page.locator('#edit-builtin').selectOption(String(schema.BuiltinOperator.SQUEEZE));
    await page.locator('[data-builtin-option="squeeze_dims"]').fill('[1]');await page.locator('#edit-builtin-apply').click();await until(()=>document.querySelector('[data-edit-node="new:1"] .edit-node-title').textContent==='SQUEEZE');
    const changes=await read(()=>document.querySelector('#edit-change-list').textContent);await page.locator('#edit-export').click();
    await until(()=>document.querySelector('#edit-workspace').getAttribute('aria-busy')==='false'&&document.querySelector('#edit-message').textContent.includes('SQUEEZE'));
    detail.rejected=await read(()=>document.querySelector('#edit-message').textContent);assert.match(detail.rejected,/squeeze_dims.*維度/);assert.equal(await read(()=>document.querySelector('#edit-change-list').textContent),changes);
    assert.equal(report.workers.length,before.workers);assert.equal(report.requests.length,before.requests);assert.equal(report.downloads,before.downloads);detail.invalidExportPreservesDraft=true;
    await page.locator('#edit-clear').click();await page.locator('#close-model').click();report.cases.push('32px non-unit SQUEEZE axes block export with a reason, preserving the draft without inference or download');
    await open(source);await page.locator('#edit-font').selectOption('32');await page.locator('#edit-new-ops details').first().locator('summary').click();await page.locator('#edit-builtin').selectOption(String(schema.BuiltinOperator.CONCATENATION));
    await page.locator('#edit-builtin-inputs').fill('2');await page.locator('[data-builtin-option="axis"]').fill('1');await page.locator('#edit-builtin-apply').click();await until(()=>document.querySelector('[data-edit-node="new:1"] .edit-node-title').textContent==='CONCATENATION');await page.locator('#edit-expose').check();
    const file=await download('#edit-export','runtime-concatenation.tflite'),bytes=new Uint8Array(await readFile(file)),raw=schema.Model.create(BinaryReader.open(bytes)),graph=raw.subgraphs[0],op=graph.operators[1];
    assert.equal(raw.operator_codes[op.opcode_index].builtin_code,schema.BuiltinOperator.CONCATENATION);assert.deepEqual([...op.inputs],[0,1]);assert.deepEqual([...graph.tensors[op.outputs[0]].shape],[1,4]);assert.equal(op.builtin_options.axis,1);
    assert.equal(report.workers.length,before.workers);assert.equal(report.requests.length,before.requests);assert.equal(report.downloads,before.downloads+1);detail.exported={shape:[...graph.tensors[op.outputs[0]].shape],inputs:[...op.inputs],axis:op.builtin_options.axis,sha256:createHash('sha256').update(bytes).digest('hex')};
    await enterRuntime();await page.locator('#edit-runtime-check').click();await until(()=>document.querySelector('#edit-runtime-dialog').open);
    for(const [i,name]of [[0,'runtime-a.bin'],[1,'runtime-b.bin']]){await page.locator(`#runtime-input-mode-${i}`).selectOption('bin');await choose(path.join(directory,name),`#runtime-input-file-${i}`);}
    await page.locator('#edit-runtime-run').click();await finished('passed');const zipFile=await download('#edit-runtime-download','runtime-concatenation-io.zip');
    assert.equal(execFileSync('python3',['-I','-c','import sys,zipfile\nwith zipfile.ZipFile(sys.argv[1]) as z: assert z.testzip() is None; print(len(z.namelist()))',zipFile],{encoding:'utf8'}).trim(),'5');
    const zip=Archive.open(new Uint8Array(await readFile(zipFile)),'zip'),manifest=JSON.parse(new TextDecoder().decode(zip.entries.get('manifest.json').peek()));
    assert.equal(manifest.modelSHA256,detail.exported.sha256);assert.equal(manifest.validation.status,'passed');assert.deepEqual(manifest.outputs[1].shape,[1,4]);
    detail.cpuOutputs=manifest.outputs.map((_,i)=>[...new Float32Array(zip.entries.get(`outputs-${i}.bin`).peek().slice().buffer)]);assert.deepEqual(detail.cpuOutputs,[[4,6],[1,2,3,4]]);
    detail.layout=await read(()=>({width:innerWidth,scrollWidth:document.documentElement.scrollWidth,font:document.querySelector('#edit-font').value}));assert.equal(detail.layout.font,'32');assert.ok(detail.layout.scrollWidth<=detail.layout.width+1);
    await returnToEdit();await page.locator('#edit-clear').click();await page.locator('#close-model').click();await choose(file,'#open-model');await ready();assert.equal(await page.locator('#layer-count').textContent(),'2');await page.locator('#layers-tab').click();await page.locator('#query').fill('CONCATENATION');await until(()=>document.querySelector('#result-count').textContent==='1 筆結果'&&/concatenation/i.test(document.querySelector('.result-item')?.textContent||''));await page.locator('.result-item').click();await until(()=>document.querySelector('#target').getAttribute('aria-busy')==='false'&&document.querySelectorAll('#target .node').length>0);detail.reopenedAndLocated=true;await page.locator('#close-model').click();
    report.cases.push('32px variadic CONCATENATION infers and exports [1,4], actual raw BIN CPU/IO ZIP values agree, and native reopen/search locates the new OP');
}
