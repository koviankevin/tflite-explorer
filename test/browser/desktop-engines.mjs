// The browser runs only on the hosted Linux runner. Gestures, chooser and
// download events use Playwright's browser protocol; evaluation only reads DOM.
import assert from 'node:assert/strict';
import {firefox,webkit,selectors} from 'playwright';
import {readFile,writeFile,mkdtemp,copyFile} from 'node:fs/promises';
import path from 'node:path';
import {once} from 'node:events';
import {desktopEngineSettings} from '../../scripts/lib/desktop-engine-policy.mjs';
import {gitSource,sha256} from '../../scripts/lib/release-artifact.mjs';
import {resolveLiveCore,readStaticFile,verifyRemoteSnapshot} from '../../scripts/lib/live-site.mjs';
import {reusablePattern,exportPatterns,parsePatternFile} from '../../src/pattern-library.js';
import {editWorkspaceFlow} from './edit-workspace-flow.mjs';
import {portableEditFlow} from './portable-edit-flow.mjs';
import {tfliteControlEditFlow} from './tflite-control-edit-flow.mjs';
import {mlirKeyboardFlow} from './mlir-keyboard-flow.mjs';
import {registerDOMReader,desktopDOMReader} from './desktop-dom-reader.mjs';

const {engine,base,expectedBuild,expectedSiteId}=desktopEngineSettings(process.env,process.platform);
const report={format:'model-lens-desktop-engine',version:1,status:'failed',startedAt:new Date().toISOString(),engine,source:gitSource(),expectedBuild,expectedSiteId,checks:[],errors:[],workers:[],requests:[],browserClosed:false};
const reportPath=path.join(process.env.RUNNER_TEMP,`desktop-${engine}.json`),imagePath=path.join(process.env.RUNNER_TEMP,`desktop-${engine}.png`);
let browser,context,page,readDOM;
const check=name=>{report.checks.push(name);console.log(`PASS ${engine}: ${name}`);};
try{
    assert.equal(report.source.dirty,false,'Compatibility driver source must be committed.');
    const resolved=await resolveLiveCore({base,expectedBuild,expectedSiteId}),{manifest,coreBasePath}=resolved;
    report.release=manifest.release;report.coreBasePath=coreBasePath;
    const raw=(await readStaticFile(base,'site-manifest.json')).bytes;
    const verified=await verifyRemoteSnapshot({base,raw,siteId:expectedSiteId,siteManifestSHA256:sha256(raw),coreManifestSHA256:resolved.manifestSHA256,coreManifest:manifest});
    report.staticVerification={siteId:verified.site.siteId,manifestSHA256:sha256(raw),coreManifestSHA256:resolved.manifestSHA256,rootEntrySHA256:verified.rootEntrySHA256,files:verified.checks.length};
    const directory=await mkdtemp(path.join(process.env.RUNNER_TEMP,`desktop-${engine}-`)),demoEntry=manifest.files.find(f=>f.path==='demo.tflite');assert.ok(demoEntry&&demoEntry.bytes<1024**2);
    const demoBytes=(await readStaticFile(base,coreBasePath+demoEntry.path,{maxBytes:demoEntry.bytes})).bytes;assert.equal(sha256(demoBytes),demoEntry.sha256);
    const demo=path.join(directory,'demo.tflite');await writeFile(demo,demoBytes,{flag:'wx'});
    const pattern=reusablePattern('Desktop engine RTR',{nodes:[{alias:'N1',type:'Reshape'},{alias:'N2',type:'Transpose'},{alias:'N3',type:'Reshape'}],edges:[{from:'N1',to:'N2'},{from:'N2',to:'N3'}],induced:true}),patternFile=path.join(directory,'patterns.json');await writeFile(patternFile,exportPatterns([pattern]),{flag:'wx'});
    await registerDOMReader(selectors);
    browser=await ({firefox,webkit}[engine]).launch({headless:true});report.browserVersion=browser.version();
    context=await browser.newContext({viewport:{width:1366,height:640},acceptDownloads:true});
    await context.route('**/*',async route=>{const r=route.request(),u=new URL(r.url());if(['blob:','data:'].includes(u.protocol)){await route.continue();return;}const allowed=r.method()==='GET'&&r.url().startsWith(base);report.requests.push({method:r.method(),url:r.url(),allowed});if(!allowed){report.errors.push('Unexpected external/non-GET request.');await route.abort();}else await route.continue();});
    // A separate blank document proves that the pinned engine can expose a
    // native chooser before attributing any production failure to the app.
    const probe=await context.newPage();probe.on('filechooser',()=>{});
    try{
        await probe.setContent('<input id="probe-file" type="file" hidden><button id="probe-open" onclick="document.getElementById(\'probe-file\').click()">Choose</button>');
        const chosen=probe.waitForEvent('filechooser');await probe.locator('#probe-open').click();await(await chosen).setFiles(demo);assert.match(await probe.locator('#probe-file').inputValue(),/demo\.tflite$/);report.nativeChooserProbe='passed';
    }finally{await probe.close();}
    // Temporary [DEBUG-desktop-native] listeners only observe click routing.
    // They never prevent defaults, alter handlers or touch the model API.
    await context.addInitScript(()=>{for(const capture of [true,false])document.addEventListener('click',event=>{if(!['open-model','welcome-open','model-file'].includes(event.target?.id))return;console.info('[DEBUG-desktop-native]'+JSON.stringify({target:event.target.id,capture,trusted:event.isTrusted,detail:event.detail,prevented:event.defaultPrevented,activation:navigator.userActivation?.isActive??null}));},capture);});
    page=await context.newPage();page.setDefaultTimeout(30000);
    report.nativeClicks=[];page.on('console',message=>{const text=message.text();if(text.startsWith('[DEBUG-desktop-native]')&&report.nativeClicks.length<30)report.nativeClicks.push(JSON.parse(text.slice('[DEBUG-desktop-native]'.length)));});
    // Interception is enabled over an asynchronous browser protocol message.
    // Keep a listener before navigation, so the first real chooser cannot race
    // the waitForEvent() subscription immediately preceding a fast click.
    report.chooserEvents=0;page.on('filechooser',()=>{report.chooserEvents++;});
    page.on('pageerror',e=>report.errors.push(e.message));page.on('crash',()=>report.errors.push('Page crash.'));page.on('websocket',()=>report.errors.push('Unexpected WebSocket.'));
    page.on('worker',worker=>{const item={url:worker.url(),closed:false};report.workers.push(item);worker.on('close',()=>{item.closed=true;});if(/\/model-worker\.js(?:\?|$)/.test(item.url)&&item.url!==new URL(coreBasePath+`src/model-worker.js?v=${expectedBuild}`,base).href)report.errors.push('Worker belongs to another build namespace.');});
    // Each observation is a fixed, source-controlled DOM expression. Never
    // evaluate app APIs, mutate selection or generate a file inside the page.
    const read=readDOM=desktopDOMReader(page);
    const until=async(fn,...args)=>{const end=Date.now()+30000;while(!await read(fn,...args)){if(Date.now()>end)throw Error('Desktop DOM timeout: '+fn);await new Promise(r=>setTimeout(r,75));}};
    const ready=async count=>{await until(()=>document.querySelector('#model-tabs').getAttribute('aria-busy')!=='true'&&document.querySelector('#loading-card').hidden&&document.querySelector('#target').getAttribute('aria-busy')==='false'&&document.querySelector('#layer-count').textContent!=='—');if(count!==undefined)assert.equal(await page.locator('#layer-count').textContent(),String(count));};
    const choose=async(file,selector='#open-model')=>{const event=page.waitForEvent('filechooser');await page.locator(selector).click();await(await event).setFiles(file);};
    const close=async()=>{const worker=page.workers().find(w=>/\/model-worker\.js(?:\?|$)/.test(w.url()));assert.ok(worker);let timer;try{const closed=Promise.race([once(worker,'close'),new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('Desktop model worker retained.')),5000);})]);await page.locator('#close-model').click();await closed;}finally{clearTimeout(timer);}assert.equal(await read(()=>document.querySelector('#model-file').files.length),0);};
    const download=async(selector,name)=>{const event=page.waitForEvent('download');await page.locator(selector).click();const d=await event;assert.equal(await d.failure(),null);const file=path.join(directory,name);await d.saveAs(file);await d.delete();return file;};
    await page.goto(base,{waitUntil:'domcontentloaded'});await until(()=>!document.querySelector('#autosave-enabled').disabled);
    assert.equal(new URL(await read(()=>document.baseURI)).pathname,new URL(coreBasePath,base).pathname);
    await page.locator('#open-demo').click();await ready(26);await page.locator('#graph-font-size').selectOption('32');await ready();await page.locator('#query').fill('#0');await until(()=>document.querySelector('#result-count').textContent==='1 筆結果');await page.locator('.result-item').click();await ready();assert.ok(await page.locator('#target .node').count()>0);await close();
    check('public demo: local worker, 32px graph, exact layer lookup and location');
    await choose(demo);await ready(26);await page.locator('[data-kind="patterns"]').click();await page.locator('#open-import').click();await choose(patternFile,'#choose-pattern-file');await page.locator('#confirm-import').click();await until(()=>!document.querySelector('#import-dialog').open);await page.locator('#saved-pattern').selectOption(pattern.name);await until(()=>document.querySelector('#result-count').textContent==='4 筆匹配路徑');
    const json=await download('#export-pattern','pattern-roundtrip.json');assert.deepEqual(parsePatternFile(await readFile(json,'utf8')),[pattern]);check('actual file chooser and native pattern import/export preserve the structural query');
    await page.locator('.result-item').first().click();await ready();const child=await download('#export-match','submodel.tflite');await close();await choose(child);await ready(3);await until(()=>document.querySelector('#result-count').textContent==='1 筆匹配路徑');await page.locator('.result-item').click();await ready();await close();check('TFLite submodel downloads and reopens with exactly one original pattern match');
    report.editWorkspace=await editWorkspaceFlow({page,read,base,directory,check,allowMlir:false});
    report.portableEdit=await portableEditFlow({page,read,base,directory,check,allowMlir:false});
    report.controlEdit=await tfliteControlEditFlow({page,read,base,directory,check});
    report.mlirKeyboard=await mlirKeyboardFlow({page,read,base,directory,check});
    const workers=report.workers.filter(w=>/\/model-worker\.js(?:\?|$)/.test(w.url()));report.modelWorkers=workers.length;
    assert.equal(workers.length,3+report.editWorkspace.modelWorkers+report.portableEdit.modelWorkers+report.controlEdit.modelWorkers+report.mlirKeyboard.modelWorkers);assert.ok(workers.every(w=>w.closed));assert.deepEqual(report.errors,[]);
    const after=await resolveLiveCore({base,expectedBuild,expectedSiteId});assert.equal(after.manifestSHA256,resolved.manifestSHA256);assert.equal(sha256((await readStaticFile(base,'site-manifest.json')).bytes),sha256(raw));
    const end=gitSource();report.sourceUnchanged=end.commit===report.source.commit&&end.tree===report.source.tree&&!end.dirty;assert.equal(report.sourceUnchanged,true);
    await copyFile(path.join(process.env.RUNNER_TEMP,'production-smoke.png'),imagePath);report.screenshotSHA256=sha256(await readFile(imagePath));report.status='passed';
}catch(error){report.error=error.stack||String(error);process.exitCode=1;if(readDOM)report.failureState=await readDOM(()=>({active:document.activeElement?.id,openHandler:typeof document.querySelector('#open-model')?.onclick,inputFiles:document.querySelector('#model-file')?.files.length,inputDisabled:document.querySelector('#model-file')?.disabled,openDialogs:[...document.querySelectorAll('dialog[open]')].map(d=>d.id),status:document.querySelector('#status')?.textContent,modelTabs:document.querySelector('#model-tabs')?.getAttribute('aria-busy')})).catch(e=>({observationError:e.message}));if(page)await page.screenshot({path:imagePath}).catch(()=>{});}
finally{
    try{await context?.close();if(browser)await browser.close();report.browserClosed=Boolean(browser);}catch(error){report.status='failed';report.errors.push(error.message);process.exitCode=1;}
    report.finishedAt=new Date().toISOString();await writeFile(reportPath,JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify({engine,status:report.status,checks:report.checks,error:report.error}));
}
