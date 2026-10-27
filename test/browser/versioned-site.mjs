// Hosted Linux acceptance only; never drive the user's desktop browser.
import assert from 'node:assert/strict';
import {chromium} from 'playwright';
import {readFile,writeFile,mkdir,mkdtemp,appendFile} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import {createServer} from 'node:http';
import {once} from 'node:events';
import path from 'node:path';
import {buildSite} from '../../scripts/build.mjs';
import {composeSite,verifySite} from '../../scripts/lib/versioned-site.mjs';
import {root,verifyArtifact,sha256,gitSource} from '../../scripts/lib/release-artifact.mjs';
import {createStaticServer} from '../../scripts/serve.mjs';
import {reusablePattern,exportPatterns,parsePatternFile} from '../../src/pattern-library.js';
import {SITE_BASELINE,evaluateSiteBrowser} from '../../scripts/lib/site-browser-policy.mjs';

assert.equal(process.env.GITHUB_ACTIONS,'true');assert.equal(process.platform,'linux');assert.equal(process.env.GITHUB_REPOSITORY,'koviankevin/tflite-explorer');
const baseline=SITE_BASELINE;
const report={format:'model-lens-versioned-browser',version:1,status:'failed',startedAt:new Date().toISOString(),source:gitSource(),baseline,checks:[],errors:[],workers:[],requests:[]};
const reportPath=path.join(process.env.RUNNER_TEMP,'versioned-site-browser.json'),sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
let browser,context,server,lastPage,phase='prepare';
const observers=new WeakMap();
const check=name=>{report.checks.push(name);console.log(`PASS ${name}`);};
async function read(page,fn){const r=await observers.get(page).send('Runtime.evaluate',{expression:`(${fn.toString()})()`,returnByValue:true});if(r.exceptionDetails)throw Error('Read-only DOM observation failed.');return r.result.value;}
async function waitFor(page,fn){const until=Date.now()+30000;while(!await read(page,fn)){if(Date.now()>until)throw Error('DOM timeout: '+fn);await sleep(100);}}
async function choose(page,file,button='#open-model'){const event=page.waitForEvent('filechooser');await page.locator(button).click();await(await event).setFiles(file);}
async function ready(page,layers){await waitFor(page,()=>document.querySelector('#loading-card').hidden&&document.querySelector('#layer-count').textContent!=='—'&&document.querySelector('#target').getAttribute('aria-busy')==='false');assert.equal(await page.locator('#layer-count').textContent(),String(layers));}
async function closeModel(page){const worker=page.workers().find(w=>/\/model-worker\.js(?:\?|$)/.test(w.url()));assert.ok(worker);let timer;try{const closed=Promise.race([once(worker,'close'),new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('Model Worker did not terminate.')),5000);})]);await page.locator('#close-model').click();await closed;}finally{clearTimeout(timer);}assert.equal(await read(page,()=>document.querySelector('#model-file').files.length),0);}
async function version(page,id){await page.locator('#release-info-button').click();await page.getByText(id,{exact:true}).waitFor();await page.locator('#close-release-info').click();}

try{
    assert.equal(report.source.dirty,false);assert.equal(report.source.commit,process.env.GITHUB_SHA);
    await mkdir(path.join(root,'test-results'),{recursive:true});const temporary=await mkdtemp(path.join(root,'test-results','versioned-browser-')),previous=path.join(temporary,'previous'),candidate=path.join(temporary,'candidate');
    const gh=(...args)=>execFileSync('gh',args,{encoding:'utf8',windowsHide:true,timeout:90000,maxBuffer:1024**2});
    const repository='repos/koviankevin/tflite-explorer/',release=JSON.parse(gh('api',repository+'releases/tags/v'+baseline.version)),zipName=`model-lens-public-${baseline.version}-${baseline.build}.zip`;
    assert.equal(release.draft,false);const asset=release.assets.find(a=>a.name===zipName);assert.equal(asset.size,baseline.bytes);assert.equal(asset.digest,'sha256:'+baseline.sha256);assert.equal(JSON.parse(gh('api',repository+'git/ref/tags/v'+baseline.version)).object.sha,baseline.source);
    gh('release','download','v'+baseline.version,'--repo','koviankevin/tflite-explorer','--pattern',zipName,'--dir',temporary);const zip=path.join(temporary,zipName);assert.equal(sha256(await readFile(zip)),baseline.sha256);
    await mkdir(previous);
    const unpack="import sys,zipfile,pathlib,stat\nz=zipfile.ZipFile(sys.argv[1]); a=z.infolist(); names=[f.filename for f in a]\nassert 0<len(a)<=1000 and len(set(n.lower() for n in names))==len(names) and sum(f.file_size for f in a)<=512*1024*1024\nfor f in a:\n p=pathlib.PurePosixPath(f.filename); assert not p.is_absolute() and '..' not in p.parts and '\\\\' not in f.filename and ':' not in f.filename and not f.is_dir() and not stat.S_ISLNK(f.external_attr>>16)\nassert z.testzip() is None\nz.extractall(sys.argv[2])";
    execFileSync('python3',['-I','-c',unpack,zip,previous],{windowsHide:true,timeout:30000});
    const old=await verifyArtifact(previous,{publicOnly:true,requireClean:true});assert.equal(old.release.buildId,baseline.build);assert.equal(old.release.source.commit,baseline.source);
    const built=await buildSite({output:candidate});assert.notEqual(built.release.buildId,baseline.build);report.candidate=built.release;
    const versionedOld=await composeSite({currentDirectory:previous,legacyDirectory:previous,outputDirectory:path.join(temporary,'versioned-old')});
    const upgraded=await composeSite({currentDirectory:candidate,legacyDirectory:previous,retainedDirectories:[previous],outputDirectory:path.join(temporary,'upgraded')});
    const rollback=await composeSite({currentDirectory:previous,legacyDirectory:previous,retainedDirectories:[candidate],outputDirectory:path.join(temporary,'rollback')});
    report.snapshots=[versionedOld,upgraded,rollback].map(s=>({siteId:s.manifest.siteId,currentBuild:s.manifest.current.release.buildId,files:s.manifest.files.length,versions:s.manifest.versions.map(v=>v.release.buildId)}));
    const handlers=new Map([previous,versionedOld.directory,upgraded.directory,rollback.directory].map(directory=>[directory,createStaticServer(directory)]));let active=previous;
    const mount='/tflite-explorer/';server=createServer((req,res)=>{if(!req.url.startsWith(mount)){res.writeHead(404);res.end();return;}req.url='/'+req.url.slice(mount.length);handlers.get(active).emit('request',req,res);});server.listen(0,'127.0.0.1');await once(server,'listening');const base=`http://127.0.0.1:${server.address().port}${mount}`;
    browser=await chromium.launch({headless:true});report.chromium=browser.version();context=await browser.newContext({viewport:{width:1366,height:768},acceptDownloads:true});
    await context.route('**/*',async route=>{const request=route.request(),url=new URL(request.url());if(['blob:','data:'].includes(url.protocol)){await route.continue();return;}if(request.method()!=='GET'||!request.url().startsWith(base)){report.errors.push('Unexpected external/non-GET request.');await route.abort();}else await route.continue();});
    async function newPage(label,assetBase){
        const page=await context.newPage();lastPage=page;page.setDefaultTimeout(30000);observers.set(page,await context.newCDPSession(page));
        page.on('pageerror',e=>report.errors.push(`${label}: ${e.message}`));page.on('crash',()=>report.errors.push(label+': page crash'));page.on('websocket',()=>report.errors.push('Unexpected WebSocket.'));
        page.on('request',r=>{if(report.requests.length<2000)report.requests.push({page:label,phase,url:r.url().replace(base,'./'),method:r.method()});else report.errors.push('Request limit exceeded.');});
        page.on('worker',worker=>{const item={page:label,phase,url:worker.url().replace(base,'./'),closed:false};report.workers.push(item);worker.once('close',()=>{item.closed=true;});if(worker.url().includes('/model-worker.js')&&!worker.url().startsWith(base+assetBase+'src/model-worker.js'))report.errors.push(label+': model Worker used another version path.');});
        await page.goto(base,{waitUntil:'domcontentloaded'});await waitFor(page,()=>typeof document.querySelector('#open-model').onclick==='function');await page.locator('#autosave-enabled').uncheck();assert.equal(await read(page,()=>document.baseURI),base+assetBase);return page;
    }
    const pattern=reusablePattern('Version-switch saved RTR',{nodes:[{alias:'N1',type:'Reshape'},{alias:'N2',type:'Transpose'},{alias:'N3',type:'Reshape'}],edges:[{from:'N1',to:'N2'},{from:'N2',to:'N3'}],induced:true}),patternFile=path.join(temporary,'saved-pattern.json');await writeFile(patternFile,exportPatterns([pattern]));
    phase='legacy-root';const legacyPage=await newPage('legacy','');await choose(legacyPage,path.join(previous,'demo.tflite'));await ready(legacyPage,26);await version(legacyPage,baseline.build);
    await legacyPage.locator('[data-kind="patterns"]').click();await legacyPage.locator('#open-import').click();await choose(legacyPage,patternFile,'#choose-pattern-file');await legacyPage.locator('#confirm-import').click();await waitFor(legacyPage,()=>!document.querySelector('#import-dialog').open);await legacyPage.locator('#saved-pattern').selectOption(pattern.name);await waitFor(legacyPage,()=>document.querySelector('#result-count').textContent==='4 筆匹配路徑');await closeModel(legacyPage);check('original legacy tab, native TFLite and persisted pattern before switching');
    active=versionedOld.directory;phase='namespaced-old';const oldPage=await newPage('old-namespace',`versions/${baseline.build}/`);await version(oldPage,baseline.build);
    active=upgraded.directory;phase='upgrade';await verifySite(active);
    for(const page of [legacyPage,oldPage]){lastPage=page;await choose(page,path.join(previous,'demo.mlir'));await ready(page,5);await page.locator('[data-kind="layers"]').click();await page.locator('#query').fill('acme.split');await waitFor(page,()=>document.querySelector('#result-count').textContent==='1 筆結果');await version(page,baseline.build);await closeModel(page);}
    assert.ok(report.requests.some(r=>r.page==='legacy'&&r.phase==='upgrade'&&r.url.includes('/mlir.js')));assert.ok(report.requests.some(r=>r.page==='old-namespace'&&r.phase==='upgrade'&&r.url.startsWith(`./versions/${baseline.build}/`)&&r.url.includes('/mlir.js')));check('legacy and namespaced old tabs lazily load custom MLIR after upgrade with their original version');
    const candidatePage=await newPage('candidate',`versions/${built.release.buildId}/`);await choose(candidatePage,path.join(previous,'demo.mlir'));await ready(candidatePage,5);await version(candidatePage,built.release.buildId);
    await waitFor(candidatePage,()=>[...document.querySelector('#saved-pattern').options].some(o=>o.textContent==='Version-switch saved RTR'));await closeModel(candidatePage);check('new root selects the candidate namespace and sees the original IndexedDB pattern');
    active=rollback.directory;phase='rollback';await verifySite(active);lastPage=candidatePage;
    await choose(candidatePage,path.join(previous,'demo.tflite'));await ready(candidatePage,26);await version(candidatePage,built.release.buildId);await candidatePage.locator('#graph-font-size').selectOption('32');await candidatePage.locator('[data-kind="patterns"]').click();await candidatePage.locator('#saved-pattern').selectOption(pattern.name);await waitFor(candidatePage,()=>document.querySelector('#result-count').textContent==='4 筆匹配路徑');
    assert.ok(report.requests.some(r=>r.page==='candidate'&&r.phase==='rollback'&&r.url.startsWith(`./versions/${built.release.buildId}/`)&&r.url.includes('/tflite.js')));check('already-open candidate lazily loads TFLite after rollback and retains its version and saved pattern');
    await candidatePage.locator('.result-item').first().click();await waitFor(candidatePage,()=>document.querySelector('#target').getAttribute('aria-busy')==='false');let event=candidatePage.waitForEvent('download');await candidatePage.locator('#export-match').click();let download=await event;assert.equal(await download.failure(),null);const child=path.join(temporary,'child.tflite');await download.saveAs(child);await download.delete();
    await closeModel(candidatePage);await choose(candidatePage,child);await ready(candidatePage,3);await waitFor(candidatePage,()=>document.querySelector('#result-count').textContent==='1 筆匹配路徑');await closeModel(candidatePage);
    event=candidatePage.waitForEvent('download');await candidatePage.locator('#export-pattern').click();download=await event;const patternOut=path.join(temporary,'pattern-export.json');await download.saveAs(patternOut);await download.delete();assert.deepEqual(parsePatternFile(await readFile(patternOut,'utf8')),[pattern]);check('32px pattern search, native submodel download/reopen and original pattern export after rollback');
    const rolledBack=await newPage('rolled-back',`versions/${baseline.build}/`);await version(rolledBack,baseline.build);await choose(rolledBack,path.join(previous,'demo.tflite'));await ready(rolledBack,26);await rolledBack.locator('[data-kind="patterns"]').click();await rolledBack.locator('#saved-pattern').selectOption(pattern.name);await waitFor(rolledBack,()=>document.querySelector('#result-count').textContent==='4 筆匹配路徑');await closeModel(rolledBack);check('fresh root after rollback opens the old version with its original persisted pattern');
    const end=gitSource();assert.equal(end.commit,report.source.commit);assert.equal(end.tree,report.source.tree);assert.equal(end.dirty,false);report.sourceUnchanged=true;assert.deepEqual(report.errors,[]);report.status='passed';
    await appendFile(process.env.GITHUB_OUTPUT,`snapshot_directory=${upgraded.directory}\nsnapshot_build_id=${built.release.buildId}\nsnapshot_site_id=${upgraded.manifest.siteId}\n`);
}catch(error){report.error=error.stack||String(error);process.exitCode=1;if(lastPage)await lastPage.screenshot({path:path.join(process.env.RUNNER_TEMP,'versioned-site-browser.png')}).catch(()=>{});}
finally{
    try{await context?.close();if(browser){let timer;try{await Promise.race([browser.close(),new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('Browser close timeout.')),10000);})]);report.browserClosed=true;}finally{clearTimeout(timer);}}if(report.workers.some(w=>!w.closed))throw Error('Retained Worker after browser shutdown.');}catch(error){report.status='failed';report.errors.push(error.message);process.exitCode=1;}
    if(server){server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}report.phase=phase;report.finishedAt=new Date().toISOString();
    report.evaluation=evaluateSiteBrowser(report);if(report.evaluation.status!=='passed'){report.status='failed';process.exitCode=1;}
    await writeFile(reportPath,JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify({status:report.status,phase,checks:report.checks,error:report.error,issues:report.evaluation.issues}));
}
