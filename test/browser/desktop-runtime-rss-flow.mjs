// Hosted-only native gestures in a separate, exactly owned browser process.
// RSS is not a substitute for unavailable main/Worker isolate heap metrics.
import assert from 'node:assert/strict';
import {readFile,writeFile,mkdtemp,unlink,rmdir} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import {randomBytes,createHash} from 'node:crypto';
import os from 'node:os';
import path from 'node:path';
import {buildEvent,gitSource} from '../../scripts/lib/release-artifact.mjs';
import {runtimeMemoryFixture,runtimeMemoryValues,RUNTIME_MEMORY_ELEMENTS} from '../runtime-memory-fixture.mjs';
import {runtimePlan} from '../../src/tflite-runtime-policy.js';
import {Archive} from '../../vendor/netron/zip.js';
import {OwnedProcessTree,readProcessTable,findOwnedBrowserRoot,waitOwnedProcessExit} from './owned-processes.mjs';
import {desktopDOMReader} from './desktop-dom-reader.mjs';
import {runtimeInputCleanupProof} from './runtime-input-cleanup-proof.mjs';
import {installDesktopRuntimeURLAudit} from './desktop-runtime-url-audit.mjs';
import {DESKTOP_RUNTIME_RSS_POLICY as policy,DESKTOP_RUNTIME_MEASUREMENTS,evaluateDesktopRuntimeRSS} from './desktop-runtime-rss-policy.mjs';
import {median} from './lifecycle-policy.mjs';
import {createProcessMemoryProbe,summarizeMemoryProfile} from './process-memory-profile.mjs';

export async function desktopRuntimeRSSFlow({browserType,engine,base}){
    assert.equal(process.env.GITHUB_ACTIONS,'true');assert.equal(process.platform,'linux');assert.ok(['firefox','webkit'].includes(engine));
    const source=gitSource();assert.equal(source.dirty,false);
    const report={format:'model-lens-desktop-runtime-rss',version:1,status:'failed',engine,base,source,policy,measurements:DESKTOP_RUNTIME_MEASUREMENTS,startedAt:new Date().toISOString(),forcedGC:false,shortenedURLTimer:false,cycles:[],samples:[],modelWorkers:[],runtimeWorkers:[],urlWindows:[],urls:[],inputCleanupRequired:true,inputCleanup:[],requests:[],errors:[],browserClosed:false,temporary:{directory:null,files:[],events:[]},limitations:[
        'Eight public synthetic cycles,24 manual CPU invocations; no company models, hours-long result or other OS.',
        'Summed owned-process RSS can double-count shared pages; mainHeap and workerIsolateHeap are unavailable and remain null.',
        '500ms sampling can miss short peaks or processes never observed. PID/start-ticks identities remain tracked after reparenting.',
        'Only normal native URL timers and browser shutdown; no forced GC, shortened timers or synthetic Worker close events.'
    ]};
    const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms)),hash=bytes=>createHash('sha256').update(bytes).digest('hex');
    let browser,context,page,read,tree,directory,timer,pending=Promise.resolve(),sampling=false,phase='setup',clock=null;
    const memoryProbe=engine==='firefox'?createProcessMemoryProbe({now:()=>Date.now()-clock}):null;
    if(memoryProbe)report.memoryProfile={format:'model-lens-proc-memory',version:1,samples:[]};
    const deadline=()=>assert.ok(Date.now()-clock<=policy.deadlineMs,'Desktop runtime lifecycle exceeded its original external budget.');
    const event=async(type,row,extra={})=>{const value={task_id:`desktop-runtime-${engine}`,operation_id:`${row.id}-${type}`,artifact_id:row.id,event:type,path:row.path,kind:'temporary',purpose:row.purpose,producer:'test/browser/desktop-runtime-rss-flow.mjs',cleanup_condition:'Synthetic fixture/BIN/IO only, never user data; verified or no longer needed after this bounded run',...extra};await buildEvent(value);report.temporary.events.push({...value,timestamp:new Date().toISOString()});};
    async function intended(name,purpose){assert.match(name,/^[a-z0-9.-]+$/);const file=path.resolve(directory,name);assert.ok(file.startsWith(directory+path.sep));const row={id:`file-${report.temporary.files.length+1}`,path:file,purpose,status:'planned'};report.temporary.files.push(row);await event('create_intent',row);return row;}
    async function created(row,bytes){row.status='created';row.bytes=bytes;await event('created',row,{size_bytes:bytes});}
    async function remove(row){if(row.status==='removed')return;assert.ok(row.path.startsWith(directory+path.sep));await event('delete_intent',row);try{await unlink(row.path);row.status='removed';await event('removed',row);}catch(error){if(error.code!=='ENOENT')throw error;row.status='removed';await event('already_absent',row);}}
    async function write(name,bytes,purpose){const row=await intended(name,purpose);await writeFile(row.path,bytes,{flag:'wx'});await created(row,bytes.byteLength);return row;}
    async function sample(label=phase){const table=await readProcessTable(),memory=tree.sample(table),row={phase:label,elapsedMs:Date.now()-clock,...memory},slot=report.samples.length;report.samples.push(row);assert.ok(report.samples.length<=2048);if(memoryProbe)report.memoryProfile.samples[slot]=await memoryProbe.capture(tree.remaining(table),row);return slot;}
    async function until(fn,...args){const end=Date.now()+30000;while(!await read(fn,...args)){deadline();assert.ok(Date.now()<end,'Desktop runtime DOM observation timed out: '+fn);await wait(60);}}
    async function choose(file,button){const chosen=page.waitForEvent('filechooser');await page.locator(button).click();await(await chosen).setFiles(file);}
    async function audit(){const value=JSON.parse(await page.locator('html').getAttribute('data-lens-runtime-urls'));assert.equal(value.version,1);assert.equal(value.overflow,false);return value;}
    async function closed(){const end=Date.now()+5000;while([...report.modelWorkers,...report.runtimeWorkers].some(w=>!w.closed)&&Date.now()<end)await wait(30);assert.ok([...report.modelWorkers,...report.runtimeWorkers].every(w=>w.closed));assert.equal(page.workers().filter(w=>/\/(?:model-worker|tflite-runtime-worker)\.js(?:\?|$)/.test(w.url())).length,0);}
    async function settle(label){phase=label;const indices=[];for(let i=0;i<policy.settleSamples;i++){deadline();await wait(1000);indices.push(await sample(label));}return {indices,rssBytes:median(indices.map(i=>report.samples[i].rssBytes))};}
    async function releaseURLs(label){phase=label;const active=rows=>rows.slice(report.initialURLCount).filter(u=>u.revokedAt===null).length,before=active((await audit()).rows);assert.ok(before>0);const start=Date.now();while(active((await audit()).rows)){deadline();assert.ok(Date.now()-start<=policy.urlReleaseTimeoutMs,'Natural IO download URL did not release.');await wait(200);}report.urlWindows.push({before,after:0,elapsedMs:Date.now()-start});}
    async function downloadIO(entry,input){
        const row=await intended(`cycle-${entry.cycle}-io.zip`,'Public synthetic runtime IO, full bytes checked then removed'),before=(await audit()).rows.length,waiting=page.waitForEvent('download');await page.locator('#edit-runtime-download').click();const download=await waiting;assert.equal(await download.failure(),null);await download.saveAs(row.path);await download.delete();const bytes=await readFile(row.path);await created(row,bytes.length);
        assert.equal(execFileSync('python3',['-I','-c',"import sys,zipfile\nwith zipfile.ZipFile(sys.argv[1]) as z: assert len(z.namelist())==3 and z.testzip() is None; print('CRC-OK')",row.path],{encoding:'utf8',timeout:15000,windowsHide:true}).trim(),'CRC-OK');
        const zip=Archive.open(new Uint8Array(bytes),'zip');assert.deepEqual([...zip.entries.keys()].sort(),['inputs-0.bin','manifest.json','outputs-0.bin']);const manifest=JSON.parse(new TextDecoder().decode(zip.entries.get('manifest.json').peek())),a=zip.entries.get('inputs-0.bin').peek(),b=zip.entries.get('outputs-0.bin').peek();assert.equal(manifest.modelSHA256,report.fixture.modelSHA256);assert.equal(manifest.byteOrder,'little-endian');assert.equal(manifest.validation.status,'passed');assert.equal(manifest.inputs.length,1);assert.equal(manifest.outputs.length,1);assert.equal(manifest.inputs[0].source,'bin');assert.equal(manifest.inputs[0].sourceFile,`runtime-input-${input}.bin`);assert.equal(a.length,4194304);assert.equal(b.length,4194304);assert.equal(hash(a),hash(new Float32Array(RUNTIME_MEMORY_ELEMENTS).fill(input)));assert.equal(hash(b),hash(runtimeMemoryValues(input)));
        const after=(await audit()).rows;assert.equal(after.length,before+1);assert.equal(after.at(-1).bytes,bytes.length);const value={input,modelSHA256:manifest.modelSHA256,sha256:hash(bytes),inputSHA256:hash(a),outputSHA256:hash(b),inputBytes:a.length,outputBytes:b.length,zipBytes:bytes.length,urlId:after.at(-1).id,bytesVerified:true,crcVerified:true};await remove(row);return value;
    }
    try{
        await buildEvent({event:'create_intent',task_id:`desktop-runtime-${engine}`,path:path.join(os.tmpdir(),`model-lens-runtime-rss-${engine}-<unique>`),kind:'temporary',purpose:'Exclusive generated public fixture/BIN/IO directory',producer:'test/browser/desktop-runtime-rss-flow.mjs',cleanup_condition:'Only exact registered generated files; no recursive deletion'});
        directory=path.resolve(await mkdtemp(path.join(os.tmpdir(),`model-lens-runtime-rss-${engine}-`)));report.temporary.directory=directory;
        const fixture=await runtimeMemoryFixture(),plan=runtimePlan(fixture.model,fixture.bytes.length);assert.equal(plan.eligible,true,plan.reason);const model=await write('runtime-memory.tflite',fixture.bytes,'Reproducible public ADD fixture with4MiB weights');report.fixture={modelBytes:fixture.bytes.length,modelSHA256:hash(fixture.bytes),weightBytes:4194304,inputBytes:4194304,outputBytes:4194304};
        const marker=randomBytes(16).toString('hex');browser=await browserType.launch({headless:true,env:{...process.env,MODEL_LENS_PHYSICAL_OWNER:marker}});report.browserVersion=browser.version();const root=await findOwnedBrowserRoot(await readProcessTable(),process.pid,marker);tree=new OwnedProcessTree(root);report.ownership={root,parentPid:process.pid,method:'direct Node child plus exact per-launch random environment marker'};
        context=await browser.newContext({viewport:{width:1280,height:640},acceptDownloads:true});await context.addInitScript(installDesktopRuntimeURLAudit);
        await context.route('**/*',async route=>{const request=route.request(),url=new URL(request.url());if(['blob:','data:'].includes(url.protocol)){await route.continue();return;}const allowed=request.method()==='GET'&&request.url().startsWith(base);if(report.requests.length>=2000)throw Error('Unbounded desktop runtime requests.');report.requests.push({url:request.url(),method:request.method(),allowed});if(!allowed){report.errors.push('Unexpected external/non-GET request.');await route.abort();}else await route.continue();});
        page=await context.newPage();page.on('filechooser',()=>{});page.on('pageerror',e=>report.errors.push(e.message));page.on('crash',()=>report.errors.push('Page crash.'));page.on('websocket',()=>report.errors.push('Unexpected WebSocket.'));page.on('worker',worker=>{const list=/\/model-worker\.js(?:\?|$)/.test(worker.url())?report.modelWorkers:/\/tflite-runtime-worker\.js(?:\?|$)/.test(worker.url())?report.runtimeWorkers:null;if(list){const row={url:worker.url(),closed:false};list.push(row);worker.once('close',()=>{row.closed=true;});}});read=desktopDOMReader(page);
        await page.goto(base,{waitUntil:'domcontentloaded'});clock=Date.now();await until(()=>!document.querySelector('#autosave-enabled').disabled);await page.bringToFront();assert.equal(await read(()=>document.visibilityState),'visible');report.initialURLCount=(await audit()).rows.length;clock=Date.now();report.measurementStartedAt=new Date(clock).toISOString();phase='baseline';await sample();
        timer=setInterval(()=>{if(sampling)return;sampling=true;pending=sample().catch(error=>report.errors.push('Sampler: '+error.message)).finally(()=>{sampling=false;});},policy.sampleIntervalMs);
        for(let cycle=1;cycle<=policy.cycles;cycle++){
            deadline();phase=`cycle-${cycle}-open`;await choose(model.path,'#open-model');await until(()=>document.querySelector('#model-tabs').getAttribute('aria-busy')!=='true'&&document.querySelector('#loading-card').hidden&&document.querySelector('#target').getAttribute('aria-busy')==='false'&&document.querySelector('#layer-count').textContent==='1');await page.locator('#run-mode').click();await until(()=>document.querySelector('#run-workspace').getAttribute('aria-busy')==='false'&&document.querySelectorAll('#run-interface p').length===2);
            const entry={cycle,runs:[]};report.cycles.push(entry);
            for(let j=0;j<policy.runsPerCycle;j++){
                phase=`cycle-${cycle}-run-${j+1}`;const input=(cycle-1)*3+j,bin=await write(`runtime-input-${input}.bin`,new Float32Array(RUNTIME_MEMORY_ELEMENTS).fill(input),'Generated exact float32 raw BIN for one manual invocation');await page.locator('#edit-runtime-check').click();await until(()=>document.querySelector('#edit-runtime-dialog').open);assert.equal(await read(()=>document.querySelector('#edit-runtime-download').disabled),true);await page.locator('#runtime-input-mode-0').selectOption('bin');await choose(bin.path,'#runtime-input-file-0');await page.locator('#edit-runtime-run').click();await until(()=>document.querySelector('#run-workspace').getAttribute('aria-busy')==='false'&&!!document.querySelector('#edit-runtime-result').dataset.status);assert.equal(await read(()=>document.querySelector('#edit-runtime-result').dataset.status),'passed');report.inputCleanup.push(await runtimeInputCleanupProof(read,phase));await remove(bin);
                const end=Date.now()+5000;while(report.runtimeWorkers.some(w=>!w.closed)&&Date.now()<end)await wait(30);assert.equal(report.runtimeWorkers.length,(cycle-1)*3+j+1);assert.ok(report.runtimeWorkers.every(w=>w.closed));entry.runs.push({status:'passed',input,workerClosed:true});if(j===2){phase=`cycle-${cycle}-download`;entry.io=await downloadIO(entry,input);}
            }
            phase=`cycle-${cycle}-close`;await page.locator('#close-model').click();await until(()=>document.querySelector('#model-tabs').hidden);await closed();entry.fileInputEmpty=await read(()=>document.querySelector('#model-file').files.length===0);entry.liveModelWorkers=page.workers().filter(w=>/\/model-worker\.js(?:\?|$)/.test(w.url())).length;entry.liveRuntimeWorkers=page.workers().filter(w=>/\/tflite-runtime-worker\.js(?:\?|$)/.test(w.url())).length;entry.settled=await settle(`cycle-${cycle}-settle`);entry.closedRssBytes=entry.settled.rssBytes;
            if(cycle===policy.warmupCycles){await releaseURLs('warmup-url-release');report.warmBaseline=await settle('warmup-settle');}
        }
        await releaseURLs('final-url-release');report.final=await settle('final-settle');await closed();clearInterval(timer);await pending;report.elapsedMs=Date.now()-clock;const urls=await audit();report.urls=urls.rows.slice(report.initialURLCount);report.urlAuditOverflow=urls.overflow;report.ownedProcesses=tree.identities;if(memoryProbe)report.memoryProfile.summary=summarizeMemoryProfile(report.memoryProfile,report.samples);
    }catch(error){report.error=error.stack||String(error);throw Object.assign(error,{desktopRuntimeRSS:report});}
    finally{
        clearInterval(timer);await pending;
        try{await context?.close();await browser?.close();report.browserClosed=Boolean(browser);if(tree){report.processCleanup=await waitOwnedProcessExit(tree);report.ownedProcesses=tree.identities;}}catch(error){report.errors.push('Shutdown: '+error.message);}
        try{for(const row of report.temporary.files)await remove(row);if(directory)await rmdir(directory);}catch(error){report.errors.push('Generated-file cleanup: '+error.message);}
        const end=gitSource();report.sourceUnchanged=end.commit===source.commit&&end.tree===source.tree&&!end.dirty;report.finishedAt=new Date().toISOString();
    }
    report.evaluation=evaluateDesktopRuntimeRSS(report);if(report.evaluation.status!=='passed')throw Object.assign(Error(JSON.stringify(report.evaluation)),{desktopRuntimeRSS:report});report.status='passed';return report;
}
