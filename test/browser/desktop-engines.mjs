import {firefoxOwnedIOMemoryControl} from './firefox-owned-io-control.mjs';
import {afterRSSDiagnostics} from './rss-native-diagnostic-continuation.mjs';
import {retainedRuntimeInputFlow} from './retained-runtime-input-flow.mjs';
import {runtimeModuleColdFlow} from './runtime-module-cold-flow.mjs';
import {installIdentityWorkerAudit,identityWorkerDiagnostics} from './identity-worker-diagnostics.mjs';
import {workerStartupControl} from './worker-startup-control.mjs';
import {desktopRuntimeRSSFlow} from './desktop-runtime-rss-flow.mjs';
import {firefoxNetworkMemoryControl} from './firefox-network-memory-control.mjs';
import {firefoxPayloadMemoryControl} from './firefox-payload-memory-control.mjs';
import {preserveRSSFailure} from './rss-diagnostic-continuation.mjs';
// The browser runs only on the hosted Linux runner. Gestures, chooser and
// download events use Playwright's browser protocol. Observations read DOM;
// Firefox diagnosis may query a native Worker context for a data-free constant.
import assert from 'node:assert/strict';
import {firefox,webkit,selectors} from 'playwright';
import {readFile,writeFile,mkdtemp,copyFile} from 'node:fs/promises';
import path from 'node:path';
import {once} from 'node:events';
import {desktopEngineSettings} from '../../scripts/lib/desktop-engine-policy.mjs';
import {gitSource,sha256} from '../../scripts/lib/release-artifact.mjs';
import {readStaticFile} from '../../scripts/lib/live-site.mjs';
import {openDesktopTarget} from '../../scripts/lib/desktop-engine-target.mjs';
import {reusablePattern,exportPatterns,parsePatternFile} from '../../src/pattern-library.js';
import {editWorkspaceFlow} from './edit-workspace-flow.mjs';
import {portableEditFlow} from './portable-edit-flow.mjs';
import {tfliteControlEditFlow} from './tflite-control-edit-flow.mjs';
import {mlirKeyboardFlow} from './mlir-keyboard-flow.mjs';
import {demoRuntimeFlow} from './demo-runtime-flow.mjs';
import {tfliteRuntimeFlow} from './tflite-runtime-flow.mjs';
import {usageGuideFlow} from './usage-guide-flow.mjs';
import {activeComputeFlow} from './active-compute-flow.mjs';
import {registerDOMReader,desktopDOMReader} from './desktop-dom-reader.mjs';
import {installDesktopChooserReader} from './desktop-chooser-reader.mjs';

const settings=desktopEngineSettings(process.env,process.platform),{engine}=settings;
const report={format:'model-lens-desktop-engine',version:1,status:'failed',startedAt:new Date().toISOString(),engine,target:settings.target,source:gitSource(),checks:[],errors:[],errorDetails:[],failedRequests:[],workers:[],requests:[],browserClosed:false};
const reportPath=path.join(process.env.RUNNER_TEMP,`desktop-${engine}.json`),imagePath=path.join(process.env.RUNNER_TEMP,`desktop-${engine}.png`);
let browser,context,page,readDOM,target,diagnostics,phase='startup';
const check=name=>{report.checks.push(name);console.log(`PASS ${engine}: ${name}`);};
try{
    assert.equal(report.source.dirty,false,'Compatibility driver source must be committed.');
    target=await openDesktopTarget(settings,report.source);
    const {base,expectedBuild,expectedSiteId,manifest,coreBasePath}=target;
    report.expectedBuild=expectedBuild;report.expectedSiteId=expectedSiteId;report.base=base;
    report.release=manifest.release;report.coreBasePath=coreBasePath;report.staticVerification=target.staticVerification;
    const directory=await mkdtemp(path.join(process.env.RUNNER_TEMP,`desktop-${engine}-`)),demoEntry=manifest.files.find(f=>f.path==='demo.tflite');assert.ok(demoEntry&&demoEntry.bytes<1024**2);
    const demoBytes=(await readStaticFile(base,coreBasePath+demoEntry.path,{maxBytes:demoEntry.bytes})).bytes;assert.equal(sha256(demoBytes),demoEntry.sha256);
    const demo=path.join(directory,'demo.tflite');await writeFile(demo,demoBytes,{flag:'wx'});
    const pattern=reusablePattern('Desktop engine RTR',{nodes:[{alias:'N1',type:'Reshape'},{alias:'N2',type:'Transpose'},{alias:'N3',type:'Reshape'}],edges:[{from:'N1',to:'N2'},{from:'N2',to:'N3'}],induced:true}),patternFile=path.join(directory,'patterns.json');await writeFile(patternFile,exportPatterns([pattern]),{flag:'wx'});
    await registerDOMReader(selectors);
    report.chooserObservation=(await installDesktopChooserReader()).evidence;
    browser=await ({firefox,webkit}[engine]).launch({headless:true});report.browserVersion=browser.version();
    context=await browser.newContext({viewport:{width:1366,height:640},acceptDownloads:true});if(engine==='firefox')await context.addInitScript(installIdentityWorkerAudit);
    context.on('requestfailed',r=>{if(report.failedRequests.length<50)report.failedRequests.push({phase,url:r.url(),resource:r.resourceType(),reason:r.failure()?.errorText,at:new Date().toISOString()});});
    await context.route('**/*',async route=>{const r=route.request(),u=new URL(r.url());if(['blob:','data:'].includes(u.protocol)){await route.continue();return;}const allowed=r.method()==='GET'&&r.url().startsWith(base);report.requests.push({method:r.method(),url:r.url(),allowed});if(!allowed){report.errors.push('Unexpected external/non-GET request.');await route.abort();}else await route.continue();});
    // A separate blank document proves that the pinned engine can expose a
    // native chooser before attributing any production failure to the app.
    const probe=await context.newPage();probe.on('filechooser',()=>{});
    try{
        report.nativeChooserProbe=[];
        for(const disabledEval of [false,true]){
            await probe.setContent('<input id="probe-file" type="file" hidden><button id="probe-open" onclick="document.getElementById(\'probe-file\').click()">Choose</button>'+(disabledEval?'<script>window.eval=()=>{throw Error("window.eval() not supported.")};</script>':''));
            const chosen=probe.waitForEvent('filechooser');await probe.locator('#probe-open').click();await(await chosen).setFiles(demo);assert.match(await probe.locator('#probe-file').inputValue(),/demo\.tflite$/);report.nativeChooserProbe.push({disabledEval,status:'passed'});
        }
    }finally{await probe.close();}
    page=await context.newPage();page.setDefaultTimeout(30000);if(engine==='firefox'){diagnostics=identityWorkerDiagnostics({page,read:(...args)=>readDOM(...args),getPhase:()=>phase});report.workerDiagnostics=diagnostics.report;}
    // Interception is enabled over an asynchronous browser protocol message.
    // Keep a listener before navigation, so the first real chooser cannot race
    // the waitForEvent() subscription immediately preceding a fast click.
    report.chooserEvents=0;page.on('filechooser',()=>{report.chooserEvents++;});
    page.on('pageerror',e=>{report.errors.push(e.message);if(report.errorDetails.length<50)report.errorDetails.push({phase,message:e.message,stack:e.stack,at:new Date().toISOString(),lastCheck:report.checks.at(-1),pageURL:page.url(),workers:report.workers.filter(w=>!w.closed).map(w=>w.url)});});page.on('crash',()=>report.errors.push('Page crash.'));page.on('websocket',()=>report.errors.push('Unexpected WebSocket.'));
    page.on('worker',worker=>{const item={url:worker.url(),closed:false};report.workers.push(item);diagnostics?.track(worker,item,report.workers.length-1);worker.on('close',()=>{item.closed=true;});if(/\/model-worker\.js(?:\?|$)/.test(item.url)&&item.url!==new URL(coreBasePath+`src/model-worker.js?v=${expectedBuild}`,base).href)report.errors.push('Worker belongs to another build namespace.');});
    // Each observation is a fixed, source-controlled DOM expression. Never
    // evaluate app APIs, mutate selection or generate a file inside the page.
    const read=readDOM=desktopDOMReader(page);
    const until=async(fn,...args)=>{const end=Date.now()+30000;while(!await read(fn,...args)){if(Date.now()>end)throw Error('Desktop DOM timeout: '+fn);await new Promise(r=>setTimeout(r,75));}};
    const ready=async count=>{await until(()=>document.querySelector('#model-tabs').getAttribute('aria-busy')!=='true'&&document.querySelector('#loading-card').hidden&&document.querySelector('#target').getAttribute('aria-busy')==='false'&&document.querySelector('#layer-count').textContent!=='—');if(count!==undefined)assert.equal(await page.locator('#layer-count').textContent(),String(count));};
    const choose=async(file,selector='#open-model')=>{const event=page.waitForEvent('filechooser');await page.locator(selector).click();await(await event).setFiles(file);};
    const close=async()=>{const worker=page.workers().find(w=>/\/model-worker\.js(?:\?|$)/.test(w.url()));assert.ok(worker);let timer;try{const closed=Promise.race([once(worker,'close'),new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('Desktop model worker retained.')),5000);})]);await page.locator('#close-model').click();await closed;}finally{clearTimeout(timer);}assert.equal(await read(()=>document.querySelector('#model-file').files.length),0);};
    const download=async(selector,name)=>{const event=page.waitForEvent('download');await page.locator(selector).click();const d=await event;assert.equal(await d.failure(),null);const file=path.join(directory,name);await d.saveAs(file);await d.delete();return file;};
    await page.goto(base,{waitUntil:'domcontentloaded'});await until(()=>!document.querySelector('#autosave-enabled').disabled);if(diagnostics){const first=await diagnostics.snapshot('initial-ready');assert.equal(first.identityDOM?.version,1);}
    assert.equal(new URL(await read(()=>document.baseURI)).pathname,new URL(coreBasePath,base).pathname);
    await page.locator('#open-demo').click();await ready(26);await page.locator('#graph-font-size').selectOption('32');await ready();await page.locator('#query').fill('#0');await until(()=>document.querySelector('#result-count').textContent==='1 筆結果');await page.locator('.result-item').click();await ready();assert.ok(await page.locator('#target .node').count()>0);await close();
    check('public demo: local worker, 32px graph, exact layer lookup and location');
    await choose(demo);await ready(26);await page.locator('[data-kind="patterns"]').click();await page.locator('#open-import').click();await choose(patternFile,'#choose-pattern-file');await page.locator('#confirm-import').click();await until(()=>!document.querySelector('#import-dialog').open);await page.locator('#saved-pattern').selectOption(pattern.name);await until(()=>document.querySelector('#result-count').textContent==='4 筆匹配路徑');
    const json=await download('#export-pattern','pattern-roundtrip.json');assert.deepEqual(parsePatternFile(await readFile(json,'utf8')),[pattern]);check('actual file chooser and native pattern import/export preserve the structural query');
    await page.locator('.result-item').first().click();await ready();const child=await download('#export-match','submodel.tflite');await close();await choose(child);await ready(3);await until(()=>document.querySelector('#result-count').textContent==='1 筆匹配路徑');await page.locator('.result-item').click();await ready();await close();check('TFLite submodel downloads and reopens with exactly one original pattern match');
    phase='edit-workspace';report.editWorkspace=await editWorkspaceFlow({page,read,base,directory,check,allowMlir:false});await diagnostics?.snapshot('after-edit-workspace');
    phase='portable-edit';report.portableEdit=await portableEditFlow({page,read,base,directory,check,allowMlir:false});await diagnostics?.snapshot('after-portable-edit');
    phase='control-edit';report.controlEdit=await tfliteControlEditFlow({page,read,base,directory,check});await diagnostics?.snapshot('after-control-edit');
    phase='mlir-keyboard';report.mlirKeyboard=await mlirKeyboardFlow({page,read,base,directory,check});await diagnostics?.snapshot('after-mlir-keyboard');
    const modelWorkers=()=>report.workers.filter(w=>/\/model-worker\.js(?:\?|$)/.test(w.url)),baseWorkers=modelWorkers();report.baseModelWorkers=baseWorkers.length;
    assert.equal(baseWorkers.length,3+report.editWorkspace.modelWorkers+report.portableEdit.modelWorkers+report.controlEdit.modelWorkers+report.mlirKeyboard.modelWorkers);assert.ok(baseWorkers.every(w=>w.closed));
    // Older immutable releases retain their original compatibility coverage.
    // Current standalone Run builds must exercise the same real CPU, IO and
    // native file/draft workflows as Chromium, without editing the application.
    report.runtimeWorkspaceRequired=manifest.files.some(f=>f.path==='src/model-runtime-workspace-ui.js');
    report.usageGuideRequired=manifest.files.some(f=>f.path==='src/usage-guide-ui.js');
    if(report.runtimeWorkspaceRequired){
        phase='published-demo-runtime';const before=modelWorkers().length;report.demoRuntime=await demoRuntimeFlow({page,read,directory});assert.equal(modelWorkers().length-before,3);await diagnostics?.snapshot('after-demo-runtime');check('exact published demo original and reopened edit run with zero/random inputs on the selected engine');
        phase='model-runtime';const afterDemo=modelWorkers().length;report.tfliteRuntime=await tfliteRuntimeFlow({page,read,base,directory,check,keyboardInputs:true,referenceInputs:true,precisionInputs:true,shapeInputs:true,compositionInputs:true,sharedRuntimeModule:manifest.files.some(f=>f.path==='src/runtime-module.js'),inputCleanup:Number(manifest.release.version.match(/^0\.2\.0-preview\.(\d+)$/)?.[1])>=31});assert.equal(report.tfliteRuntime.cases.length,19);assert.equal(modelWorkers().length-afterDemo,33+(manifest.files.some(f=>f.path==='src/runtime-module.js')?2:0));await diagnostics?.snapshot('after-runtime');
    }
    if(report.usageGuideRequired){phase='usage-guide';report.usageGuide=await usageGuideFlow({page,read,directory,check,sharedRuntimeModule:manifest.files.some(f=>f.path==='src/runtime-module.js')});assert.equal(report.usageGuide.cases.length,5);await diagnostics?.snapshot('after-guide');}
    report.activeComputeRequired=report.runtimeWorkspaceRequired&&report.usageGuideRequired;
    if(report.activeComputeRequired){phase='active-compute';report.activeCompute=await activeComputeFlow({page,read,directory,check});await diagnostics?.snapshot('after-active-compute');}
    const workers=modelWorkers(),runtimes=report.workers.filter(w=>/\/tflite-runtime-worker\.js(?:\?|$)/.test(w.url));report.modelWorkers=workers.length;report.runtimeWorkers=runtimes.length;
    assert.equal(workers.length,report.baseModelWorkers+(report.runtimeWorkspaceRequired?36+(manifest.files.some(f=>f.path==='src/runtime-module.js')?2:0):0)+(report.usageGuideRequired?3+(manifest.files.some(f=>f.path==='src/runtime-module.js')?2:0):0)+(report.activeComputeRequired?3:0));assert.equal(runtimes.length,(report.runtimeWorkspaceRequired?14:0)+(report.usageGuideRequired?2:0)+(report.activeComputeRequired?4:0));assert.ok([...workers,...runtimes].every(w=>w.closed));assert.deepEqual(report.errors,[]);
    if(engine==='firefox'){
        phase='native-worker-control';const controlContext=await browser.newContext();
        try{report.workerStartupControl=await workerStartupControl(controlContext);}finally{await controlContext.close();}
        assert.equal(report.workerStartupControl.rows.length,32);assert.deepEqual(report.workerStartupControl.errors,[]);
        assert.ok(report.workerStartupControl.rows.every(row=>row.terminateReturnedAt!==null&&row.revoked&&!row.error));
        assert.ok(report.workerStartupControl.rows.filter(row=>row.timing==='ready').every(row=>row.readyAt!==null));
        assert.equal(report.workerStartupControl.pageClosed,true);
    }
    report.desktopRuntimeRSSRequired=report.activeComputeRequired&&Number(manifest.release.version.match(/^0\.2\.0-preview\.(\d+)$/)?.[1]??31)>=31;
    report.runtimeIOTransferRequired=manifest.files.some(f=>f.path==='src/runtime-io.js');
    if(engine==='firefox'&&report.desktopRuntimeRSSRequired&&!report.runtimeIOTransferRequired){
        const asset=manifest.files.find(f=>f.path==='vendor/litert/2.6.0/litert_wasm_compat_internal.wasm');assert.ok(asset);report.firefoxNetworkControls=[];
        report.firefoxPayloadControlsRequired=manifest.files.some(f=>f.path==='src/runtime-module.js');
        // The unchanged HTTP/one-File diagnostics are already authenticated in
        // runtime-module32-native-originals.zip. The cached candidate needs a
        // fresh empty baseline and separate per-input/IO/module comparisons.
        for(const mode of report.firefoxPayloadControlsRequired?['empty']:['empty','fetch','file']){phase=`firefox-network-control-${mode}`;report.firefoxNetworkControls.push(await firefoxNetworkMemoryControl({browserType:firefox,base,assetURL:new URL(coreBasePath+asset.path,base).href,expectedBytes:asset.bytes,expectedSHA256:asset.sha256,mode}));}
        if(report.firefoxPayloadControlsRequired){report.firefoxPayloadControls=[];for(const mode of ['file-read','file-io','module-clone']){phase=`firefox-payload-control-${mode}`;report.firefoxPayloadControls.push(await firefoxPayloadMemoryControl({browserType:firefox,base,asset:{url:new URL(coreBasePath+asset.path,base).href,bytes:asset.bytes,sha256:asset.sha256},mode}));}}
    }
    if(engine==='firefox'&&report.runtimeIOTransferRequired)report.completedDiagnosticsReference={run:40948691875,archiveSHA256:'b0fc371b45b4b3b31ac0d85745d96aeb4213487fd643653370ca50a8e78a487a',scope:'Completed standalone diagnostic-only controls; no performance acceptance reused. OriginalruntimeRSS runs fresh.'};
    report.runtimeModuleColdRequired=manifest.files.some(f=>f.path==='src/runtime-module.js');const runCold=report.runtimeModuleColdRequired?async()=>{phase='runtime-module-cold';const cold=await runtimeModuleColdFlow({browser,base,coreBasePath,buildId:expectedBuild,modelFile:demo,modelEntry:demoEntry,createReader:desktopDOMReader});if(report.runtimeIOTransferRequired){phase='retained-runtime-inputs';try{report.retainedRuntimeInputs=await retainedRuntimeInputFlow({browser,base,coreBasePath,buildId:expectedBuild,directory,createReader:desktopDOMReader});}catch(error){report.retainedRuntimeInputs=error.retainedRuntimeInputs;throw Object.assign(error,{runtimeModuleCold:cold});}}return cold;}:undefined;
    const nativeDiagnostic=engine==='firefox'&&settings.target==='candidate'&&report.runtimeIOTransferRequired?async()=>{phase='firefox-native-memory-control';const asset=manifest.files.find(f=>f.path==='vendor/litert/2.6.0/litert_wasm_compat_internal.wasm');try{return report.firefoxNativeControl=await firefoxOwnedIOMemoryControl({browserType:firefox,base,asset:{url:new URL(coreBasePath+asset.path,base).href,bytes:asset.bytes,sha256:asset.sha256}});}catch(error){report.firefoxNativeControl=error.firefoxNativeControl;throw error;}}:null;
    if(report.desktopRuntimeRSSRequired){
        const outcome=await afterRSSDiagnostics(()=>preserveRSSFailure(async()=>{phase='desktop-runtime-rss';const rss=await desktopRuntimeRSSFlow({browserType:{firefox,webkit}[engine],engine,base});assert.equal(rss.evaluation.status,'passed');await diagnostics?.snapshot('after-desktop-runtime-rss');return rss;},runCold),nativeDiagnostic);report.desktopRuntimeRSS=outcome.rss;if(outcome.firefoxNativeControl)report.firefoxNativeControl=outcome.firefoxNativeControl;if(runCold){report.runtimeModuleCold=outcome.cold;assert.equal(outcome.cold.status,'passed');}
    }else if(runCold)report.runtimeModuleCold=await runCold();
    await target.verifyUnchanged();
    const end=gitSource();report.sourceUnchanged=end.commit===report.source.commit&&end.tree===report.source.tree&&!end.dirty;assert.equal(report.sourceUnchanged,true);await diagnostics?.snapshot('before-browser-close',{probe:true});
    await copyFile(report.activeCompute?.screenshot?path.join(directory,'active-cpu-timeout.png'):report.usageGuide?.screenshot?path.join(directory,'usage-guide.png'):path.join(process.env.RUNNER_TEMP,'production-smoke.png'),imagePath);report.screenshotSHA256=sha256(await readFile(imagePath));report.status='passed';phase='complete';
}catch(error){if(error.diagnosticContinuation){report.diagnosticContinuation=error.diagnosticContinuation;phase='desktop-runtime-rss';}report.error=error.stack||String(error);for(const key of ['mlirKeyboard','demoRuntime','tfliteRuntime','usageGuide','activeCompute','workerStartupControl','desktopRuntimeRSS','firefoxNetworkControl','firefoxPayloadControl','runtimeModuleCold','retainedRuntimeInputs','firefoxNativeControl'])if(error[key])report[key]=error[key];process.exitCode=1;if(readDOM)report.failureState=await readDOM(()=>({active:document.activeElement?.id,documentFocus:document.hasFocus(),openHandler:typeof document.querySelector('#open-model')?.onclick,inputFiles:document.querySelector('#model-file')?.files.length,inputDisabled:document.querySelector('#model-file')?.disabled,openDialogs:[...document.querySelectorAll('dialog[open]')].map(d=>d.id),status:document.querySelector('#status')?.textContent,modelTabs:document.querySelector('#model-tabs')?.getAttribute('aria-busy')})).catch(e=>({observationError:e.message}));if(page)await page.screenshot({path:imagePath}).catch(()=>{});}
finally{
    try{await context?.close();if(browser)await browser.close();report.browserClosed=Boolean(browser);}catch(error){report.status='failed';report.errors.push(error.message);process.exitCode=1;}
    try{await target?.close();}catch(error){report.status='failed';report.errors.push(error.message);process.exitCode=1;}
    if(diagnostics){await diagnostics.snapshot('after-browser-close');diagnostics.dispose();}
    report.phase=phase;report.finishedAt=new Date().toISOString();await writeFile(reportPath,JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify({engine,status:report.status,checks:report.checks,error:report.error}));
}
