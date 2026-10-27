// Opt-in remote CI: real physical files, native chooser/download, natural GC and
// the application's unchanged 60-second Blob URL lifetime. Never part of npm test.
import assert from 'node:assert/strict';
import {chromium} from 'playwright';
import {execFileSync} from 'node:child_process';
import {readFile,writeFile,mkdtemp,mkdir,rm,statfs,readdir,stat} from 'node:fs/promises';
import {openSync,readSync,fstatSync,closeSync,createReadStream} from 'node:fs';
import {createHash} from 'node:crypto';
import {once} from 'node:events';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {writePhysicalFixture,PHYSICAL_OPTIONS,PHYSICAL_WEIGHT_BYTES,PHYSICAL_SOURCE_BYTES,PHYSICAL_SOURCE_SHA256,PHYSICAL_WEIGHT_SHA256} from '../physical-tflite-fixture.mjs';
import {parseModel} from '../../src/model-engine.js';
import {exportPatterns,reusablePattern,parsePatternFile} from '../../src/pattern-library.js';
import {createStaticServer} from '../../scripts/serve.mjs';
import {installLifecycleAudit} from './lifecycle-audit.mjs';
import {modelWorkerHeap} from './worker-heap.mjs';
import {evaluateLifecycle,LIFECYCLE_POLICY as policy,median} from './lifecycle-policy.mjs';

process.chdir(fileURLToPath(new URL('../../',import.meta.url)));
const reportPath=path.resolve(process.env.LIFECYCLE_REPORT || 'test-results/model-lifecycle.json');
await mkdir(path.dirname(reportPath),{recursive:true});
const report={status:'failed',startedAt:new Date().toISOString(),policy,cycles:[],samples:[],checks:[],limitations:[
    'Eight cycles with two warmups bound observed growth; finite measurements cannot prove an absence of all leaks.',
    'Physical synthetic nonzero weights with opaque custom options; no company model or custom runtime execution.',
    'Summed /proc RSS includes Chromium descendants and can double-count shared pages; 500ms sampling can miss spikes.',
    'Worker Runtime.getHeapUsage measures the V8 isolate at source/reopen checkpoints, not separate OS RSS or a continuous peak.',
    'Native read guards reject >1MiB calls or >16MiB per realm before allocation. No forced garbage collection or shortened URL timer.'
]};
const errors=[],wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const optionalRead=file=>readFile(file,'utf8').then(s=>s.trim()).catch(()=>null);
const check=name=>{report.checks.push(name);console.log(`PASS ${name}`);};
let temporary,server,browser,context,page,cdp,browserCDP,readPage,timer,pending=Promise.resolve(),sampling=false,rootPid,phase='startup',shuttingDown=false;
const watchdog=setTimeout(async()=>{report.error=`Hard timeout during ${phase}`;await writeFile(reportPath,JSON.stringify(report,null,2)+'\n');console.error(report.error);process.exit(1);},22*60000);

const patterns=[
    reusablePattern('Lifecycle prefix',{nodes:[{alias:'N1',type:'HugeWeightProject'},{alias:'N2',type:'Reshape'},{alias:'N3',type:'Transpose'},{alias:'N4',type:'Reshape'}],edges:[{from:'N1',to:'N2'},{from:'N2',to:'N3'},{from:'N3',to:'N4'}],induced:true}),
    reusablePattern('Lifecycle branch',{nodes:[{alias:'N1',type:'Mul'},{alias:'N2',type:'Add'},{alias:'N3',type:'CompanySplitLongNameForLargeModel'},{alias:'N4',type:'Add'}],edges:[{from:'N1',to:'N2'},{from:'N1',to:'N3'},{from:'N2',to:'N4'},{from:'N3',to:'N4'}],induced:true})
];
async function processRss(){
    const ids=(await readdir('/proc')).filter(id=>/^\d+$/.test(id));
    const rows=(await Promise.all(ids.map(async id=>{
        const text=await optionalRead(`/proc/${id}/status`);if(!text)return null;
        if(!rootPid){const command=await optionalRead(`/proc/${id}/cmdline`);if(command?.includes(`--model-lens-lifecycle=${path.basename(temporary)}`)&&/\/(chrome|headless_shell)$/.test(command.split('\0')[0]))rootPid=Number(id);}
        return {id:Number(id),parent:Number(text.match(/^PPid:\s+(\d+)/m)?.[1]),rss:Number(text.match(/^VmRSS:\s+(\d+)/m)?.[1]||0)*1024};
    }))).filter(Boolean);
    assert.ok(rootPid,'Cannot locate owned Chromium process.');const owned=new Set([rootPid]);
    for(let size=-1;size!==owned.size;){size=owned.size;for(const row of rows)if(owned.has(row.parent))owned.add(row.id);}
    const rss=rows.filter(r=>owned.has(r.id)).reduce((n,r)=>n+r.rss,0);assert.ok(rss>0,'RSS unavailable.');return rss;
}
async function sample(){
    const rssBytes=await processRss(),{metrics}=await cdp.send('Performance.getMetrics'),mainHeapBytes=metrics.find(m=>m.name==='JSHeapUsedSize')?.value;
    assert.ok(Number.isFinite(mainHeapBytes)&&mainHeapBytes>0,'Main heap unavailable.');
    const sample={phase,elapsedMs:Date.now()-Date.parse(report.startedAt),rssBytes,mainHeapBytes};report.samples.push(sample);return sample;
}
async function waitFor(fn,timeout=30000){const until=Date.now()+timeout;while(!await readPage(fn)){if(Date.now()>until)throw Error(`Timed out: ${fn}`);await wait(100);}}
async function choose(file,button='#open-model'){
    const chooser=page.waitForEvent('filechooser');await page.locator(button).click();await (await chooser).setFiles(file);
}
async function ready(count){
    await waitFor(()=>document.querySelector('#loading-card').hidden && document.querySelector('#layer-count').textContent!=='—');
    assert.equal(await page.locator('#layer-count').textContent(),count.toLocaleString('en-US'));
    await waitFor(()=>document.querySelector('#target').getAttribute('aria-busy')==='false');
}
async function match(name,count){
    await page.locator('#saved-pattern').selectOption(name);
    await waitFor(()=>document.querySelector('#run-pattern').disabled===false);
    const expected=`${count.toLocaleString('en-US')} 筆匹配路徑`;
    await waitFor((()=>document.querySelector('#result-count').textContent===EXPECTED).toString().replace('EXPECTED',JSON.stringify(expected)));
    // No stale hit is accepted: exact pattern selection and idle graph must agree.
    assert.equal(await page.locator('#saved-pattern').inputValue(),name);
}
// waitFor accepts serialized functions for data-dependent expectations without eval in the page.
async function closeModel(){
    const worker=page.workers().find(w=>/\/model-worker\.js(?:\?|$)/.test(w.url()));assert.ok(worker,'Live model Worker required.');
    let deadline;const closed=Promise.race([once(worker,'close'),new Promise((_,reject)=>{deadline=setTimeout(()=>reject(Error('Model Worker did not close.')),5000);})]);
    try{await page.locator('#close-model').click();await closed;}finally{clearTimeout(deadline);}
    await waitFor(()=>document.querySelector('#model-file').files.length===0 && document.querySelector('#close-model').hidden);
    assert.equal(page.workers().filter(w=>/\/model-worker\.js(?:\?|$)/.test(w.url())).length,0);
    const {targetInfos}=await browserCDP.send('Target.getTargets');assert.equal(targetInfos.filter(t=>t.type==='worker'&&/\/model-worker\.js(?:\?|$)/.test(t.url)).length,0);
}
async function verifyDownload(filename,kind){
    const fd=openSync(filename,'r');let index,readBytes=0,maxRead=0;
    try{
        const size=fstatSync(fd).size;assert.ok(size>1024**3);
        const metadata=JSON.parse(await readFile('vendor/netron/tflite-metadata.json','utf8'));
        index=await parseModel((at,length)=>{
            readBytes+=length;maxRead=Math.max(maxRead,length);assert.ok(length<=policy.maxReadBytes&&readBytes<=policy.realmReadBytes);
            const bytes=new Uint8Array(length);assert.equal(readSync(fd,bytes,0,length,at),length);return bytes;
        },size,metadata);
    }finally{closeSync(fd);}
    const graph=index.raw.subgraphs[0];assert.equal(graph.operators.length,4);assert.equal(graph.tensors.length,21011);assert.equal(graph.inputs.length,1);assert.equal(graph.outputs.length,kind===0?1:2);assert.equal(index.raw.buffers.length,5);
    const custom=graph.operators.find(op=>op.opcode_index===(kind===0?0:5));assert.ok(custom);assert.deepEqual(custom.custom_options,PHYSICAL_OPTIONS);
    assert.deepEqual([...graph.operators[0].inputs],kind===0?[0,1]:[21005,4]);
    const weight=index.raw.buffers[1];assert.equal(Number(weight.size),PHYSICAL_WEIGHT_BYTES);
    const whole=createHash('sha256'),hash=createHash('sha256');let offset=0;
    const start=Number(weight.offset),end=Number(weight.offset+weight.size);
    for await(const chunk of createReadStream(filename,{highWaterMark:1024**2})){
        whole.update(chunk);const left=Math.max(0,start-offset),right=Math.min(chunk.length,end-offset);if(right>left)hash.update(chunk.subarray(left,right));offset+=chunk.length;
    }
    const weightSHA256=hash.digest('hex');assert.equal(weightSHA256,PHYSICAL_WEIGHT_SHA256);
    for(const [id,expected] of [[2,new Uint8Array(Int32Array.of(1,2).buffer)],[3,new Uint8Array(Int32Array.of(0,1).buffer)],[4,new Uint8Array(Float32Array.of(2,3).buffer)]]){
        const b=index.raw.buffers[id],small=openSync(filename,'r');try{const bytes=new Uint8Array(Number(b.size));assert.equal(readSync(small,bytes,0,bytes.length,Number(b.offset)),bytes.length);assert.deepEqual(bytes,expected);}finally{closeSync(small);}
    }
    return {bytes:offset,sha256:whole.digest('hex'),weightSHA256,readBytes,maxRead,operators:4,inputs:[...graph.inputs],outputs:[...graph.outputs],weightVerified:true,optionsVerified:true};
}
try{
    assert.equal(os.platform(),'linux','OS RSS gate requires isolated Linux CI.');
    const disk=await statfs(os.tmpdir()),memoryLimit=await optionalRead('/sys/fs/cgroup/memory.max'),memoryCurrent=await optionalRead('/sys/fs/cgroup/memory.current');
    const available=memoryLimit&&memoryLimit!=='max'?Number(memoryLimit)-Number(memoryCurrent):os.freemem();assert.ok(available>=4*1024**3,'Need 4 GiB available RAM.');assert.ok(disk.bavail*disk.bsize>=8*1024**3,'Need 8 GiB free disk.');
    report.environment={platform:os.platform(),release:os.release(),node:process.version,cpu:os.cpus()[0]?.model,cpus:os.cpus().length,totalMemory:os.totalmem(),availableMemoryBytes:available,memoryLimit,memoryCurrent,tempFreeBytes:disk.bavail*disk.bsize,imageVersion:process.env.ImageVersion||null,runId:process.env.GITHUB_RUN_ID||null,sourceCommit:execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),sourceTree:execFileSync('git',['rev-parse','HEAD^{tree}'],{encoding:'utf8'}).trim(),sourceDirty:Boolean(execFileSync('git',['status','--porcelain'],{encoding:'utf8'}).trim())};assert.equal(report.environment.sourceDirty,false);
    temporary=await mkdtemp(path.join(os.tmpdir(),'model-lens-lifecycle-'));phase='physical-fixture';
    report.fixture=await writePhysicalFixture(path.join(temporary,'physical-1_25GiB.tflite'));
    assert.equal(report.fixture.bytes,PHYSICAL_SOURCE_BYTES);assert.equal(report.fixture.sha256,PHYSICAL_SOURCE_SHA256);assert.equal(report.fixture.weightSHA256,PHYSICAL_WEIGHT_SHA256);assert.ok(report.fixture.allocatedBytes>=report.fixture.bytes*.99);check('dense physical 1.25 GiB / 21,005 OP fixture, complete write/readback SHA-256');
    execFileSync(process.execPath,['scripts/build.mjs'],{stdio:'inherit'});report.build=JSON.parse(await readFile('dist/release.json','utf8'));assert.equal(report.build.source.commit,report.environment.sourceCommit);assert.equal(report.build.source.dirty,false);
    server=createStaticServer();server.listen(0,'127.0.0.1');await once(server,'listening');const base=`http://127.0.0.1:${server.address().port}`;
    browser=await chromium.launch({headless:true,args:[`--model-lens-lifecycle=${path.basename(temporary)}`]});report.environment.chromium=browser.version();report.environment.playwright=JSON.parse(await readFile('node_modules/playwright/package.json','utf8')).version;
    browser.on('disconnected',()=>{if(!shuttingDown)errors.push('Browser disconnected.');});
    context=await browser.newContext({viewport:{width:1366,height:768},acceptDownloads:true});await context.addInitScript(installLifecycleAudit);
    await context.route('**/*',async route=>{const request=route.request();if(!request.url().startsWith(base+'/')||request.method()!=='GET'){errors.push(`Unexpected network ${request.method()} ${request.url()}`);await route.abort();}else await route.continue();});
    await context.route('**/src/model-worker.js*',async route=>{const response=await route.fetch();await route.fulfill({response,body:`(${installLifecycleAudit.toString()})(true);\n${await response.text()}`});});
    page=await context.newPage();page.setDefaultTimeout(30000);page.on('pageerror',error=>errors.push(error.message));page.on('crash',()=>errors.push('Page crashed.'));
    browserCDP=await browser.newBrowserCDPSession();await browserCDP.send('Target.setDiscoverTargets',{discover:true});cdp=await context.newCDPSession(page);await cdp.send('Performance.enable');
    readPage=async fn=>{const result=await cdp.send('Runtime.evaluate',{expression:`(${typeof fn==='string'?fn:fn.toString()})()`,returnByValue:true});if(result.exceptionDetails)throw Error(JSON.stringify(result.exceptionDetails));return result.result.value;};
    await page.goto(base);await page.locator('#welcome-open').waitFor();phase='baseline';await sample();
    timer=setInterval(()=>{if(sampling)return;sampling=true;pending=sample().catch(error=>errors.push(`Sampler: ${error.message}`)).finally(()=>{sampling=false;});},policy.sampleIntervalMs);
    const patternFile=path.join(temporary,'patterns.json');await writeFile(patternFile,exportPatterns(patterns));
    // Initial model is opened below; pattern UI is available after selecting its tab.
    const hashes=new Map();
    for(let cycle=1;cycle<=policy.cycles;cycle++){
        const kind=(cycle-1)%2,name=patterns[kind].name,other=patterns[1-kind].name,entry={cycle,kind:kind===0?'prefix':'branch',workerHeaps:[]};report.cycles.push(entry);
        phase=`cycle-${cycle}-source`;await choose(report.fixture.file);await ready(21005);
        await page.locator('[data-kind="patterns"]').click();
        if(cycle===1){
            await page.locator('#open-import').click();await choose(patternFile,'#choose-pattern-file');await page.locator('#confirm-import').click();await waitFor(()=>!document.querySelector('#import-dialog').open);
            const downloadEvent=page.waitForEvent('download');await page.locator('#export-patterns').click();const downloaded=await downloadEvent;assert.equal(await downloaded.failure(),null);const saved=path.join(temporary,'patterns-roundtrip.json');await downloaded.saveAs(saved);assert.deepEqual(parsePatternFile(await readFile(saved,'utf8')),patterns);await downloaded.delete();check('native pattern JSON import/export preserves both reference structures');
        }
        await page.locator('#reset-pattern').click();await waitFor(()=>document.querySelector('#result-count').textContent==='7,000 筆匹配路徑');
        await match(name,1);entry.patternSourceMatches=1;await match(other,1);await match(name,1);
        await page.locator('.result-item').first().click();await waitFor(()=>document.querySelector('#target').getAttribute('aria-busy')==='false'&&document.querySelectorAll('#target .node').length>0);
        entry.workerHeaps.push({phase:'source',...await modelWorkerHeap(browserCDP)});
        phase=`cycle-${cycle}-download`;const downloadEvent=page.waitForEvent('download');await page.locator('#export-match').click();const download=await downloadEvent;assert.equal(await download.failure(),null);const child=path.join(temporary,`cycle-${cycle}.tflite`);await download.saveAs(child);await download.delete();assert.ok((await stat(child)).size>1024**3);
        await closeModel();phase=`cycle-${cycle}-reopen`;await choose(child);await ready(4);await match(name,1);entry.patternReopenMatches=1;await match(other,0);entry.negativePatternMatches=0;await match(name,1);
        await page.locator('.result-item').first().click();await waitFor(()=>document.querySelector('#target').getAttribute('aria-busy')==='false'&&document.querySelectorAll('#target .node').length>0);
        entry.workerHeaps.push({phase:'reopen',...await modelWorkerHeap(browserCDP)});await closeModel();
        phase=`cycle-${cycle}-hash`;Object.assign(entry,await verifyDownload(child,kind));if(hashes.has(kind))assert.equal(entry.sha256,hashes.get(kind),'Repeated exports must be byte-identical.');else hashes.set(kind,entry.sha256);
        phase=`cycle-${cycle}-release`;await waitFor(()=>globalThis.__lifecycle.urls.every(item=>item.revoked),policy.urlReleaseTimeoutMs);
        const settled=[];for(let i=0;i<policy.settleSamples;i++){await wait(1000);settled.push(await sample());}
        entry.closedRssBytes=median(settled.map(s=>s.rssBytes));entry.closedMainHeapBytes=median(settled.map(s=>s.mainHeapBytes));entry.fileInputEmpty=await readPage(()=>document.querySelector('#model-file').files.length===0);entry.liveModelWorkers=page.workers().filter(w=>/\/model-worker\.js(?:\?|$)/.test(w.url())).length;entry.activeBlobUrls=await readPage(()=>globalThis.__lifecycle.urls.filter(item=>!item.revoked).length);
        await rm(child);console.log(`PASS cycle ${cycle}/${policy.cycles}: ${entry.kind}, verified ${entry.bytes} bytes, closed RSS ${(entry.closedRssBytes/1024**2).toFixed(1)} MiB`);
    }
    report.audit=await readPage(()=>globalThis.__lifecycle);
    assert.equal(report.audit.workers.filter(w=>/\/model-worker\.js(?:\?|$)/.test(w.url)).length,16);
    for(const entry of report.audit.workers){assert.equal(entry.error,undefined);if(/\/model-worker\.js(?:\?|$)/.test(entry.url)){assert.equal(entry.terminated,true);assert.ok(entry.audit?.bytes>0);assert.equal(entry.audit.bytes,entry.stats.bytesRead);}}
    for(const audit of [report.audit.audit,...report.audit.workers.map(w=>w.audit).filter(Boolean)]){assert.deepEqual(audit.violations,[]);assert.ok(audit.maxRead<=policy.maxReadBytes&&audit.bytes<=policy.realmReadBytes);}
    assert.deepEqual(errors,[]);report.evaluation=evaluateLifecycle(report);assert.equal(report.evaluation.status,'passed',report.evaluation.issues.join(', '));check('eight physical-file cycles, alternating custom branch/prefix, stable hashes, no retained File/Worker/Blob URL and fixed memory limits');report.status='passed';
}catch(error){report.error=error.stack||String(error);console.error(report.error);if(readPage)report.audit=await readPage(()=>globalThis.__lifecycle).catch(()=>null);}
finally{
    clearInterval(timer);await pending;shuttingDown=true;
    try{
        if(context)await context.close();
        if(browser){let timeout;try{await Promise.race([browser.close(),new Promise((_,reject)=>{timeout=setTimeout(()=>reject(Error('Browser close/reap timed out.')),10000);})]);}finally{clearTimeout(timeout);}}
        if(rootPid){await wait(100);assert.equal(await optionalRead(`/proc/${rootPid}/cmdline`),null,'Owned browser process remained after close.');}
        report.browserClosed=true;
    }catch(error){report.status='failed';errors.push(`Cleanup: ${error.message}`);if(rootPid){const command=await optionalRead(`/proc/${rootPid}/cmdline`);if(command?.includes(`--model-lens-lifecycle=${path.basename(temporary)}`))process.kill(rootPid,'SIGKILL');}}
    if(server){server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
    // Only this invocation's mkdtemp directory; no model from the user's filesystem.
    if(temporary && path.dirname(temporary)===os.tmpdir() && path.basename(temporary).startsWith('model-lens-lifecycle-'))await rm(temporary,{recursive:true,force:true});
    report.errors=errors;report.finishedAt=new Date().toISOString();await writeFile(reportPath,JSON.stringify(report,null,2)+'\n');clearTimeout(watchdog);console.log(`Report ${reportPath}: ${report.status}`);process.exit(report.status==='passed'?0:1);
}
