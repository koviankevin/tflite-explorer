// Separate, opt-in Hosted Linux experiment. Never a release gate or app mode.
import assert from 'node:assert/strict';
import {chromium} from 'playwright';
import {readFile,writeFile,rename,mkdir,statfs} from 'node:fs/promises';
import {createHash,randomBytes} from 'node:crypto';
import {once} from 'node:events';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {gitSource,within} from '../../scripts/lib/release-artifact.mjs';
import {buildSite} from '../../scripts/build.mjs';
import {createStaticServer} from '../../scripts/serve.mjs';
import {writePhysicalFixture} from '../physical-tflite-fixture.mjs';
import {OwnedProcessTree,readProcessTable,findOwnedBrowserRoot,waitOwnedProcessExit} from './owned-processes.mjs';
import {createProcessMemoryProbe} from './process-memory-profile.mjs';
import {modelWorkerHeap} from './worker-heap.mjs';
import {installLifecycleAudit} from './lifecycle-audit.mjs';
import {RENDERER_RELEASE_PLAN as policy,createRendererProjection,summarizeRendererRelease,assertPublicRendererReport} from './renderer-release-policy.mjs';

const root=fileURLToPath(new URL('../../',import.meta.url));process.chdir(root);
const reportPath=path.resolve(process.env.RENDERER_PROBE_REPORT||'test-results/renderer-release-probe.json');
assert.ok(within(path.join(root,'build'),reportPath)||within(path.join(root,'test-results'),reportPath)||(process.platform==='linux'&&process.env.RUNNER_TEMP&&within(path.resolve(process.env.RUNNER_TEMP),reportPath)));
await mkdir(path.dirname(reportPath),{recursive:true});
const report={format:'model-lens-renderer-release-probe',version:1,purpose:'readonly-native-memory-attribution',releaseEvidenceEligible:false,forcedGC:false,status:'running',operation:'open-close',policy,cases:[],failures:[]};
const privateReport={cases:[],failures:[]},hash=text=>createHash('sha256').update(text).digest('hex'),sleep=ms=>new Promise(r=>setTimeout(r,ms));
let stage='host',server,browser,context,tree,timer,pending=Promise.resolve(),caseError,allError;
async function persist(){
    assertPublicRendererReport(report);
    await writeFile(reportPath+'.tmp',JSON.stringify(report)+'\n');await rename(reportPath+'.tmp',reportPath);
    // Private errors/identity observations are never in the upload path.
    await writeFile(reportPath+'.private.tmp',JSON.stringify(privateReport)+'\n');await rename(reportPath+'.private.tmp',reportPath+'.private.json');
}
const failure=error=>{allError??=error;report.status='failed';report.failures.push({stage,code:'unexpected',messageSHA256:hash(String(error?.message||error))});privateReport.failures.push({stage,error:error.stack||String(error)});};
await persist();
try{
    assert.equal(process.platform,'linux');assert.equal(process.env.GITHUB_ACTIONS,'true');assert.equal(process.env.GITHUB_REPOSITORY,'koviankevin/tflite-explorer');
    report.source=gitSource();assert.equal(report.source.dirty,false);report.node=process.version;
    const optional=name=>readFile(name,'utf8').then(v=>v.trim()).catch(()=>null),[limit,current,disk]=await Promise.all([optional('/sys/fs/cgroup/memory.max'),optional('/sys/fs/cgroup/memory.current'),statfs(os.tmpdir())]);
    assert.ok((limit&&limit!=='max'?Number(limit)-Number(current):os.freemem())>=4*1024**3);assert.ok(disk.bavail*disk.bsize>=8*1024**3);
    const directory=path.join(path.dirname(reportPath),'renderer-release-fixtures');await mkdir(directory);
    stage='build';const built=await buildSite({output:path.join(directory,'core')});assert.equal(built.release.source.commit,report.source.commit);
    server=createStaticServer(path.join(directory,'core'));server.listen(0,'127.0.0.1');await once(server,'listening');const base=`http://127.0.0.1:${server.address().port}/`;
    for(const plan of policy.cases){
        stage='fixture';const fixture=await writePhysicalFixture(path.join(directory,`${plan.id}.tflite`),{repeats:plan.repeats,weightBytes:plan.weightBytes});assert.equal(fixture.operators,plan.operators);assert.ok(fixture.bytes<16*1024**2);assert.equal(fixture.sha256,fixture.readbackSHA256);
        const result={id:plan.id,status:'running',fixture:{bytes:fixture.bytes,operators:fixture.operators,weightBytes:fixture.weightBytes,sha256:fixture.sha256,readbackSHA256:fixture.readbackSHA256},samples:[]},privateCase={id:plan.id,workers:[],native:[]};report.cases.push(result);privateReport.cases.push(privateCase);
        const started=Date.now(),now=()=>Date.now()-started,projection=createRendererProjection(),probe=createProcessMemoryProbe({now}),workers=[];
        let phase='baseline',sampling=false,types=new Map();caseError=null;tree=null;
        stage='launch';const marker=randomBytes(16).toString('hex');browser=await chromium.launch({headless:true,env:{...process.env,MODEL_LENS_PHYSICAL_OWNER:marker}});report.chromium=browser.version();
        tree=new OwnedProcessTree(await findOwnedBrowserRoot(await readProcessTable(),process.pid,marker));
        try{
            context=await browser.newContext({viewport:{width:1280,height:640},acceptDownloads:true});await context.addInitScript(installLifecycleAudit);
            await context.route('**/*',async route=>{if(route.request().method()!=='GET'||!route.request().url().startsWith(base)){caseError??=Error('Unexpected request');return route.abort();}return route.continue();});
            await context.route('**/src/model-worker.js*',async route=>{const response=await route.fetch();await route.fulfill({response,body:`(${installLifecycleAudit.toString()})(true);\n${await response.text()}`});});
            const page=await context.newPage();page.setDefaultTimeout(30000);page.on('pageerror',e=>{caseError??=e;});page.on('crash',()=>{caseError??=Error('Page crash');});
            page.on('worker',w=>{const url=w.url(),kind=/\/model-worker\.js(?:\?|$)/.test(url)?'model':/\/tflite-runtime-worker\.js(?:\?|$)/.test(url)?'runtime':/\/edit-recovery-worker\.js(?:\?|$)/.test(url)?'identity':/\/vendor\/netron\/worker\.js(?:\?|$)/.test(url)?'layout':'other',row={kind,url,createdAtMs:now(),closedAtMs:null};workers.push(row);privateCase.workers.push(row);w.once('close',()=>{row.closedAtMs=now();});});
            const browserCDP=await browser.newBrowserCDPSession(),cdp=await context.newCDPSession(page);await cdp.send('Performance.enable');await browserCDP.send('Target.setDiscoverTargets',{discover:true});
            const read=async fn=>{const v=await cdp.send('Runtime.evaluate',{expression:`(${fn.toString()})()`,returnByValue:true});assert.ok(!v.exceptionDetails);return v.result.value;};
            const until=async fn=>{const end=Date.now()+30000;while(!await read(fn)){assert.ok(Date.now()<end);if(caseError)throw caseError;await sleep(80);}};
            const refreshTypes=async()=>{const info=await browserCDP.send('SystemInfo.getProcessInfo');types=new Map(info.processInfo.map(p=>[p.id,p.type]));};
            const sample=async()=>{
                const observedPhase=phase,rows=await readProcessTable(),memory=tree.sample(rows),owned=new Set(tree.identities.map(p=>`${p.pid}:${p.startTicks}`));
                const identities=rows.filter(p=>owned.has(`${p.pid}:${p.startTicks}`)).map(({pid,startTicks})=>({pid,startTicks})),metrics=(await cdp.send('Performance.getMetrics')).metrics;
                const anchor={index:result.samples.length,phase:observedPhase,elapsedMs:now(),...memory},native=await probe.capture(identities,anchor),publicSample=projection.project(anchor,native,metrics,types);
                privateCase.native.push(native);result.samples.push(publicSample);
            };
            const take=async()=>{if(sampling)await pending;sampling=true;pending=sample().finally(()=>{sampling=false;});return pending;};
            stage='ui';await page.goto(base,{waitUntil:'domcontentloaded'});await page.locator('#welcome-open').waitFor();await refreshTypes();await take();
            timer=setInterval(()=>{if(!sampling)take().catch(e=>{caseError??=e;});},policy.sampleIntervalMs);
            phase='source';const chooser=page.waitForEvent('filechooser');await page.locator('#open-model').click();await(await chooser).setFiles(fixture.file);
            await until(()=>document.querySelector('#loading-card').hidden&&document.querySelector('#target').getAttribute('aria-busy')==='false'&&document.querySelector('#layer-count').textContent!=='—');assert.equal(await page.locator('#layer-count').textContent(),String(plan.operators));
            await page.locator('#graph-font-size').selectOption('32');await page.locator('[data-kind="layers"]').click();await page.locator('#query').fill('#0');await until(()=>document.querySelector('#results').dataset.searchQuery==='#0'&&document.querySelector('#result-count').textContent==='1 筆結果');await page.locator('.result-item').first().click();await until(()=>document.querySelector('#target').getAttribute('aria-busy')==='false'&&document.querySelectorAll('#target .node').length>0);
            phase='loaded';await refreshTypes();const heap=await modelWorkerHeap(browserCDP);result.workerHeap=Object.fromEntries(['usedSize','totalSize','embedderHeapUsedSize','backingStorageSize'].map(k=>[k,heap[k]??null]));await take();await persist();
            phase='closing';await take();const worker=page.workers().find(w=>/\/model-worker\.js(?:\?|$)/.test(w.url()));assert.ok(worker);let deadline;
            try{const close=Promise.race([once(worker,'close'),new Promise((_,reject)=>{deadline=setTimeout(()=>reject(Error('Model Worker close timeout')),5000);})]);await page.locator('#close-model').click();await close;}finally{clearTimeout(deadline);}
            result.closedAtMs=workers.find(w=>w.kind==='model').closedAtMs;assert.ok(Number.isSafeInteger(result.closedAtMs));await until(()=>document.querySelector('#model-file').files.length===0&&document.querySelector('#close-model').hidden);assert.equal(page.workers().filter(w=>/\/model-worker\.js(?:\?|$)/.test(w.url())).length,0);
            assert.equal((await browserCDP.send('Target.getTargets')).targetInfos.filter(t=>t.type==='worker'&&/\/model-worker\.js(?:\?|$)/.test(t.url)).length,0);
            phase='closed';await refreshTypes();stage='observe';await take();const end=now()+policy.observeAfterCloseMs;
            while(now()<end){if(caseError)throw caseError;await sleep(100);}
            clearInterval(timer);timer=null;await pending;await take();if(caseError)throw caseError;
            const audit=await read(()=>globalThis.__lifecycle);privateCase.audit=audit;assert.equal(audit.urls.length,0);assert.equal(audit.workers.filter(w=>/\/model-worker\.js(?:\?|$)/.test(w.url)).length,1);assert.ok(audit.workers.filter(w=>/\/model-worker\.js(?:\?|$)/.test(w.url)).every(w=>w.terminated&&w.audit?.bytes>0&&w.audit.maxRead<=1024**2&&w.audit.bytes<=16*1024**2&&w.audit.violations.length===0));assert.ok(audit.audit.maxRead<=1024**2&&audit.audit.bytes<=16*1024**2&&audit.audit.violations.length===0);
            result.summary=summarizeRendererRelease(result.samples,result.closedAtMs);assert.ok(result.summary.postCloseDurationMs>=policy.observeAfterCloseMs);result.labelCount=projection.labelCount;result.status='complete';
        }finally{
            stage='cleanup';clearInterval(timer);timer=null;await pending.catch(e=>{caseError??=e;});
            if(context){await context.close();context=null;}let deadline;
            try{await Promise.race([browser.close(),new Promise((_,reject)=>{deadline=setTimeout(()=>reject(Error('Browser close timeout')),10000);})]);}finally{clearTimeout(deadline);}
            const cleanup=await waitOwnedProcessExit(tree);privateCase.cleanup=cleanup;result.allReaped=cleanup.allReaped;result.observedIdentityCount=cleanup.identities.length;assert.equal(result.allReaped,true);browser=null;
            result.workerCounts=Object.fromEntries(['model','layout','identity','runtime','other'].map(k=>[k,workers.filter(w=>w.kind===k).length]));result.workerCounts.allClosed=workers.every(w=>w.closedAtMs!==null);assert.equal(result.workerCounts.model,1);assert.equal(result.workerCounts.runtime,0);assert.equal(result.workerCounts.identity,0);assert.equal(result.workerCounts.other,0);assert.equal(result.workerCounts.allClosed,true);if(caseError)throw caseError;
            await persist();
        }
    }
    stage='finish';assert.equal(report.cases.length,policy.cases.length);assert.deepEqual(gitSource(),report.source);report.sourceUnchanged=true;report.status='complete';
}catch(error){failure(error);}
finally{
    clearInterval(timer);await pending.catch(()=>{});
    if(browser)try{let deadline;try{await Promise.race([browser.close(),new Promise((_,reject)=>{deadline=setTimeout(()=>reject(Error('Browser close timeout')),10000);})]);}finally{clearTimeout(deadline);}}catch(error){stage='cleanup';failure(error);}
    if(server){server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
    await persist();console.log(JSON.stringify({status:report.status,cases:report.cases.map(c=>({id:c.id,status:c.status,delayedReleaseStepObserved:c.summary?.delayedReleaseStepObserved??null})),releaseEvidenceEligible:false}));process.exit(allError?1:0);
}
