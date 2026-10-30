// Explicitly authorized isolated Windows native UI acceptance. Public synthetic
// models and a synthetic internal profile only; no personal profile or telemetry.
import assert from 'node:assert/strict';
import {mkdir,writeFile,readFile} from 'node:fs/promises';
import path from 'node:path';
import {once} from 'node:events';
import {chromium,selectors} from 'playwright';
import {createStaticServer} from '../../scripts/serve.mjs';
import {verifyArtifact,gitSource,sha256} from '../../scripts/lib/release-artifact.mjs';
import {detectionPostprocessFixture} from '../detection-postprocess-fixture.mjs';
import {referenceContractFixture} from '../reference-contract-fixture.mjs';
import {parseModel} from '../../src/model-engine.js';
import {registerDOMReader,desktopDOMReader} from './desktop-dom-reader.mjs';
assert.equal(process.platform,'win32');assert.ok(process.argv.includes('--allow-local-browser'));
const [build,output]=process.argv.slice(2).filter(v=>!v.startsWith('--'));assert.ok(build&&output);const source=gitSource();assert.equal(source.dirty,false);
const artifact=await verifyArtifact(build,{requireClean:true,expectedCommit:source.commit,publicOnly:false}),internal=artifact.release.distribution==='internal';assert.ok(internal||artifact.release.distribution==='public');
const directory=path.resolve(output);await mkdir(directory);const metadata=JSON.parse(await readFile(new URL('../../vendor/netron/tflite-metadata.json',import.meta.url),'utf8')),parse=b=>parseModel((o,n)=>b.subarray(o,o+n),b.length,metadata);
const cases=[{name:'public-known',fixture:detectionPostprocessFixture(),node:0,mode:'custom-contract'},{name:'unknown-version',fixture:detectionPostprocessFixture({version:2}),node:0,mode:'custom-opaque'},{name:'synthetic-private',fixture:await referenceContractFixture(),node:1,mode:internal?'custom-contract':'custom-opaque'}];
for(const c of cases){c.path=path.join(directory,c.name+'.tflite');c.bytes=new Uint8Array(await c.fixture.blob.arrayBuffer());await writeFile(c.path,c.bytes,{flag:'wx'});}
await registerDOMReader(selectors);const server=createStaticServer(path.resolve(build));server.listen(0,'127.0.0.1');await once(server,'listening');const base=`http://127.0.0.1:${server.address().port}/`;
const report={format:'model-lens-custom-references-windows',source,release:artifact.release,status:'failed',scope:'Real installed Windows Chrome/Edge,synthetic known/unknown/custom-profile models,native chooser/search/pattern/export/reopen/report at1280x640/32px. No custom runtime or private kernel execution.',browsers:[]};
try{
    for(const channel of ['chrome','msedge']){
        const row={channel,status:'failed',errors:[],workers:[],runtimeRequests:[],cases:[]};report.browsers.push(row);let browser,context,page;
        try{
            browser=await chromium.launch({channel,headless:true});row.version=browser.version();context=await browser.newContext({acceptDownloads:true,viewport:{width:1280,height:640}});await context.route('**/*',r=>new URL(r.request().url()).origin===new URL(base).origin?r.continue():r.abort());
            page=await context.newPage();page.setDefaultTimeout(35000);const read=desktopDOMReader(page);page.on('pageerror',e=>row.errors.push(e.message));page.on('request',r=>{if(r.url().includes('/vendor/litert/'))row.runtimeRequests.push(r.url());});page.on('worker',w=>{const item={url:w.url(),closed:false};row.workers.push(item);w.on('close',()=>item.closed=true);});
            const until=async fn=>{const deadline=Date.now()+35000;while(!await read(fn)){assert.ok(Date.now()<deadline,'DOM timeout: '+fn);await new Promise(r=>setTimeout(r,50));}};
            const ready=()=>until(()=>document.querySelector('#model-tabs').getAttribute('aria-busy')==='false'&&document.querySelector('#loading-card').hidden&&document.querySelector('#target').getAttribute('aria-busy')==='false');
            const choose=async file=>{const event=page.waitForEvent('filechooser');await page.locator('#open-model').click();await(await event).setFiles(file);await ready();};
            const save=async(button,name)=>{const event=page.waitForEvent('download');await page.locator(button).click();const d=await event;assert.equal(await d.failure(),null);const target=path.join(directory,channel+'-'+name);await d.saveAs(target);await d.delete();const bytes=await readFile(target);return {target,bytes:new Uint8Array(bytes),sha256:sha256(bytes)};};
            await page.goto(base);await until(()=>document.querySelector('#application-startup').hidden&&!document.querySelector('#open-model').disabled);
            for(const c of cases){
                const detail={name:c.name,status:'failed',mode:c.mode};row.cases.push(detail);await choose(c.path);await page.locator('#layers-tab').click();await page.locator('#query').fill('#'+c.node);await until(()=>document.querySelector('#result-count').textContent==='1 筆結果');await page.locator('.result-item').click();await ready();await page.locator('#graph-font-size').selectOption('32');
                await until(()=>document.querySelector('#target').getAttribute('aria-busy')==='false'&&!!document.querySelector('#target .node[data-model-node] .node-item-type text')&&parseFloat(getComputedStyle(document.querySelector('#target .node[data-model-node] .node-item-type text')).fontSize)>=32);
                if(await page.locator('#pick-pattern').getAttribute('aria-pressed')!=='true')await page.locator('#pick-pattern').click();await page.locator(`#target .node[data-model-node="${c.node}"] .node-item-type`).click();await until(()=>document.querySelector('#capture-count').textContent.startsWith('已選取 1 個'));
                await page.locator('#preview-submodel').click();await until(()=>document.querySelector('#export-size-dialog').open);detail.preview=await page.locator('#export-size-description').textContent();assert.match(detail.preview,c.mode==='custom-contract'?/引用契約符合/:/不明引用/);assert.equal(await read(()=>document.documentElement.scrollWidth<=innerWidth),true);await page.screenshot({path:path.join(directory,channel+'-'+c.name+'-preview-32px.png')});await page.locator('#close-export-size').click();
                const patternName='Contract '+c.name;await page.locator('#capture-name').fill(patternName);await page.locator('#save-capture').click();await until(()=>document.querySelector('#result-count').textContent==='1 筆匹配路徑');await page.locator('.result-item').click();await ready();
                const cut=await save('#export-match',c.name+'-cut.tflite'),parsed=await parse(cut.bytes);assert.equal(parsed.raw.subgraphs[0].operators.length,1);assert.deepEqual([...parsed.raw.subgraphs[0].operators[0].custom_options],[...c.fixture.options]);
                assert.ok(c.mode==='custom-contract'?cut.bytes.length<65536:cut.bytes.length>512*1024);detail.download={bytes:cut.bytes.length,sha256:cut.sha256};detail.retainedPayloads=parsed.raw.buffers.map(b=>Number(b.size||0n));
                await page.locator('#export-report-button').click();await until(()=>document.querySelector('#export-report-dialog').open);const record=await save('#download-export-report',c.name+'-report.json'),json=JSON.parse(new TextDecoder().decode(record.bytes));assert.equal(json.preservation.referencePlan.mode,c.mode);assert.equal(json.checks.find(x=>x.id==='runtime-load').status,'not-run');detail.referencePlan=json.preservation.referencePlan;await page.locator('#close-export-report').click();
                await page.locator('#open-export-model').click();await ready();await page.locator('#patterns-tab').click();await page.locator('#saved-pattern').selectOption({label:patternName});await until(()=>document.querySelector('#result-count').textContent==='1 筆匹配路徑');await page.locator('.result-item').click();
                await until(()=>document.querySelector('#target').getAttribute('aria-busy')==='false'&&!!document.querySelector('#target .node[data-model-node="0"] .node-item-type text'));
                detail.reopenedPattern=1;detail.layout=await read(()=>{const h=document.querySelector('#target .node[data-model-node="0"] .node-item-type'),text=h.querySelector('text').getBoundingClientRect(),frame=h.querySelector('path,rect').getBoundingClientRect();return {font:document.querySelector('#graph-font-size').value,documentWidth:document.documentElement.scrollWidth,text:{left:text.left,right:text.right},frame:{left:frame.left,right:frame.right}};});assert.equal(detail.layout.font,'32');assert.ok(detail.layout.documentWidth<=1280&&detail.layout.text.left>=detail.layout.frame.left-2&&detail.layout.text.right<=detail.layout.frame.right+2);await page.screenshot({path:path.join(directory,channel+'-'+c.name+'-reopened-32px.png')});detail.status='passed';
            }
            assert.deepEqual(row.runtimeRequests,[]);await context.close();context=null;await browser.close();browser=null;assert.deepEqual(row.errors,[]);assert.ok(row.workers.length&&row.workers.every(w=>w.closed));row.status='passed';
        }catch(error){row.error=error.stack||String(error);if(page&&!page.isClosed())await page.screenshot({path:path.join(directory,channel+'-failure.png')}).catch(()=>{});throw error;}
        finally{await context?.close();await browser?.close();}
    }
    assert.deepEqual(gitSource(),source);report.status='passed';
}catch(error){report.error=error.stack||String(error);process.exitCode=1;}
finally{await new Promise(r=>server.close(r));await writeFile(path.join(directory,'report.json'),JSON.stringify(report,null,2)+'\n',{flag:'wx'});console.log(JSON.stringify({status:report.status,browsers:report.browsers.map(b=>({channel:b.channel,status:b.status,error:b.error})),error:report.error}));}
