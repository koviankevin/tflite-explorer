// Runs inside the existing hosted physical-file lifecycle. Native UI mutations,
// read-only DOM observations, complete Node byte checks, no forced GC.
import assert from 'node:assert/strict';
import {open,readFile} from 'node:fs/promises';
import {createReadStream} from 'node:fs';
import {createHash} from 'node:crypto';
import path from 'node:path';
import {parseModel} from '../../src/model-engine.js';
import {verifyExportFiles} from '../../scripts/verify-export.mjs';
import {parseEditSession} from '../../src/model-edit-session.js';
import {PHYSICAL_OPTIONS,PHYSICAL_WEIGHT_BYTES,PHYSICAL_WEIGHT_SHA256} from '../physical-tflite-fixture.mjs';
import {modelWorkerHeap} from './worker-heap.mjs';

async function verifyComposition(file,source,proof,policy){
    const fd=await open(file,'r');let bytes=0,maxRead=0,index;
    try{
        const size=(await fd.stat()).size;assert.ok(size>1024**3);
        index=await parseModel(async(at,n)=>{bytes+=n;maxRead=Math.max(maxRead,n);assert.ok(n<=policy.maxReadBytes&&bytes<=policy.realmReadBytes);const buffer=new Uint8Array(n);assert.equal((await fd.read(buffer,0,n,at)).bytesRead,n);return buffer;},size,JSON.parse(await readFile('vendor/netron/tflite-metadata.json','utf8')));
    }finally{await fd.close();}
    const g=index.raw.subgraphs[0];assert.equal(index.raw.subgraphs.length,1);assert.equal(g.operators.length,9);assert.equal(g.tensors.length,21012);assert.equal(index.raw.buffers.length,5);
    assert.deepEqual([...g.inputs],[0]);assert.deepEqual([...g.outputs],[21009,21011]);
    assert.deepEqual([...g.operators[4].inputs],[8,4]);assert.deepEqual([...g.operators[8].inputs],[21010,21010]);assert.deepEqual([...g.operators[8].outputs],[21011]);
    const customs=g.operators.filter(op=>[0,5].includes(op.opcode_index));assert.equal(customs.length,2);for(const op of customs)assert.deepEqual(op.custom_options,PHYSICAL_OPTIONS);
    const weight=index.raw.buffers[1],start=Number(weight.offset),end=start+Number(weight.size);assert.equal(Number(weight.size),PHYSICAL_WEIGHT_BYTES);
    const hash=createHash('sha256'),weightHash=createHash('sha256');let offset=0;
    for await(const chunk of createReadStream(file,{highWaterMark:1024**2})){hash.update(chunk);const left=Math.max(0,start-offset),right=Math.min(chunk.length,end-offset);if(right>left)weightHash.update(chunk.subarray(left,right));offset+=chunk.length;}
    const weightSHA256=weightHash.digest('hex');assert.equal(weightSHA256,PHYSICAL_WEIGHT_SHA256);
    const receipt=await verifyExportFiles({report:proof,source,output:file});assert.equal(receipt.byteComparison.status,'passed');const sha256=hash.digest('hex');assert.equal(receipt.outputSHA256,sha256);
    return {bytes:offset,sha256,weightSHA256,weightVerified:true,optionsVerified:true,sourceOperators:21005,outputOperators:9,readbackOperators:g.operators.length,inputs:[...g.inputs],outputs:[...g.outputs],byteComparison:receipt.byteComparison.status,comparedBytes:receipt.byteComparison.bytes,byteRanges:receipt.byteComparison.ranges.length,readBytes:bytes,maxRead};
}

export async function physicalComposition({page,read,waitFor,choose,ready,match,closeModel,browserCDP,fixture,policy,cycle,entry,directory,hashes,setPhase}){
    const idle=()=>waitFor(()=>document.querySelector('#edit-workspace').getAttribute('aria-busy')==='false');
    async function nodes(count){await idle();await waitFor((()=>document.querySelectorAll('[data-edit-node]').length===COUNT).toString().replace('COUNT',String(count)));}
    async function pattern(name){await page.locator('#patterns-tab').click();await match(name,1);await page.locator('.result-item').first().click();await waitFor(()=>document.querySelector('#target').getAttribute('aria-busy')==='false');}
    async function wire(value,slot){await page.locator(`[data-edit-output="${value}"]`).click();await page.locator(`[data-edit-input="new:1"][data-edit-slot="${slot}"]`).click();await idle();}
    async function download(button,file){const event=page.waitForEvent('download');await page.locator(button).click();const d=await event;assert.equal(await d.failure(),null);await d.saveAs(file);await d.delete();}
    async function savedDrafts(){await page.locator('#open-edit-draft').click();await waitFor(()=>document.querySelector('#edit-recovery-description').textContent!=='讀取本機編輯草稿…');return read(()=>[...document.querySelectorAll('#edit-recovery-list option')].map(o=>({key:o.value,label:o.textContent})));}
    setPhase(`cycle-${cycle}-composition-source`);await choose(fixture.file);await ready(21005);
    const previousKeys=new Set((await savedDrafts()).map(r=>r.key));await page.locator('#close-edit-recovery').click();
    await pattern('Lifecycle prefix');await page.locator('#compose-mode').click();await nodes(4);await page.locator('#edit-font').selectOption('32');
    await page.locator('#explore-mode').click();await pattern('Lifecycle branch');await page.locator('#compose-mode').click();await nodes(8);
    await page.locator('#edit-undo').click();await nodes(4);await page.locator('#edit-redo').click();await nodes(8);
    await page.locator('[data-edit-output="t:0:8"]').click();await page.locator('[data-edit-input="op:0:21001"][data-edit-slot="0"]').click();await idle();
    await page.locator('[data-edit-node="op:0:21004"] .edit-node-title').click();await page.locator('#edit-add-after').click();await nodes(9);await wire('t:0:21010',0);await wire('t:0:21010',1);
    for(const value of ['t:0:8','t:0:21010'])await page.locator(`[data-composition-side="outputs"][data-composition-value="${value}"]`).uncheck();
    assert.equal(await page.locator('[data-composition-side="outputs"][data-composition-value="t:0:21009"]').isChecked(),true);assert.equal(await page.locator('[data-composition-side="outputs"][data-composition-value="new:1:out:0"]').isChecked(),true);
    assert.equal(await page.locator('[data-composition-side="inputs"]').count(),1);assert.equal(await page.locator('[data-composition-side="inputs"][data-composition-value="t:0:0"]').isChecked(),true);
    await page.locator('#edit-fit').click();const layout=await read(()=>({font:Number(document.querySelector('#edit-font').value),width:innerWidth,scrollWidth:document.documentElement.scrollWidth,graphHeight:document.querySelector('#edit-viewport').getBoundingClientRect().height}));assert.equal(layout.font,32);assert.equal(layout.width,1280);assert.ok(layout.scrollWidth<=layout.width&&layout.graphHeight>=200);
    entry.workerHeaps.push({phase:'composition-source',...await modelWorkerHeap(browserCDP)});
    setPhase(`cycle-${cycle}-composition-export`);const file=path.join(directory,`cycle-${cycle}-composition.tflite`),reportFile=file+'.report.json',start=Date.now();await download('#edit-export',file);const exportMs=Date.now()-start;await waitFor(()=>!document.querySelector('#edit-download-report').disabled);await download('#edit-download-report',reportFile);const proof=JSON.parse(await readFile(reportFile,'utf8'));assert.equal(proof.checks.find(c=>c.id==='serialized-roundtrip').status,'passed');
    await waitFor(()=>document.querySelector('#edit-recovery-status').textContent.startsWith('已保存本機編輯草稿'),90000);const recovery=await read(()=>globalThis.__lifecycle.workers.filter(w=>w.recoveryAudit?.complete).at(-1)?.recoveryAudit);assert.equal(recovery.fingerprint,fixture.editFingerprint);assert.equal(recovery.bytes,fixture.bytes);
    const fresh=(await savedDrafts()).filter(r=>!previousKeys.has(r.key));assert.equal(fresh.length,1);assert.match(fresh[0].label,/^組合 · /);await page.locator('#edit-recovery-list').selectOption(fresh[0].key);
    const draft=path.join(directory,`cycle-${cycle}-composition.json`);await download('#download-edit-recovery',draft);await page.locator('#close-edit-recovery').click();const session=parseEditSession(await readFile(draft,'utf8'));assert.equal(session.version,2);assert.equal(session.scope.composition,true);assert.equal(session.source.bytes,fixture.bytes);assert.equal(session.source.fingerprint,fixture.editFingerprint);assert.equal(session.scope.nodes.length,8);assert.equal(session.history.commands.length,7);assert.equal(session.history.commands.filter(c=>c.kind==='import').length,2);assert.equal(session.view.font,32);
    await closeModel();setPhase(`cycle-${cycle}-composition-reopen`);await choose(file);await ready(9);await page.locator('#patterns-tab').click();await match('Lifecycle prefix',1);await match('Lifecycle branch',1);await match('Lifecycle branch wrong edge',0);
    await page.locator('#reset-pattern').click();await waitFor(()=>document.querySelector('#result-count').textContent==='1 筆匹配路徑');
    entry.workerHeaps.push({phase:'composition-reopen',...await modelWorkerHeap(browserCDP)});await closeModel();
    setPhase(`cycle-${cycle}-composition-bytes`);const verified=await verifyComposition(file,fixture.file,proof,policy);if(hashes.has('composition'))assert.equal(verified.sha256,hashes.get('composition'),'Repeated composition exports must be byte-identical.');else hashes.set('composition',verified.sha256);
    entry.composition={...verified,workspaceNative:true,imports:[4,4],sourceNodes:8,cloneNodes:1,undoRedo:true,roundTrip:true,prefixMatches:1,branchMatches:1,negativePatternMatches:0,reshapeMatches:1,draft:{version:session.version,fingerprint:session.source.fingerprint,nodes:session.scope.nodes.length},recovery,layout,exportMs};
    return [file,reportFile,draft];
}
