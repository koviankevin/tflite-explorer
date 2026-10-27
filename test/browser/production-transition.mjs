// Real public-site upgrade → rollback → restore. No deployment writes or models
// from a user: only the pinned public demo and one ephemeral CI browser context.
import assert from 'node:assert/strict';
import {chromium} from 'playwright';
import {readFile,writeFile,rename} from 'node:fs/promises';
import {once} from 'node:events';
import path from 'node:path';
import {gitSource,sha256} from '../../scripts/lib/release-artifact.mjs';
import {SITE_BASELINE,BASELINE_MANIFEST_SHA256} from '../../scripts/lib/release-baseline.mjs';
import {readStaticFile} from '../../scripts/lib/live-site.mjs';
import {parseLiveSite,PUBLIC_SITE} from '../../scripts/lib/site-history.mjs';
import {reusablePattern,exportPatterns,parsePatternFile} from '../../src/pattern-library.js';
assert.equal(process.env.GITHUB_ACTIONS,'true');assert.equal(process.platform,'linux');assert.equal(process.env.GITHUB_REPOSITORY,'koviankevin/tflite-explorer');assert.equal(process.env.GITHUB_REF,'refs/heads/main');assert.equal(process.env.GITHUB_WORKFLOW,'Production version transition');
const target=process.env.EXPECTED_BUILD,expectedSite=process.env.EXPECTED_SITE_ID;assert.match(target||'',/^[a-f0-9]{16}$/);assert.notEqual(target,SITE_BASELINE.build);assert.match(expectedSite||'',/^[a-f0-9]{64}$/);
const directory=path.join(process.env.RUNNER_TEMP,'production-transition'),base=PUBLIC_SITE,deadline=Date.now()+25*60*1000,sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const identity={source:process.env.GITHUB_SHA,runId:process.env.GITHUB_RUN_ID,attempt:process.env.GITHUB_RUN_ATTEMPT};
const report={format:'model-lens-production-transition',version:1,status:'failed',startedAt:new Date().toISOString(),source:gitSource(),expectedBuild:target,expectedSiteId:expectedSite,checks:[],reached:[],errors:[],workers:[],requests:[],observations:[]};
let browser,context,lastPage,cancelled=false,phase='initial',lastObservation='';const observers=new WeakMap();
process.on('SIGTERM',()=>{cancelled=true;context?.close().catch(()=>{});});
async function state(name,status='running',error){phase=name;if(!report.reached.includes(name)&&name!=='failed')report.reached.push(name);await writeFile(path.join(directory,'state.next'),JSON.stringify({...identity,phase:name,status,reached:report.reached,expectedBuild:target,expectedSiteId:expectedSite,error:error?.slice(0,1000)})+'\n');await rename(path.join(directory,'state.next'),path.join(directory,'state.json'));}
const check=name=>{report.checks.push(name);console.log('PASS '+name);};
async function read(page,fn){const result=await observers.get(page).send('Runtime.evaluate',{expression:`(${fn.toString()})()`,returnByValue:true});if(result.exceptionDetails)throw Error('Read-only DOM observation failed.');return result.result.value;}
async function waitFor(page,fn){const until=Date.now()+30000;while(!await read(page,fn)){if(cancelled||Date.now()>until)throw Error('DOM wait stopped: '+fn);await sleep(100);}}
async function choose(page,file,button='#open-model'){const event=page.waitForEvent('filechooser');await page.locator(button).click();await(await event).setFiles(file);}
async function ready(page,layers){await waitFor(page,()=>document.querySelector('#loading-card').hidden&&document.querySelector('#target').getAttribute('aria-busy')==='false'&&document.querySelector('#layer-count').textContent!=='—');assert.equal(await page.locator('#layer-count').textContent(),String(layers));}
async function closeModel(page){const worker=page.workers().find(w=>/\/model-worker\.js(?:\?|$)/.test(w.url()));assert.ok(worker);let timer;try{const closed=Promise.race([once(worker,'close'),new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('Model worker did not close.')),5000);})]);await page.locator('#close-model').click();await closed;}finally{clearTimeout(timer);}assert.equal(await read(page,()=>document.querySelector('#model-file').files.length),0);}
async function version(page,id){await page.locator('#release-info-button').click();await page.getByText(id,{exact:true}).waitFor();await page.locator('#close-release-info').click();}
async function waitSite(build,siteId){
    while(Date.now()<deadline&&!cancelled){
        try{
            const response=await readStaticFile(base,'site-manifest.json',{allow404:true}),site=response?parseLiveSite(response.bytes):null,key=site?.siteId||'legacy-404';
            if(key!==lastObservation){report.observations.push({phase,at:new Date().toISOString(),siteId:site?.siteId??null,build:site?.current.release.buildId??SITE_BASELINE.build});lastObservation=key;}
            if(site?.current.release.buildId===build&&(!siteId||site.siteId===siteId)){
                const index=site.files.find(f=>f.path==='index.html'),entry=await readStaticFile(base,'',{maxBytes:index.bytes});if(sha256(entry.bytes)===index.sha256)return site;
            }
        }catch(error){const key='error:'+error.message;if(key!==lastObservation&&report.observations.length<100){report.observations.push({phase,error:error.message});lastObservation=key;}}
        await sleep(5000);
    }
    throw Error('Public site transition did not arrive before deadline.');
}
async function newPage(label,prefix,build){
    const page=await context.newPage();lastPage=page;page.setDefaultTimeout(30000);observers.set(page,await context.newCDPSession(page));
    page.on('pageerror',error=>report.errors.push(label+': '+error.message));page.on('crash',()=>report.errors.push(label+': crash'));page.on('websocket',()=>report.errors.push('Unexpected WebSocket.'));
    page.on('request',request=>{if(report.requests.length>=2500){report.errors.push('Request limit exceeded.');return;}report.requests.push({page:label,phase,url:request.url().replace(base,'./'),method:request.method()});});
    page.on('worker',worker=>{const item={page:label,phase,url:worker.url().replace(base,'./'),closed:false};report.workers.push(item);worker.on('close',()=>{item.closed=true;});if(/\/model-worker\.js(?:\?|$)/.test(worker.url())&&worker.url()!==base+prefix+`src/model-worker.js?v=${build}`)report.errors.push(label+': wrong model worker namespace.');});
    await page.goto(base,{waitUntil:'domcontentloaded'});assert.equal(await read(page,()=>document.baseURI),base+prefix);await waitFor(page,()=>typeof document.querySelector('#open-model').onclick==='function');await page.locator('#autosave-enabled').uncheck();await version(page,build);return page;
}
try{
    assert.equal(report.source.dirty,false);assert.equal(report.source.commit,process.env.GITHUB_SHA);
    assert.equal(await readStaticFile(base,'site-manifest.json',{allow404:true}),null,'Start before the first versioned deployment.');
    const original=await readStaticFile(base,'release-manifest.json');assert.equal(sha256(original.bytes),BASELINE_MANIFEST_SHA256);const oldManifest=JSON.parse(original.bytes);assert.equal(oldManifest.release.buildId,SITE_BASELINE.build);
    for(const name of ['demo.tflite','demo.mlir']){const entry=oldManifest.files.find(f=>f.path===name);assert.ok(entry.bytes<1024**2);const response=await readStaticFile(base,name,{maxBytes:entry.bytes});assert.equal(sha256(response.bytes),entry.sha256);await writeFile(path.join(directory,name),response.bytes,{flag:'wx'});}
    const pattern=reusablePattern('Production transition saved RTR',{nodes:[{alias:'N1',type:'Reshape'},{alias:'N2',type:'Transpose'},{alias:'N3',type:'Reshape'}],edges:[{from:'N1',to:'N2'},{from:'N2',to:'N3'}],induced:true}),patternFile=path.join(directory,'saved-pattern.json');await writeFile(patternFile,exportPatterns([pattern]),{flag:'wx'});
    browser=await chromium.launch({headless:true});report.chromium=browser.version();context=await browser.newContext({viewport:{width:1366,height:768},acceptDownloads:true});
    await context.route('**/*',async route=>{const request=route.request(),url=new URL(request.url());if(['blob:','data:'].includes(url.protocol)){await route.continue();return;}if(request.method()!=='GET'||!request.url().startsWith(base)){report.errors.push('Unexpected external/non-GET request.');await route.abort();}else await route.continue();});
    const oldPage=await newPage('original-root','',''+SITE_BASELINE.build);await choose(oldPage,path.join(directory,'demo.tflite'));await ready(oldPage,26);await oldPage.locator('[data-kind="patterns"]').click();await oldPage.locator('#open-import').click();await choose(oldPage,patternFile,'#choose-pattern-file');await oldPage.locator('#confirm-import').click();await waitFor(oldPage,()=>!document.querySelector('#import-dialog').open);await oldPage.locator('#saved-pattern').selectOption(pattern.name);await waitFor(oldPage,()=>document.querySelector('#result-count').textContent==='4 筆匹配路徑');await closeModel(oldPage);check('original root tab, native TFLite and saved IndexedDB pattern before real deployment');await state('initial-ready');
    const upgraded=await waitSite(target,expectedSite);report.upgrade={siteId:upgraded.siteId,release:upgraded.current.release,retainedBuildIds:upgraded.retainedBuildIds};
    await choose(oldPage,path.join(directory,'demo.mlir'));await ready(oldPage,5);await oldPage.locator('[data-kind="layers"]').click();await oldPage.locator('#query').fill('acme.split');await waitFor(oldPage,()=>document.querySelector('#result-count').textContent==='1 筆結果');await version(oldPage,SITE_BASELINE.build);await closeModel(oldPage);assert.ok(report.requests.some(r=>r.page==='original-root'&&r.phase==='initial-ready'&&r.url.includes('./vendor/netron/mlir.js')));check('already-open original root lazily loads custom MLIR after real upgrade and retains its version');
    const next=await newPage('candidate',`versions/${target}/`,target);await choose(next,path.join(directory,'demo.mlir'));await ready(next,5);await waitFor(next,()=>[...document.querySelector('#saved-pattern').options].some(o=>o.textContent==='Production transition saved RTR'));await closeModel(next);check('new versioned root sees original saved pattern after real upgrade');await state('candidate-ready');
    const rollback=await waitSite(SITE_BASELINE.build);assert.ok(rollback.versions.some(v=>v.release.buildId===target));report.rollback={siteId:rollback.siteId,release:rollback.current.release,retainedBuildIds:rollback.retainedBuildIds};
    await choose(next,path.join(directory,'demo.tflite'));await ready(next,26);await version(next,target);await next.locator('#graph-font-size').selectOption('32');await next.locator('[data-kind="patterns"]').click();await next.locator('#saved-pattern').selectOption(pattern.name);await waitFor(next,()=>document.querySelector('#result-count').textContent==='4 筆匹配路徑');assert.ok(report.requests.some(r=>r.page==='candidate'&&r.phase==='candidate-ready'&&r.url.includes(`/versions/${target}/vendor/netron/tflite.js`)));check('already-open candidate lazily loads TFLite after real rollback with 32px and four original matches');
    await next.locator('.result-item').first().click();await waitFor(next,()=>document.querySelector('#target').getAttribute('aria-busy')==='false');let event=next.waitForEvent('download');await next.locator('#export-match').click();let download=await event;assert.equal(await download.failure(),null);const child=path.join(directory,'child.tflite');await download.saveAs(child);await download.delete();await closeModel(next);await choose(next,child);await ready(next,3);await waitFor(next,()=>document.querySelector('#result-count').textContent==='1 筆匹配路徑');await closeModel(next);
    event=next.waitForEvent('download');await next.locator('#export-pattern').click();download=await event;assert.equal(await download.failure(),null);const exported=path.join(directory,'exported-pattern.json');await download.saveAs(exported);await download.delete();assert.deepEqual(parsePatternFile(await readFile(exported,'utf8')),[pattern]);check('native child export/reopen and original pattern JSON remain valid after real rollback');await state('rollback-verified');
    const restored=await waitSite(target,expectedSite);report.restore={siteId:restored.siteId,release:restored.current.release,retainedBuildIds:restored.retainedBuildIds};const fresh=await newPage('restored',`versions/${target}/`,target);await choose(fresh,path.join(directory,'demo.tflite'));await ready(fresh,26);await fresh.locator('[data-kind="patterns"]').click();await fresh.locator('#saved-pattern').selectOption(pattern.name);await waitFor(fresh,()=>document.querySelector('#result-count').textContent==='4 筆匹配路徑');await closeModel(fresh);await version(next,target);check('restored public default and existing candidate retain version and saved pattern');
    const end=gitSource();report.sourceUnchanged=!end.dirty&&end.commit===report.source.commit&&end.tree===report.source.tree;assert.equal(report.sourceUnchanged,true);assert.deepEqual(report.errors,[]);report.status='passed';
}catch(error){report.error=error.stack||String(error);report.status='failed';if(lastPage)await lastPage.screenshot({path:path.join(directory,'failure.png')}).catch(()=>{});}
finally{
    try{await context?.close();if(browser){await browser.close();report.browserClosed=true;}assert.ok(report.workers.every(w=>w.closed));if(report.status==='passed')assert.equal(report.workers.filter(w=>/\/model-worker\.js(?:\?|$)/.test(w.url)).length,6);}catch(error){report.status='failed';report.errors.push(error.message);}
    if(cancelled){report.status='failed';report.error='Observer cancelled before completion.';}report.finishedAt=new Date().toISOString();report.phase=report.status==='passed'?'complete':'failed';if(report.status==='passed')report.reached.push('complete');await writeFile(path.join(directory,'report.json'),JSON.stringify(report,null,2)+'\n');await state(report.phase,report.status,report.error||report.errors.join('; '));console.log(JSON.stringify({status:report.status,checks:report.checks,error:report.error}));if(report.status!=='passed')process.exitCode=1;
}
