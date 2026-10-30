// Explicitly authorized Windows isolated Chrome/Edge. Public synthetic MLIR only.
import assert from 'node:assert/strict';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {once} from 'node:events';
import {chromium,selectors} from 'playwright';
import {createStaticServer} from '../../scripts/serve.mjs';
import {verifyArtifact,gitSource,sha256} from '../../scripts/lib/release-artifact.mjs';
import {parseMLIRFile} from '../../src/mlir-engine.js';
import {validateMLIR} from '../../src/mlir-validate.js';
import {registerDOMReader,desktopDOMReader} from './desktop-dom-reader.mjs';
assert.equal(process.platform,'win32');assert.ok(process.argv.includes('--allow-local-browser'));
const [build,output]=process.argv.slice(2).filter(v=>!v.startsWith('--'));assert.ok(build&&output);
const source=gitSource();assert.equal(source.dirty,false);const artifact=await verifyArtifact(build,{publicOnly:true,expectedCommit:source.commit,requireClean:true});
const directory=path.resolve(output);await mkdir(directory);
const hex='aB'.repeat(6000),text=`%w = "public.weight"() {value=dense_resource<weights> : tensor<6000xi8>} : () -> tensor<6000xi8>\n%v = "public.use"(%w) : (tensor<6000xi8>) -> tensor<6000xi8>\n{-# dialect_resources: { builtin: { weights: "0x01000000${hex}" } } #-}`;
const file=path.join(directory,'resource.mlir');await writeFile(file,text,{flag:'wx'});const metadata=await readFile('vendor/netron/mlir-metadata.json','utf8');
const report={status:'failed',source,build:artifact.release,scope:'Installed isolated Windows Chrome/Edge;local resource MLIR chooser,32px,pattern,counter disclosure,download/report,reopen.No compiler/runtime execution.',browsers:[]};
await registerDOMReader(selectors);const server=createStaticServer(path.resolve(build));server.listen(0,'127.0.0.1');await once(server,'listening');const base=`http://127.0.0.1:${server.address().port}/`;
try{for(const channel of ['chrome','msedge']){
 const row={channel,status:'failed',errors:[],workers:[],runtimeRequests:[]};report.browsers.push(row);let browser,context,page;
 try{
  browser=await chromium.launch({channel,headless:true});row.version=browser.version();context=await browser.newContext({viewport:{width:1280,height:640},acceptDownloads:true});await context.route('**/*',r=>new URL(r.request().url()).origin===new URL(base).origin?r.continue():r.abort());
  page=await context.newPage();page.setDefaultTimeout(35000);const read=desktopDOMReader(page);page.on('pageerror',e=>row.errors.push(e.message));page.on('request',r=>{if(r.url().includes('/vendor/litert/'))row.runtimeRequests.push(r.url());});page.on('worker',w=>{const entry={url:w.url(),closed:false};row.workers.push(entry);w.once('close',()=>entry.closed=true);});
  const until=async(fn,...args)=>{const deadline=Date.now()+35000;while(!await read(fn,...args)){assert.ok(Date.now()<deadline,'DOM timeout: '+fn);await new Promise(r=>setTimeout(r,50));}};
  const ready=()=>until(()=>document.querySelector('#model-tabs').getAttribute('aria-busy')==='false'&&document.querySelector('#loading-card').hidden&&document.querySelector('#target').getAttribute('aria-busy')==='false');
  const save=async(button,name)=>{const event=page.waitForEvent('download');await page.locator(button).click();const d=await event;assert.equal(await d.failure(),null);const filename=path.join(directory,channel+'-'+name);await d.saveAs(filename);await d.delete();return new Uint8Array(await readFile(filename));};
  await page.goto(base);await until(()=>document.querySelector('#application-startup').hidden&&!document.querySelector('#open-model').disabled);const chooser=page.waitForEvent('filechooser');await page.locator('#open-model').click();await(await chooser).setFiles(file);await ready();
  await page.locator('#layers-tab').click();await page.locator('#query').fill('#0');await until(()=>document.querySelector('#result-count').textContent==='1 筆結果'&&document.querySelector('.result-index')?.textContent==='#0');await page.locator('.result-item').click();await ready();await page.locator('#graph-font-size').selectOption('32');await until(()=>document.querySelector('#target').getAttribute('aria-busy')==='false'&&!!document.querySelector('#target .node[data-model-node="1"] .node-item-type text')&&parseFloat(getComputedStyle(document.querySelector('#target .node[data-model-node="1"] .node-item-type text')).fontSize)>=32);
  await page.locator('#pick-pattern').click();for(const id of [0,1])await page.locator(`#target .node[data-model-node="${id}"] .node-item-type`).click();await until(()=>document.querySelector('#capture-count').textContent.startsWith('已選取 2 個'));await page.locator('#capture-name').fill('Resource preservation');await page.locator('#save-capture').click();await until(()=>document.querySelector('#result-count').textContent==='1 筆匹配路徑');await page.locator('.result-item').click();await ready();
  const bytes=await save('#export-match','cut.mlir'),candidate=await parseMLIRFile(new Blob([bytes]),{metadata}),validation=validateMLIR(candidate);assert.deepEqual(validation.diagnostics,[]);assert.equal(validation.dense.unchecked,1);assert.ok(new TextDecoder().decode(bytes).includes(`weights: "0x01000000${hex}"`));
  await until(()=>document.querySelector('#status').textContent.includes('1 段編碼未檢查'));row.notice=await page.locator('#notice-text').textContent();assert.match(row.notice,/1 段權重編碼尚未驗證/);assert.equal(await page.locator('#notice').isVisible(),true);row.statusText=await page.locator('#status').textContent();assert.equal(await read(()=>document.documentElement.scrollWidth<=innerWidth),true);await page.screenshot({path:path.join(directory,channel+'-warning-32px.png')});
  await page.locator('#export-report-button').click();await until(()=>document.querySelector('#export-report-dialog').open);const record=JSON.parse(new TextDecoder().decode(await save('#download-export-report','export-report.json')));assert.match(record.checks.find(c=>c.id==='mlir-structure').detail,/1 段編碼未檢查/);assert.equal(record.checks.find(c=>c.id==='dense-values').status,'not-run');assert.equal(record.checks.find(c=>c.id==='native-compiler').status,'not-run');await page.locator('#close-export-report').click();
  await page.locator('#open-export-model').click();await ready();await page.locator('#patterns-tab').click();await page.locator('#saved-pattern').selectOption({label:'Resource preservation'});await until(()=>document.querySelector('#result-count').textContent==='1 筆匹配路徑');await page.locator('.result-item').click();await ready();await page.screenshot({path:path.join(directory,channel+'-reopened-32px.png')});row.download={bytes:bytes.length,sha256:sha256(bytes)};row.reopenedPatternMatches=1;
  await context.close();context=null;await browser.close();browser=null;assert.deepEqual(row.errors,[]);assert.deepEqual(row.runtimeRequests,[]);assert.ok(row.workers.length&&row.workers.every(w=>w.closed));row.status='passed';
 }catch(error){row.error=error.stack;if(page&&!page.isClosed())await page.screenshot({path:path.join(directory,channel+'-failure.png')}).catch(()=>{});throw error;}finally{await context?.close();await browser?.close();}
}assert.deepEqual(gitSource(),source);report.status='passed';}catch(error){report.error=error.stack;process.exitCode=1;}
finally{await new Promise(r=>server.close(r));await writeFile(path.join(directory,'report.json'),JSON.stringify(report,null,2)+'\n',{flag:'wx'});console.log(JSON.stringify({status:report.status,browsers:report.browsers.map(r=>({channel:r.channel,status:r.status,error:r.error})),error:report.error}));}
