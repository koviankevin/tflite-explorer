// Explicit opt-in isolated Windows acceptance; synthetic models only.
import assert from 'node:assert/strict';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {once} from 'node:events';
import {chromium,selectors} from 'playwright';
import {createStaticServer} from '../../scripts/serve.mjs';
import {verifyArtifact,gitSource,sha256} from '../../scripts/lib/release-artifact.mjs';
import {spatialFixture} from '../spatial-fixture.mjs';
import {runtimeFixture} from '../runtime-fixture.mjs';
import {FlatbufferWriter} from '../../src/flatbuffer-writer.js';
import {registerDOMReader,desktopDOMReader} from './desktop-dom-reader.mjs';
import {Archive} from '../../vendor/netron/zip.js';
assert.equal(process.platform,'win32');assert.ok(process.argv.includes('--allow-local-browser'));
const [build,output]=process.argv.slice(2).filter(v=>!v.startsWith('--'));assert.ok(build&&output);
const source=gitSource();assert.equal(source.dirty,false);const artifact=await verifyArtifact(build,{requireClean:true,expectedCommit:source.commit,publicOnly:true});
const directory=path.resolve(output);await mkdir(directory);
const fixtures={bad:spatialFixture('CONV_2D',{input:[1,3,3,2],filter:[1,2,2,3]}),valid:spatialFixture('CONV_2D')};
const absent=await runtimeFixture();absent.model.buffers.push({data:null,offset:0n,size:0n});for(const t of absent.model.subgraphs[0].tensors)t.buffer=1;
fixtures.absent={blob:new FlatbufferWriter().finish(absent.model,new Blob())};
const files={};for(const [key,f]of Object.entries(fixtures)){files[key]=path.join(directory,key+'.tflite');await writeFile(files[key],new Uint8Array(await f.blob.arrayBuffer()),{flag:'wx'});}
await registerDOMReader(selectors);const server=createStaticServer(path.resolve(build));server.listen(0,'127.0.0.1');await once(server,'listening');const base=`http://127.0.0.1:${server.address().port}/`;
const report={format:'model-lens-product-next-windows',source,release:artifact.release,status:'failed',browsers:[],scope:'Synthetic spatial fixtures, real manual CPU runtime and native navigation in isolated installed Windows Chrome/Edge,1280x640/32px. Not Windows large-model RSS or private model verification.'};
try{
    for(const channel of ['chrome','msedge']){
        const row={channel,status:'failed',workers:[],errors:[],cases:[]};report.browsers.push(row);let browser,context,page;
        try{
            browser=await chromium.launch({channel,headless:true});row.version=browser.version();context=await browser.newContext({acceptDownloads:true,viewport:{width:1280,height:640}});
            await context.route('**/*',route=>new URL(route.request().url()).origin===new URL(base).origin?route.continue():route.abort());
            page=await context.newPage();page.setDefaultTimeout(35000);page.on('pageerror',e=>row.errors.push(e.message));page.on('worker',w=>{const item={url:w.url(),closed:false};row.workers.push(item);w.on('close',()=>item.closed=true);});const read=desktopDOMReader(page);
            const until=async fn=>{const deadline=Date.now()+35000;while(!await read(fn)){assert.ok(Date.now()<deadline,'DOM timeout: '+fn);await new Promise(r=>setTimeout(r,50));}};
            const ready=()=>until(()=>document.querySelector('#model-tabs').getAttribute('aria-busy')==='false'&&document.querySelector('#loading-card').hidden&&document.querySelector('#target').getAttribute('aria-busy')==='false');
            const choose=async file=>{const event=page.waitForEvent('filechooser');await page.locator('#open-model').click();await(await event).setFiles(file);await ready();};
            const run=async status=>{await page.locator('#run-mode').click();await page.locator('#edit-runtime-check').click();await until(()=>document.querySelector('#edit-runtime-dialog').open);await page.locator('#edit-runtime-run').click();await until(()=>document.querySelector('#run-workspace').getAttribute('aria-busy')==='false'&&!!document.querySelector('#edit-runtime-result').dataset.status);assert.equal(await page.locator('#edit-runtime-result').getAttribute('data-status'),status);};
            const save=async(button,name)=>{const event=page.waitForEvent('download');await page.locator(button).click();const d=await event;assert.equal(await d.failure(),null);const target=path.join(directory,channel+'-'+name);await d.saveAs(target);await d.delete();const raw=await readFile(target);(row.exports??=[]).push({name,bytes:raw.length,sha256:sha256(raw)});return target;};
            await page.goto(base);await until(()=>document.querySelector('#application-startup').hidden&&!document.querySelector('#open-model').disabled);await choose(files.bad);await page.locator('#graph-font-size').selectOption('32');await ready();await run('failed');
            row.failure=await page.locator('#edit-runtime-result').textContent();assert.match(row.failure,/Failed to allocate tensors/);assert.match(row.failure,/Node number 0 \(CONV_2D\)/);assert.match(row.failure,/Subgraph #0 · OP #0.*inputs \[0, 1, 2\]/);
            assert.equal(await page.locator('[data-runtime-locate="0:0"]').count(),1);assert.equal(await read(()=>document.documentElement.scrollWidth<=innerWidth),true);
            row.locationLayout=await read(()=>{const b=document.querySelector('[data-runtime-locate]'),r=b.getBoundingClientRect(),p=b.parentElement.getBoundingClientRect();return {font:parseFloat(getComputedStyle(b).fontSize),height:r.height,width:r.width,parentWidth:p.width};});
            assert.ok(row.locationLayout.font>=14&&row.locationLayout.height>=36&&row.locationLayout.width<=row.locationLayout.parentWidth);await page.screenshot({path:path.join(directory,channel+'-failure-32px.png')});
            const event=page.waitForEvent('download');await page.locator('#edit-runtime-download').click();const download=await event;assert.equal(await download.failure(),null);const file=path.join(directory,channel+'-failure-io.zip');await download.saveAs(file);await download.delete();const raw=await readFile(file),zip=Archive.open(new Uint8Array(raw),'zip');
            const record=JSON.parse(new TextDecoder().decode(zip.entries.get('manifest.json').peek())).validation;assert.equal(record.failureKind,'tensor-allocation');assert.equal(record.failureLocations[0].node,0);row.failureIO={bytes:raw.length,sha256:sha256(raw),failureKind:record.failureKind,locations:record.failureLocations};
            await page.locator('[data-runtime-locate="0:0"]').click();await ready();assert.equal(await page.locator('#query').inputValue(),'#0');assert.equal(await page.locator('#graph-select').inputValue(),'0');assert.equal(await page.locator('#run-workspace').isHidden(),true);assert.equal(await page.locator('#result-count').textContent(),'1 筆結果');assert.equal(await page.locator('#graph-font-size').inputValue(),'32');await page.screenshot({path:path.join(directory,channel+'-located-32px.png')});
            row.cases.push('native chooser and true invalid-channel CPU allocation failure,raw diagnostics, bounded OP/tensor candidates,real IO ZIP and graph location at32px');
            await choose(files.valid);await page.locator('#run-mode').click();assert.equal(await page.locator('[data-runtime-locate]').count(),0);assert.equal(await page.locator('#edit-runtime-result').getAttribute('data-status'),null);await run('passed');assert.equal(await page.locator('[data-runtime-locate]').count(),0);row.cases.push('switching model drops old diagnostic locations and valid model still invokes');
            await choose(files.absent);const parentTab=(await page.locator('#model-tabs [role="tab"]').count())-1;await run('passed');await page.locator('#explore-mode').click();await ready();await page.locator('#pick-pattern').click();await page.locator('#target .node[data-model-node] .node-item-type').first().click();await until(()=>document.querySelector('#capture-count').textContent.startsWith('已選取 1 個'));
            await save('#export-submodel','absent-cut.tflite');await page.locator('#open-export-model').click();await ready();await run('passed');await page.locator('#model-tabs [role="tab"]').nth(parentTab).click();await ready();await page.locator('#edit-mode').click();await until(()=>document.querySelector('#edit-workspace').getAttribute('aria-busy')==='false');await page.locator('#edit-font').selectOption('32');await page.locator('[data-edit-node="op:0:0"] .edit-node-title').click();await page.locator('#edit-add-after').click();await until(()=>document.querySelectorAll('.edit-node.added').length===1);await page.locator('#edit-expose').check();await save('#edit-export','absent-edited.tflite');await until(()=>!document.querySelector('#edit-open-result').disabled);await page.locator('#edit-open-result').click();await ready();await run('passed');
            row.cases.push('nonzero absent-data runtime buffers remain executable after native cut/reopen and32px clone/edit/export/reopen');
            await context.close();context=null;await browser.close();browser=null;assert.ok(row.workers.length>0&&row.workers.every(w=>w.closed));assert.deepEqual(row.errors,[]);row.status='passed';
        }catch(error){row.error=error.stack||String(error);if(page&&!page.isClosed())await page.screenshot({path:path.join(directory,channel+'-error.png')}).catch(()=>{});throw error;}
        finally{await context?.close();await browser?.close();}
    }
    assert.deepEqual(gitSource(),source);report.status='passed';
}catch(error){report.error=error.stack||String(error);process.exitCode=1;}
finally{await new Promise(r=>server.close(r));await writeFile(path.join(directory,'report.json'),JSON.stringify(report,null,2)+'\n',{flag:'wx'});console.log(JSON.stringify({status:report.status,browsers:report.browsers.map(b=>({channel:b.channel,status:b.status,error:b.error})),error:report.error}));}
