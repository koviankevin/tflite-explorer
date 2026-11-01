// Opt-in remote CI: real physical files, native chooser/download, natural GC and
// the application's unchanged 60-second Blob URL lifetime. Never part of npm test.
import assert from 'node:assert/strict';
import {chromium} from 'playwright';
import {execFileSync} from 'node:child_process';
import {readFile,writeFile,rename,mkdtemp,mkdir,rm,statfs,stat} from 'node:fs/promises';
import {openSync,readSync,fstatSync,closeSync,createReadStream} from 'node:fs';
import {createHash,randomBytes} from 'node:crypto';
import {once} from 'node:events';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {writePhysicalFixture,PHYSICAL_OPTIONS,PHYSICAL_WEIGHT_BYTES,PHYSICAL_SOURCE_BYTES,PHYSICAL_SOURCE_SHA256,PHYSICAL_WEIGHT_SHA256} from '../physical-tflite-fixture.mjs';
import {parseModel} from '../../src/model-engine.js';
import {exportPatterns,reusablePattern,parsePatternFile} from '../../src/pattern-library.js';
import {createStaticServer} from '../../scripts/serve.mjs';
import {installLifecycleAudit,installRecoveryReadAudit} from './lifecycle-audit.mjs';
import {editFileFingerprint} from '../../src/model-edit-session.js';
import {modelWorkerHeap} from './worker-heap.mjs';
import {evaluateLifecycle,MODEL_EDIT_LIFECYCLE_POLICY,MODEL_COMPOSITION_LIFECYCLE_POLICY,median} from './lifecycle-policy.mjs';
import {physicalComposition} from './physical-composition.mjs';
import {LIFECYCLE_SOAK_POLICY,assertSoakExecution,needsSoakCycle,evaluateLifecycleSoak} from './lifecycle-soak-policy.mjs';
import {SOAK_RECOVERY_POLICY,createSoakRecovery} from './soak-recovery.mjs';
import {recoveryCapacityPreflight} from './soak-recovery-preflight.mjs';
import {verifyExportFiles} from '../../scripts/verify-export.mjs';
import {OwnedProcessTree,readProcessTable,findOwnedBrowserRoot,waitOwnedProcessExit} from './owned-processes.mjs';
import {windowsProcessObserver,windowsAllocatedBytes} from './windows-process-memory.mjs';
import {verifyArtifact} from '../../scripts/lib/release-artifact.mjs';
import {trustedDocument} from './trusted-document.mjs';
import {createLifecycleMemoryDiagnostics} from './lifecycle-memory-diagnostics.mjs';

process.chdir(fileURLToPath(new URL('../../',import.meta.url)));
const reportPath=path.resolve(process.env.LIFECYCLE_REPORT || 'test-results/model-lifecycle.json');
await mkdir(path.dirname(reportPath),{recursive:true});
const mode=process.env.LIFECYCLE_MODE||'gate',soak=mode==='soak',memoryDiagnosticMode=mode==='memory-diagnostic';
const windows=process.platform==='win32',channel=windows?process.env.MODEL_LENS_BROWSER_CHANNEL:undefined,python=windows?process.env.MODEL_LENS_QA_PYTHON:undefined;
const trustedBootstrap=windows&&process.env.MODEL_LENS_TRUSTED_BOOTSTRAP==='1';
const policy=soak?MODEL_EDIT_LIFECYCLE_POLICY:MODEL_COMPOSITION_LIFECYCLE_POLICY;
const report={status:'failed',startedAt:new Date().toISOString(),policy,cycles:[],samples:[],checks:[],limitations:[
    soak?'At least two active hours, 64 full cycles and two initial warmups; finite measurements cannot prove an absence of all leaks.':'Eight cycles with two warmups bound observed growth; finite measurements cannot prove an absence of all leaks.',
    'Physical synthetic nonzero weights with opaque custom options; no company model or custom runtime execution.',
    'Summed /proc RSS includes observed owned Chromium identities, including reparented descendants, and can double-count shared pages; 500ms sampling can miss spikes or processes never observed.',
    'Worker Runtime.getHeapUsage measures the V8 isolate at source/reopen checkpoints, not separate OS RSS or a continuous peak.',
    'Parser/main read guards reject >1MiB calls or >16MiB per realm before allocation; dedicated recovery identity workers read exactly one original file in <=1MiB calls. No forced garbage collection or shortened URL timer.'
]};
report.workerClosures=[];
if(memoryDiagnosticMode){
    assert.equal(process.platform,'linux','Native attribution is restricted to isolated Linux CI.');
    Object.assign(report,{purpose:'readonly-native-memory-attribution',releaseEvidenceEligible:false,forcedGC:false});
    report.limitations.push('Supplementary native memory/CDP readings are temporally anchored observations, not replacements for the original RSS, proof of ownership or release evidence.');
}
if(soak)Object.assign(report,{format:'model-lens-lifecycle-soak',version:2,soakPolicy:LIFECYCLE_SOAK_POLICY,recoveryPolicy:SOAK_RECOVERY_POLICY,soak:{activeDurationMs:0,viewport:{width:1280,height:640}},workerClosures:[]});
const errors=[],wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));
// Resource preflight also uses this helper when cgroup files are unavailable.
const optionalRead=file=>readFile(file,'utf8').then(s=>s.trim()).catch(()=>null);
const check=name=>{report.checks.push(name);console.log(`PASS ${name}`);};
let temporary,server,browser,context,page,cdp,browserCDP,readPage,timer,pending=Promise.resolve(),sampling=false,processTree,phase='startup',shuttingDown=false,activeStarted,draftRecovery;
let windowsObserver,diagnosticPhase=null,diagnosticAt=0,memoryDiagnostics;
const activeElapsed=()=>activeStarted===undefined?null:performance.now()-activeStarted;
async function persistReport(){await writeFile(reportPath+'.tmp',JSON.stringify(report,null,2)+'\n');await rename(reportPath+'.tmp',reportPath);}
const watchdogMinutes=soak?160:windows?30:22;
report.watchdogMinutes=watchdogMinutes;
const watchdog=setTimeout(async()=>{report.status='failed';report.error=`Hard timeout during ${phase}`;await persistReport();console.error(report.error);process.exit(1);},watchdogMinutes*60000);

const patterns=[
    reusablePattern('Lifecycle prefix',{nodes:[{alias:'N1',type:'HugeWeightProject'},{alias:'N2',type:'Reshape'},{alias:'N3',type:'Transpose'},{alias:'N4',type:'Reshape'}],edges:[{from:'N1',to:'N2'},{from:'N2',to:'N3'},{from:'N3',to:'N4'}],induced:true}),
    reusablePattern('Lifecycle branch',{nodes:[{alias:'N1',type:'Mul'},{alias:'N2',type:'Add'},{alias:'N3',type:'CompanySplitLongNameForLargeModel'},{alias:'N4',type:'Add'}],edges:[{from:'N1',to:'N2'},{from:'N1',to:'N3'},{from:'N2',to:'N4'},{from:'N3',to:'N4'}],induced:true})
];
if(!soak)patterns.push(reusablePattern('Lifecycle branch wrong edge',{...patterns[1],edges:[...patterns[1].edges,{from:'N2',to:'N3'}]}));
async function processRss(){
    assert.ok(processTree,'Cannot locate owned Chromium identities.');
    if(!windows){
        const rows=await readProcessTable(),memory=processTree.sample(rows);
        if(!memoryDiagnostics)return memory;
        const owned=new Set(processTree.identities.map(p=>`${p.pid}:${p.startTicks}`));
        return {...memory,diagnosticIdentities:rows.filter(p=>owned.has(`${p.pid}:${p.startTicks}`)).map(({pid,startTicks})=>({pid,startTicks}))};
    }
    const native=await windowsObserver.sample();report.windowsObservedIdentities=native.identities;
    if(diagnosticPhase!==phase||Date.now()-diagnosticAt>=10000){
        const [{processInfo},mainHeap,dom]=await Promise.all([browserCDP.send('SystemInfo.getProcessInfo'),cdp.send('Runtime.getHeapUsage'),cdp.send('Memory.getDOMCounters')]);
        const types=new Map(processInfo.map(p=>[p.id,p.type]));
        report.nativeProcessBreakdown??=[];
        report.nativeProcessBreakdown.push({phase,elapsedMs:Date.now()-Date.parse(report.startedAt),rows:native.rows.map(r=>({...r,type:types.get(r.pid)||'unknown'})),mainHeap,dom});
        diagnosticPhase=phase;diagnosticAt=Date.now();
    }
    return {...processTree.sample(native.rows),privateCommitBytes:native.rows.reduce((n,r)=>n+r.privateCommitBytes,0)};
}
async function sample({settle=false}={}){
    const {diagnosticIdentities,...memory}=await processRss(),{metrics}=await cdp.send('Performance.getMetrics'),mainHeapBytes=metrics.find(m=>m.name==='JSHeapUsedSize')?.value;
    assert.ok(Number.isFinite(mainHeapBytes)&&mainHeapBytes>0,'Main heap unavailable.');
    const sample={phase,elapsedMs:Date.now()-Date.parse(report.startedAt),...memory,mainHeapBytes};if(soak)sample.activeElapsedMs=activeElapsed();const index=report.samples.length;report.samples.push(sample);
    if(memoryDiagnostics)await memoryDiagnostics.capture(index,diagnosticIdentities,sample,metrics,{settle});
    return sample;
}
async function waitFor(fn,timeout=30000){const until=Date.now()+timeout;while(!await readPage(fn)){if(Date.now()>until)throw Error(`Timed out: ${fn}`);await wait(100);}}
async function choose(file,button='#open-model'){
    const chooser=page.waitForEvent('filechooser');await page.locator(button).click();await (await chooser).setFiles(file);
}
async function ready(count){
    await waitFor(()=>document.querySelector('#model-tabs')?.getAttribute('aria-busy')!=='true'&&document.querySelector('#loading-card').hidden && document.querySelector('#layer-count').textContent!=='—');
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
async function verifyDownload(filename,kind,fullEdit=false){
    const fd=openSync(filename,'r');let index,readBytes=0,maxRead=0;
    try{
        const size=fstatSync(fd).size;assert.ok(size>1024**3);
        const metadata=JSON.parse(await readFile('vendor/netron/tflite-metadata.json','utf8'));
        index=await parseModel((at,length)=>{
            readBytes+=length;maxRead=Math.max(maxRead,length);assert.ok(length<=policy.maxReadBytes&&readBytes<=policy.realmReadBytes);
            const bytes=new Uint8Array(length);assert.equal(readSync(fd,bytes,0,length,at),length);return bytes;
        },size,metadata);
    }finally{closeSync(fd);}
    const graph=index.raw.subgraphs[0];assert.equal(graph.operators.length,fullEdit?21006:4);assert.equal(graph.tensors.length,21012);assert.equal(graph.inputs.length,1);assert.equal(graph.outputs.length,fullEdit?3:kind===0?1:2);assert.equal(index.raw.buffers.length,5);
    const custom=graph.operators.find(op=>op.opcode_index===(kind===0?0:5));assert.ok(custom);assert.deepEqual(custom.custom_options,PHYSICAL_OPTIONS);
    assert.deepEqual([...graph.operators[0].inputs],kind===0?[0,1]:[21005,4]);
    if(fullEdit){assert.deepEqual([...graph.operators[1].inputs],[0,1]);assert.deepEqual([...graph.operators[1].outputs],[21011]);assert.deepEqual([...graph.operators[2].inputs],[5,2]);assert.equal(graph.tensors[21011].name,'projected_input_edit_1_0');assert.equal(graph.operators.filter(op=>op.opcode_index===0).length,2);for(const op of graph.operators.filter(op=>[0,5].includes(op.opcode_index)))assert.deepEqual(op.custom_options,PHYSICAL_OPTIONS);}
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
    return {bytes:offset,sha256:whole.digest('hex'),weightSHA256,readBytes,maxRead,operators:graph.operators.length,inputs:[...graph.inputs],outputs:[...graph.outputs],weightVerified:true,optionsVerified:true};
}

async function sourceFingerprint(filename){
    const fd=openSync(filename,'r');try{const size=fstatSync(fd).size;return await editFileFingerprint({size,slice(start,end){assert.ok(end-start<=1024**2);return {async arrayBuffer(){const bytes=new Uint8Array(end-start);assert.equal(readSync(fd,bytes,0,bytes.length,start),bytes.length);return bytes.buffer;}};}});}finally{closeSync(fd);}
}
async function editWholeModel(cycle,entry,hashes){
    phase=`cycle-${cycle}-edit-source`;
    await page.locator('[data-kind="layers"]').click();await page.locator('#scope').selectOption('current');await page.locator('#query').fill('#0');
    await waitFor(()=>document.querySelector('#results').dataset.searchQuery==='#0'&&document.querySelector('#results').getAttribute('aria-busy')==='false'&&document.querySelector('#result-count').textContent==='1 筆結果');
    await page.locator('.result-item').first().click();await waitFor(()=>document.querySelector('#target').getAttribute('aria-busy')==='false');
    await page.locator('#edit-mode').click();await waitFor(()=>document.body.classList.contains('editing-model')&&document.querySelector('#edit-workspace').getAttribute('aria-busy')==='false'&&document.querySelectorAll('[data-edit-node]').length>0);
    if(soak){await page.locator('#edit-font').selectOption('32');entry.editFont=Number(await page.locator('#edit-font').inputValue());assert.equal(entry.editFont,32);}
    const scopeOriginals=await readPage(()=>document.querySelectorAll('[data-edit-node]').length);assert.ok(scopeOriginals>=2&&scopeOriginals<=64);assert.match(await page.locator('[data-edit-node="op:0:0"] .edit-node-title').textContent(),/HugeWeightProject/);await page.locator('[data-edit-node="op:0:0"] .edit-node-title').click();await page.locator('#edit-add-after').click();await page.locator('#edit-expose').check();
    const started=Date.now();phase=`cycle-${cycle}-full-model-export`;let event=page.waitForEvent('download');await page.locator('#edit-export').click();let download=await event;assert.equal(await download.failure(),null);
    const full=path.join(temporary,`cycle-${cycle}-full.tflite`);await download.saveAs(full);await download.delete();await waitFor(()=>!document.querySelector('#edit-open-result').disabled);
    const exportMs=Date.now()-started;event=page.waitForEvent('download');await page.locator('#edit-download-report').click();download=await event;assert.equal(await download.failure(),null);const reportFile=full+'.report.json';await download.saveAs(reportFile);await download.delete();
    const proof=JSON.parse(await readFile(reportFile,'utf8'));assert.equal(proof.provenance.mode,'model-edit');assert.equal(proof.checks.find(c=>c.id==='serialized-roundtrip').status,'passed');assert.equal(proof.modification.before.layers,21005);assert.equal(proof.modification.after.layers,21006);
    phase=`cycle-${cycle}-edit-recovery`;if(soak)await draftRecovery.ensureSaved(entry);else await waitFor(()=>document.querySelector('#edit-recovery-status').textContent.startsWith('已保存本機編輯草稿'),90000);
    const recovery=await readPage(()=>globalThis.__lifecycle.workers.filter(w=>w.recoveryAudit?.complete).at(-1)?.recoveryAudit);assert.equal(recovery.fingerprint,report.fixture.editFingerprint);assert.equal(recovery.bytes,report.fixture.bytes);assert.ok(recovery.maxRead<=1024**2);entry.recovery=recovery;
    const before=page.workers().find(w=>/\/model-worker\.js(?:\?|$)/.test(w.url()));assert.ok(before);let deadline;
    try{const ended=Promise.race([once(before,'close'),new Promise((_,reject)=>{deadline=setTimeout(()=>reject(Error('Original edit Worker did not close.')),5000);})]);await page.locator('#edit-open-result').click();await ended;}finally{clearTimeout(deadline);}
    await ready(21006);await page.locator('[data-kind="patterns"]').click();await match(patterns[0].name,1);await match(patterns[1].name,1);
    entry.workerHeaps.push({phase:'edited-model',...await modelWorkerHeap(browserCDP)});
    phase=`cycle-${cycle}-full-model-verify`;const verified=await verifyDownload(full,0,true),receipt=await verifyExportFiles({report:proof,source:report.fixture.file,output:full});assert.equal(receipt.byteComparison.status,'passed');assert.equal(receipt.outputSHA256,verified.sha256);
    if(hashes.has('full-model'))assert.equal(verified.sha256,hashes.get('full-model'));else hashes.set('full-model',verified.sha256);
    entry.modelEdit={workspaceNative:true,scopeOriginals,sourceOperators:21005,outputOperators:proof.modification.after.layers,readbackOperators:verified.operators,bytes:verified.bytes,sha256:verified.sha256,weightSHA256:verified.weightSHA256,weightVerified:verified.weightVerified,optionsVerified:verified.optionsVerified,roundTrip:true,prefixMatches:1,branchMatches:1,byteComparison:receipt.byteComparison.status,comparedBytes:receipt.byteComparison.bytes,byteRanges:receipt.byteComparison.ranges.length,exportMs};
    return [full,reportFile];
}
try{
    assert.ok(['gate','soak'].includes(mode),'Unknown lifecycle profile.');if(soak)assertSoakExecution(process.env,os.platform());
    if(windows){assert.ok(process.argv.includes('--allow-local-browser'),'Local Windows browser requires explicit authorization.');assert.ok(['chrome','msedge'].includes(channel)&&python,'Choose installed Chrome/Edge and Python.');assert.equal(soak,false,'No Windows two-hour soak is authorized.');report.limitations[2]='Summed Windows WorkingSetSize includes observed owned browser identities and can double-count shared pages;500ms sampling can miss spikes or processes never observed. PrivateUsage is supplementary private commit,not RSS.';}
    else assert.equal(os.platform(),'linux','OS RSS gate requires isolated Linux CI or authorized Windows.');
    if(trustedBootstrap)assert.ok(process.env.LIFECYCLE_BUILD,'Trusted Windows bootstrap requires an authenticated explicit artifact.');
    const disk=await statfs(os.tmpdir()),memoryLimit=windows?null:await optionalRead('/sys/fs/cgroup/memory.max'),memoryCurrent=windows?null:await optionalRead('/sys/fs/cgroup/memory.current');
    const available=memoryLimit&&memoryLimit!=='max'?Number(memoryLimit)-Number(memoryCurrent):os.freemem();assert.ok(available>=4*1024**3,'Need 4 GiB available RAM.');assert.ok(disk.bavail*disk.bsize>=8*1024**3,'Need 8 GiB free disk.');
    report.environment={platform:os.platform(),release:os.release(),node:process.version,cpu:os.cpus()[0]?.model,cpus:os.cpus().length,totalMemory:os.totalmem(),availableMemoryBytes:available,memoryLimit,memoryCurrent,tempFreeBytes:disk.bavail*disk.bsize,imageVersion:process.env.ImageVersion||null,runId:process.env.GITHUB_RUN_ID||null,sourceCommit:execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),sourceTree:execFileSync('git',['rev-parse','HEAD^{tree}'],{encoding:'utf8'}).trim(),sourceDirty:Boolean(execFileSync('git',['status','--porcelain'],{encoding:'utf8'}).trim())};assert.equal(report.environment.sourceDirty,false);
    temporary=await mkdtemp(path.join(os.tmpdir(),'model-lens-lifecycle-'));phase='physical-fixture';
    if(windows){report.status='running';report.fixtureIntent={directory:temporary,file:path.join(temporary,'physical-1_25GiB.tflite'),expectedBytes:PHYSICAL_SOURCE_BYTES,producer:'writePhysicalFixture',retain:'Keep generated source and remaining small files for evidence review;verified per-cycle regenerated downloads are removed by exact filename after closure'};await persistReport();}
    report.fixture=await writePhysicalFixture(path.join(temporary,'physical-1_25GiB.tflite'));report.fixture.editFingerprint=await sourceFingerprint(report.fixture.file);
    if(windows){report.fixture.allocatedBytes=windowsAllocatedBytes(python,report.fixture.file);report.fixture.allocationMethod='Windows GetCompressedFileSizeW,owned generated fixture only';}
    assert.equal(report.fixture.bytes,PHYSICAL_SOURCE_BYTES);assert.equal(report.fixture.sha256,PHYSICAL_SOURCE_SHA256);assert.equal(report.fixture.weightSHA256,PHYSICAL_WEIGHT_SHA256);assert.ok(report.fixture.allocatedBytes>=report.fixture.bytes*.99);check('dense physical 1.25 GiB / 21,005 OP fixture, complete write/readback SHA-256');
    const suppliedBuild=windows?process.env.LIFECYCLE_BUILD:undefined;let documentFixture;
    if(trustedBootstrap)assert.ok(suppliedBuild,'Trusted Windows bootstrap requires an authenticated explicit artifact.');
    if(suppliedBuild){const manifest=await verifyArtifact(path.resolve(suppliedBuild),{expectedCommit:report.environment.sourceCommit,requireClean:true,publicOnly:true});report.build=manifest.release;report.buildReused=true;assert.equal(report.build.source.tree,report.environment.sourceTree);if(trustedBootstrap){documentFixture=await trustedDocument(path.resolve(suppliedBuild),manifest);report.documentFixture=documentFixture.proof;report.limitations.push('Windows bootstrap HTML is delivered verbatim from the authenticated artifact via a local test fixture with its original CSP. Other assets use HTTP. This measures native file/browser/process behavior, not HTTP document transport or antivirus compatibility. Raw HTTP injection/close failures are retained separately.');}}
    else{execFileSync(process.execPath,['scripts/build.mjs'],{stdio:'inherit'});report.build=JSON.parse(await readFile('dist/release.json','utf8'));}
    assert.equal(report.build.source.commit,report.environment.sourceCommit);assert.equal(report.build.source.dirty,false);
    server=createStaticServer(suppliedBuild?path.resolve(suppliedBuild):undefined);server.listen(0,'127.0.0.1');await once(server,'listening');const base=`http://127.0.0.1:${server.address().port}`;
    if(soak){phase='draft-capacity-preflight';report.recoveryPreflight={};await recoveryCapacityPreflight({base,directory:temporary,report:report.recoveryPreflight});await persistReport();check('real 22-session draft backup/remove/retry preflight, other nineteen unchanged and owned browser reaped');}
    // Chromium's own browser tests disable its updater scheduler per launch.
    // This affects only this isolated Chrome; all observed descendants still count.
    // https://chromium.googlesource.com/chromium/src.git/+/fc613d7cb460a811be6d8d8a6f5ab147f35e3ad6/chrome/test/base/in_process_browser_test.cc
    const testArguments=windows&&channel==='chrome'?['--disable-updater-scheduler']:[];
    report.environment.testArguments=testArguments;
    const ownershipMarker=randomBytes(16).toString('hex');browser=await chromium.launch({headless:true,...(windows?{channel}:{}),args:[`--model-lens-lifecycle=${path.basename(temporary)}`,...testArguments],env:{...process.env,MODEL_LENS_PHYSICAL_OWNER:ownershipMarker}});report.environment.chromium=browser.version();report.environment.playwright=JSON.parse(await readFile('node_modules/playwright/package.json','utf8')).version;
    let root;
    if(windows){browserCDP=await browser.newBrowserCDPSession();windowsObserver=await windowsProcessObserver({python,cdp:browserCDP,channel});root=windowsObserver.root;report.environment.channel=channel;report.processOwnership={format:'model-lens-owned-processes',version:1,root,backend:windowsObserver.backend,counter:windowsObserver.counter,supplementary:windowsObserver.supplementary};}
    else{root=await findOwnedBrowserRoot(await readProcessTable(),process.pid,ownershipMarker);report.processOwnership={format:'model-lens-owned-processes',version:1,root};}
    processTree=new OwnedProcessTree(root);
    browser.on('disconnected',()=>{if(!shuttingDown)errors.push('Browser disconnected.');});
    context=await browser.newContext({viewport:{width:1280,height:640},acceptDownloads:true});await context.addInitScript(installLifecycleAudit);
    await context.route('**/*',async route=>{const request=route.request();if(!request.url().startsWith(base+'/')||request.method()!=='GET'){const rejected=new URL(request.url());errors.push(`Unexpected network ${request.method()} ${rejected.origin}${rejected.pathname}`);await route.abort();}else if(!documentFixture||!await documentFixture.handle(route,base))await route.continue();});
    await context.route('**/src/model-worker.js*',async route=>{const response=await route.fetch();await route.fulfill({response,body:`(${installLifecycleAudit.toString()})(true);\n${await response.text()}`});});
    await context.route('**/src/edit-recovery-worker.js*',async route=>{const response=await route.fetch();await route.fulfill({response,body:`(${installRecoveryReadAudit.toString()})(${report.fixture.bytes});\n${await response.text()}`});});
    page=await context.newPage();page.setDefaultTimeout(30000);page.on('pageerror',error=>errors.push(error.message));page.on('crash',()=>errors.push('Page crashed.'));
    page.on('worker',worker=>{const entry={url:worker.url(),closed:false};report.workerClosures.push(entry);worker.once('close',()=>{entry.closed=true;});});
    browserCDP??=await browser.newBrowserCDPSession();await browserCDP.send('Target.setDiscoverTargets',{discover:true});cdp=await context.newCDPSession(page);await cdp.send('Performance.enable');
    readPage=async fn=>{const result=await cdp.send('Runtime.evaluate',{expression:`(${typeof fn==='string'?fn:fn.toString()})()`,returnByValue:true});if(result.exceptionDetails)throw Error(JSON.stringify(result.exceptionDetails));return result.result.value;};
    if(soak)draftRecovery=createSoakRecovery({page,read:readPage,directory:temporary,fixture:report.fixture});
    if(memoryDiagnosticMode){memoryDiagnostics=createLifecycleMemoryDiagnostics({now:()=>Date.now()-Date.parse(report.startedAt),cdp,browserCDP});report.memoryProfile=memoryDiagnostics.profile;}
    await page.goto(base);await page.locator('#welcome-open').waitFor();phase='baseline';await sample();
    timer=setInterval(()=>{if(sampling)return;sampling=true;pending=sample().catch(error=>errors.push(`Sampler: ${error.message}`)).finally(()=>{sampling=false;});},policy.sampleIntervalMs);
    const patternFile=path.join(temporary,'patterns.json');await writeFile(patternFile,exportPatterns(patterns));
    // Initial model is opened below; pattern UI is available after selecting its tab.
    const hashes=new Map();
    if(soak){activeStarted=performance.now();report.status='running';await persistReport();}
    for(let cycle=1;soak?needsSoakCycle(cycle-1,activeElapsed()):cycle<=policy.cycles;cycle++){
        const kind=(cycle-1)%2,name=patterns[kind].name,other=patterns[1-kind].name,entry={cycle,kind:kind===0?'prefix':'branch',workerHeaps:[]};report.cycles.push(entry);
        if(soak)entry.activeStartMs=activeElapsed();
        phase=`cycle-${cycle}-source`;await choose(report.fixture.file);await ready(21005);
        if(cycle===1){await page.locator('#graph-font-size').selectOption('32');await waitFor(()=>document.querySelector('#target').getAttribute('aria-busy')==='false');}entry.font=Number(await page.locator('#graph-font-size').inputValue());assert.equal(entry.font,32);
        await page.locator('[data-kind="patterns"]').click();
        if(cycle===1){
            await page.locator('#open-import').click();await choose(patternFile,'#choose-pattern-file');await page.locator('#confirm-import').click();await waitFor(()=>!document.querySelector('#import-dialog').open);
            const downloadEvent=page.waitForEvent('download');await page.locator('#export-patterns').click();const downloaded=await downloadEvent;assert.equal(await downloaded.failure(),null);const saved=path.join(temporary,'patterns-roundtrip.json');await downloaded.saveAs(saved);assert.deepEqual(parsePatternFile(await readFile(saved,'utf8')),patterns);await downloaded.delete();check('native pattern JSON import/export preserves both reference structures');
        }
        await page.locator('#reset-pattern').click();await waitFor(()=>document.querySelector('#result-count').textContent==='7,000 筆匹配路徑');
        await match(name,1);entry.patternSourceMatches=1;await match(other,1);await match(name,1);
        await page.locator('.result-item').first().click();await waitFor(()=>document.querySelector('#target').getAttribute('aria-busy')==='false'&&document.querySelectorAll('#target .node').length>0);
        entry.workerHeaps.push({phase:'source',...await modelWorkerHeap(browserCDP)});
        const editedFiles=await editWholeModel(cycle,entry,hashes);await match(name,1);await page.locator('.result-item').first().click();await waitFor(()=>document.querySelector('#target').getAttribute('aria-busy')==='false');
        phase=`cycle-${cycle}-download`;const downloadEvent=page.waitForEvent('download');await page.locator('#export-match').click();const download=await downloadEvent;assert.equal(await download.failure(),null);const child=path.join(temporary,`cycle-${cycle}.tflite`);await download.saveAs(child);await download.delete();assert.ok((await stat(child)).size>1024**3);
        await closeModel();phase=`cycle-${cycle}-reopen`;await choose(child);await ready(4);await match(name,1);entry.patternReopenMatches=1;await match(other,0);entry.negativePatternMatches=0;await match(name,1);
        await page.locator('.result-item').first().click();await waitFor(()=>document.querySelector('#target').getAttribute('aria-busy')==='false'&&document.querySelectorAll('#target .node').length>0);
        entry.workerHeaps.push({phase:'reopen',...await modelWorkerHeap(browserCDP)});await closeModel();
        phase=`cycle-${cycle}-hash`;Object.assign(entry,await verifyDownload(child,kind));if(hashes.has(kind))assert.equal(entry.sha256,hashes.get(kind),'Repeated exports must be byte-identical.');else hashes.set(kind,entry.sha256);
        const compositionFiles=soak?[]:await physicalComposition({page,read:readPage,waitFor,choose,ready,match,closeModel,browserCDP,fixture:report.fixture,policy,cycle,entry,directory:temporary,hashes,setPhase:value=>{phase=value;}});
        if(soak){phase=`cycle-${cycle}-draft-backup`;await draftRecovery.finishCycle(entry);}
        phase=`cycle-${cycle}-release`;await waitFor(()=>globalThis.__lifecycle.urls.every(item=>item.revoked),policy.urlReleaseTimeoutMs);
        const settled=[];for(let i=0;i<policy.settleSamples;i++){await wait(1000);settled.push(await sample({settle:true}));}
        entry.closedRssBytes=median(settled.map(s=>s.rssBytes));entry.closedMainHeapBytes=median(settled.map(s=>s.mainHeapBytes));entry.fileInputEmpty=await readPage(()=>document.querySelector('#model-file').files.length===0);entry.liveModelWorkers=page.workers().filter(w=>/\/model-worker\.js(?:\?|$)/.test(w.url())).length;entry.activeBlobUrls=await readPage(()=>globalThis.__lifecycle.urls.filter(item=>!item.revoked).length);
        await rm(child);for(const filename of [...editedFiles,...compositionFiles])await rm(filename);
        if(soak){entry.activeEndMs=activeElapsed();report.soak.activeDurationMs=entry.activeEndMs;if(cycle%policy.cycles===0)await persistReport();}
        else if(windows)await persistReport();
        console.log(`PASS cycle ${cycle}/${soak?'two-hour soak':policy.cycles}: ${entry.kind}, full edit ${entry.modelEdit.bytes} bytes in ${entry.modelEdit.exportMs}ms, submodel ${entry.bytes} bytes, closed RSS ${(entry.closedRssBytes/1024**2).toFixed(1)} MiB`);
    }
    if(soak){clearInterval(timer);await pending;report.soak.activeDurationMs=activeElapsed();}
    report.audit=await readPage(()=>globalThis.__lifecycle);
    assert.equal(report.audit.workers.filter(w=>/\/model-worker\.js(?:\?|$)/.test(w.url)).length,report.cycles.length*(soak?3:5));
    assert.equal(report.audit.workers.filter(w=>w.verificationPasses===1).length,report.cycles.length*(soak?1:2));
    for(const entry of report.audit.workers){assert.equal(entry.error,undefined);if(/\/model-worker\.js(?:\?|$)/.test(entry.url)){assert.equal(entry.terminated,true);assert.ok(entry.audit?.bytes>0);assert.equal(entry.audit.bytes,entry.stats.bytesRead+(entry.verificationReadBytes||0));}}
    const recoveryWorkers=report.audit.workers.filter(w=>w.recoveryAudit);assert.equal(recoveryWorkers.length,report.cycles.length*(soak?1:2));assert.ok(recoveryWorkers.every(w=>w.terminated&&w.recoveryAudit.complete&&w.recoveryAudit.bytes===report.fixture.bytes&&w.recoveryAudit.maxRead<=1024**2&&w.recoveryAudit.violations.length===0&&w.recoveryAudit.fingerprint===report.fixture.editFingerprint));check(`${recoveryWorkers.length} full original-file recovery fingerprints match independent bounded Node reads, strict committed recovery status and terminated workers`);
    for(const audit of [report.audit.audit,...report.audit.workers.map(w=>w.audit).filter(Boolean)]){assert.deepEqual(audit.violations,[]);assert.ok(audit.maxRead<=policy.maxReadBytes&&audit.bytes<=policy.realmReadBytes);}
    assert.equal(execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),report.environment.sourceCommit);assert.equal(execFileSync('git',['rev-parse','HEAD^{tree}'],{encoding:'utf8'}).trim(),report.environment.sourceTree);assert.equal(execFileSync('git',['status','--porcelain'],{encoding:'utf8'}).trim(),'');report.sourceUnchanged=true;
    assert.deepEqual(errors,[]);if(documentFixture)assert.equal(report.documentFixture.deliveries,1);report.evaluation=soak?evaluateLifecycleSoak(report):evaluateLifecycle(report);assert.equal(report.evaluation.status,'passed',report.evaluation.issues.join(', '));check(`${report.cycles.length} physical-file cycles, alternating custom branch/prefix, stable hashes, no retained File/Worker/Blob URL and fixed memory limits`);report.status='passed';
}catch(error){report.status='failed';report.error=error.stack||String(error);console.error(report.error);if(readPage)report.audit=await readPage(()=>globalThis.__lifecycle).catch(()=>null);}
finally{
    clearInterval(timer);await pending;shuttingDown=true;
    if(memoryDiagnostics)try{memoryDiagnostics.finish(report.samples);}catch(error){report.status='failed';errors.push(`Memory diagnostic: ${error.message}`);}
    try{
        if(context)await context.close();
        if(browser){let timeout;try{await Promise.race([browser.close(),new Promise((_,reject)=>{timeout=setTimeout(()=>reject(Error('Browser close/reap timed out.')),10000);})]);}finally{clearTimeout(timeout);}}
        if(processTree){report.processCleanup=await waitOwnedProcessExit(processTree,windows?{readTable:async()=>{const native=await windowsObserver.remaining();report.windowsObservedIdentities=native.identities;return native.rows;}}:{});assert.equal(report.processCleanup.allReaped,true,'Observed owned browser identities remained after close.');if(windows){const native=await windowsObserver.remaining();report.windowsObservedIdentities=native.identities;assert.deepEqual(native.rows,[],'Native observed identities remained after close.');}}
        report.browserClosed=true;
    }catch(error){report.status='failed';errors.push(`Cleanup: ${error.message}`);report.forcedCleanup=[];
        try{if(!windows&&processTree)for(const candidate of processTree.remaining(await readProcessTable())){const live=processTree.remaining(await readProcessTable()).find(p=>p.pid===candidate.pid&&p.startTicks===candidate.startTicks);if(live&&live.pid>1&&live.pid!==process.pid){try{process.kill(live.pid,'SIGKILL');report.forcedCleanup.push({pid:live.pid,startTicks:live.startTicks});}catch(e){if(e.code!=='ESRCH')errors.push('Owned process termination failed.');}}}}catch{errors.push('Ownership proof unavailable; no unverified PID signalled.');}
    }
    if(windows&&processTree&&!report.processCleanup){try{report.cleanupObservationAfterDriverError=true;report.processCleanup=await waitOwnedProcessExit(processTree,{readTable:async()=>{const native=await windowsObserver.remaining();report.windowsObservedIdentities=native.identities;return native.rows;}});}catch(error){errors.push(`Native cleanup observation: ${error.message}`);}}
    if(windowsObserver){try{report.windowsObserverClose=await windowsObserver.close();}catch(error){report.status='failed';errors.push(`Observer close: ${error.message}`);}}
    if(server){server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
    // Only this invocation's mkdtemp directory; no model from the user's filesystem.
    if(windows&&temporary)report.retainedFixtureDirectory=temporary;
    else if(temporary && path.dirname(temporary)===os.tmpdir() && path.basename(temporary).startsWith('model-lens-lifecycle-'))await rm(temporary,{recursive:true,force:true});
    report.errors=errors;report.finishedAt=new Date().toISOString();await persistReport();clearTimeout(watchdog);console.log(`Report ${reportPath}: ${report.status}`);process.exit(report.status==='passed'?0:1);
}
