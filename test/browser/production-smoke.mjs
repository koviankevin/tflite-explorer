// Isolated hosted CI against the public site; never automate the user's browser.
import assert from 'node:assert/strict';
import {chromium} from 'playwright';
import {readFile,writeFile,mkdtemp} from 'node:fs/promises';
import path from 'node:path';
import {once} from 'node:events';
import {exportPatterns,reusablePattern,parsePatternFile} from '../../src/pattern-library.js';
import {sha256} from '../../scripts/lib/release-artifact.mjs';
assert.equal(process.env.GITHUB_ACTIONS,'true');assert.equal(process.platform,'linux');
const expected=process.env.EXPECTED_BUILD;assert.match(expected||'',/^[a-f0-9]{16}$/);
const base='https://koviankevin.github.io/tflite-explorer/',reportPath=path.join(process.env.RUNNER_TEMP,'production-smoke.json');
const report={format:'model-lens-production-smoke',version:1,status:'failed',startedAt:new Date().toISOString(),driverSourceCommit:process.env.GITHUB_SHA,expectedBuild:expected,checks:[],errors:[]};
let browser,context,page,readPage,releaseStartup;
const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const check=name=>{report.checks.push(name);console.log(`PASS ${name}`);};
async function waitFor(fn){const until=Date.now()+30000;while(!await readPage(fn)){if(Date.now()>until)throw Error(`DOM timeout: ${fn}`);await wait(100);}}
async function choose(file,button='#open-model'){const event=page.waitForEvent('filechooser');await page.locator(button).click();await (await event).setFiles(file);}
async function ready(layers){await waitFor(()=>document.querySelector('#loading-card').hidden&&document.querySelector('#layer-count').textContent!=='—'&&document.querySelector('#target').getAttribute('aria-busy')==='false');assert.equal(await page.locator('#layer-count').textContent(),String(layers));}
async function close(){
    const worker=page.workers().find(w=>/\/model-worker\.js(?:\?|$)/.test(w.url()));assert.ok(worker);let timer;
    try{const event=Promise.race([once(worker,'close'),new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('Model worker close timeout.')),5000);})]);await page.locator('#close-model').click();await event;}finally{clearTimeout(timer);}
    assert.equal(await readPage(()=>document.querySelector('#model-file').files.length),0);
}
try{
    const temporary=await mkdtemp(path.join(process.env.RUNNER_TEMP,'production-models-'));
    const manifestResponse=await fetch(base+'release-manifest.json?v='+expected,{signal:AbortSignal.timeout(20000)});assert.equal(manifestResponse.status,200);const manifest=await manifestResponse.json();assert.equal(manifest.release.buildId,expected);report.siteRelease=manifest.release;
    const demoEntry=manifest.files.find(f=>f.path==='demo.tflite');assert.ok(demoEntry&&demoEntry.bytes<1024**2);
    const demoResponse=await fetch(base+'demo.tflite?v='+expected,{signal:AbortSignal.timeout(20000)});assert.equal(demoResponse.status,200);const demoBytes=Buffer.from(await demoResponse.arrayBuffer());assert.equal(sha256(demoBytes),demoEntry.sha256);const demo=path.join(temporary,'demo.tflite');await writeFile(demo,demoBytes,{flag:'wx'});
    const pattern=reusablePattern('Deployment smoke RTR',{nodes:[{alias:'N1',type:'Reshape'},{alias:'N2',type:'Transpose'},{alias:'N3',type:'Reshape'}],edges:[{from:'N1',to:'N2'},{from:'N2',to:'N3'}],induced:true}),patternFile=path.join(temporary,'patterns.json');await writeFile(patternFile,exportPatterns([pattern]),{flag:'wx'});
    browser=await chromium.launch({headless:true});report.chromium=browser.version();context=await browser.newContext({viewport:{width:1366,height:768},acceptDownloads:true});
    let markStartupBlocked,startupReleased=false;
    const startupBlocked=new Promise(resolve=>{markStartupBlocked=resolve;});
    const startupHold=new Promise(resolve=>{releaseStartup=()=>{startupReleased=true;resolve();};});
    await context.route('**/*',async route=>{const r=route.request(),url=new URL(r.url());if(['blob:','data:'].includes(url.protocol)){await route.continue();return;}if(r.method()!=='GET'||!r.url().startsWith(base)){report.errors.push('Unexpected external/non-GET request.');await route.abort();}else {if(url.pathname.endsWith('/vendor/netron/zip.js')&&!startupReleased){markStartupBlocked();await startupHold;}await route.continue();}});
    page=await context.newPage();page.setDefaultTimeout(30000);page.on('pageerror',error=>report.errors.push(error.message));page.on('crash',()=>report.errors.push('Page crash.'));page.on('websocket',()=>report.errors.push('Unexpected WebSocket.'));
    const cdp=await context.newCDPSession(page);readPage=async fn=>{const value=await cdp.send('Runtime.evaluate',{expression:`(${fn.toString()})()`,returnByValue:true});if(value.exceptionDetails)throw Error('Read-only DOM observation failed.');return value.result.value;};
    await page.goto(base+'?v='+expected,{waitUntil:'domcontentloaded'});
    await waitFor(()=>typeof document.querySelector('#welcome-open').onclick==='function');
    let startupTimer;
    try{await Promise.race([startupBlocked,new Promise((_,reject)=>{startupTimer=setTimeout(()=>reject(Error('Graph initialization request was not observed.')),30000);})]);}finally{clearTimeout(startupTimer);}
    assert.equal(await readPage(()=>typeof document.querySelector('#release-info-button').onclick),'function','Version control must work while graph initialization is pending.');
    await page.locator('#release-info-button').click();await page.getByText(expected,{exact:true}).waitFor();await page.locator('#close-release-info').click();releaseStartup();check('version dialog works during delayed graph initialization at the repository subpath');
    await page.locator('#open-demo').click();await ready(26);await page.locator('#graph-font-size').selectOption('32');await waitFor(()=>document.querySelector('#target').getAttribute('aria-busy')==='false');
    await page.locator('#query').fill('#0');await waitFor(()=>document.querySelector('#result-count').textContent==='1 筆結果');await page.locator('.result-item').click();await waitFor(()=>document.querySelector('#target').getAttribute('aria-busy')==='false'&&document.querySelectorAll('#target .node').length>0);check('public demo, 32px graph, exact layer search and location');
    await close();await choose(demo);await ready(26);await page.locator('[data-kind="patterns"]').click();await waitFor(()=>document.querySelector('#result-count').textContent==='4 筆匹配路徑');
    await page.locator('#open-import').click();await choose(patternFile,'#choose-pattern-file');await page.locator('#confirm-import').click();await waitFor(()=>!document.querySelector('#import-dialog').open);await page.locator('#saved-pattern').selectOption(pattern.name);await waitFor(()=>document.querySelector('#result-count').textContent==='4 筆匹配路徑');
    let event=page.waitForEvent('download');await page.locator('#export-pattern').click();let download=await event;assert.equal(await download.failure(),null);const json=path.join(temporary,'pattern-roundtrip.json');await download.saveAs(json);await download.delete();assert.deepEqual(parsePatternFile(await readFile(json,'utf8')),[pattern]);check('native model chooser and native pattern JSON import/export');
    await page.locator('.result-item').first().click();await waitFor(()=>document.querySelector('#target').getAttribute('aria-busy')==='false');event=page.waitForEvent('download');await page.locator('#export-match').click();download=await event;assert.equal(await download.failure(),null);const child=path.join(temporary,'submodel.tflite');await download.saveAs(child);await download.delete();
    await close();await choose(child);await ready(3);await waitFor(()=>document.querySelector('#result-count').textContent==='1 筆匹配路徑');await page.locator('.result-item').click();await waitFor(()=>document.querySelector('#target').getAttribute('aria-busy')==='false'&&document.querySelectorAll('#target .node').length>0);await close();check('actual TFLite submodel download, native reopen, original pattern and worker cleanup');
    assert.deepEqual(report.errors,[]);report.status='passed';
}catch(error){report.error=error.stack||String(error);process.exitCode=1;if(page)await page.screenshot({path:path.join(process.env.RUNNER_TEMP,'production-smoke.png')}).catch(()=>{});}
finally{
    releaseStartup?.();
    try{await context?.close();if(browser){let timer;try{await Promise.race([browser.close(),new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('Browser close timeout.')),10000);})]);}finally{clearTimeout(timer);}}}catch(error){report.status='failed';report.errors.push(error.message);process.exitCode=1;}
    report.finishedAt=new Date().toISOString();await writeFile(reportPath,JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify({status:report.status,checks:report.checks,error:report.error}));
}
