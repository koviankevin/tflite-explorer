// Opt-in actual Windows Chrome/Edge acceptance. Never uses a personal profile,
// never installs browsers, and never changes browser-wide security settings.
import assert from 'node:assert/strict';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {once} from 'node:events';
import {chromium,selectors} from 'playwright';
import {createStaticServer} from '../../scripts/serve.mjs';
import {verifyArtifact,gitSource,sha256} from '../../scripts/lib/release-artifact.mjs';
import {customFixture} from '../custom-fixture.mjs';
import {parseModel} from '../../src/model-engine.js';
import {parseEditSession} from '../../src/model-edit-session.js';
import {parseWorkspace} from '../../src/workspace.js';
import {registerDOMReader,desktopDOMReader} from './desktop-dom-reader.mjs';
assert.equal(process.platform,'win32');
assert.ok(process.argv.includes('--allow-local-browser'),'Requires explicit approval for isolated local browser acceptance.');
const [build,output]=process.argv.slice(2).filter(a=>!a.startsWith('--'));assert.ok(build&&output);
const source=gitSource();assert.equal(source.dirty,false);const artifact=await verifyArtifact(build,{requireClean:true,expectedCommit:source.commit,publicOnly:true});
const directory=path.resolve(output);await mkdir(directory);const fixture=await customFixture(),original=path.join(directory,'public-custom.tflite');await writeFile(original,fixture.bytes,{flag:'wx'});
const metadata=JSON.parse(await readFile(new URL('../../vendor/netron/tflite-metadata.json',import.meta.url),'utf8'));
const originalIndex=await parseModel((o,n)=>fixture.bytes.subarray(o,o+n),fixture.bytes.length,metadata),originalLayers=originalIndex.graphs[0].graph.nodes.length;
await registerDOMReader(selectors);
const server=createStaticServer(path.resolve(build));server.listen(0,'127.0.0.1');await once(server,'listening');const base=`http://127.0.0.1:${server.address().port}/`;
const report={format:'model-lens-windows-acceptance',source,build:artifact.release,platform:process.platform,status:'failed',browsers:[],scope:'Actual installed Windows Chrome/Edge, isolated temporary contexts, public synthetic data. Not OS power-loss, physical-disk exhaustion, or permission-settings acceptance.'};
try{
    for(const channel of ['chrome','msedge']){
        const row={channel,status:'failed',cases:[],errors:[],workers:[],downloads:[]};report.browsers.push(row);
        let browser,context,page;
        try{
            browser=await chromium.launch({channel,headless:true});row.version=browser.version();context=await browser.newContext({acceptDownloads:true,viewport:{width:1280,height:640}});
            await context.route('**/*',route=>new URL(route.request().url()).origin===new URL(base).origin?route.continue():route.abort());
            const track=p=>{p.setDefaultTimeout(30000);p.on('pageerror',e=>row.errors.push(e.message));p.on('worker',w=>{const entry={url:w.url(),closed:false};row.workers.push(entry);w.on('close',()=>entry.closed=true);});};
            page=await context.newPage();track(page);let read=desktopDOMReader(page);
            const until=async fn=>{const end=Date.now()+30000;while(!await read(fn)){assert.ok(Date.now()<end,'Windows acceptance timeout: '+fn);await new Promise(r=>setTimeout(r,50));}};
            const ready=()=>until(()=>document.querySelector('#model-tabs').getAttribute('aria-busy')==='false'&&document.querySelector('#loading-card').hidden&&document.querySelector('#target').getAttribute('aria-busy')==='false');
            const choose=async()=>{const event=page.waitForEvent('filechooser');await page.locator('#open-model').click();await(await event).setFiles(original);await ready();};
            const download=async(button,name)=>{const event=page.waitForEvent('download');await page.locator(button).click();const d=await event;assert.equal(await d.failure(),null);const target=path.join(directory,channel+'-'+name);await d.saveAs(target);await d.delete();const b=await readFile(target);row.downloads.push({name,bytes:b.length,sha256:sha256(b)});return {target,bytes:b};};
            await page.goto(base);await until(()=>document.querySelector('#application-startup').hidden&&!document.querySelector('#open-model').disabled);await choose();
            await page.locator('#query').fill('#0');await until(()=>document.querySelector('#result-count').textContent==='1 筆結果');await page.locator('.result-item').click();await ready();
            await page.locator('#graph-font-size').selectOption('32');await ready();await page.locator('#pick-pattern').click();
            await page.locator('#target .node[data-model-node] .node-item-type').first().click();await until(()=>document.querySelector('#capture-count').textContent.startsWith('已選取 1 個'));
            await page.locator('#preview-submodel').click();await until(()=>document.querySelector('#export-size-dialog').open);assert.match(await page.locator('#export-size-description').textContent(),/buffer/);await page.locator('#close-export-size').click();
            const sub=await download('#export-submodel','submodel.tflite'),parsed=await parseModel((o,n)=>sub.bytes.subarray(o,o+n),sub.bytes.length,metadata);assert.equal(parsed.graphs[0].graph.nodes.length,1);
            await page.locator('#open-export-model').click();await ready();assert.equal(await page.locator('#model-tabs [role="tab"]').count(),2);await page.locator('#model-tabs [role="tab"]').first().click();await ready();
            row.cases.push('native original chooser, search/location,32px, size preview, submodel download/reparse and separate model tab');
            await page.locator('#cancel-capture').click();await page.locator('#edit-mode').click();await until(()=>document.body.classList.contains('editing-model')&&document.querySelector('#edit-workspace').getAttribute('aria-busy')==='false');
            await page.locator('#edit-font').selectOption('32');await page.locator('[data-edit-node="op:0:0"] .edit-node-title').click();await page.locator('#edit-add-after').click();await until(()=>document.querySelectorAll('.edit-node.added').length===1);
            await page.locator('[data-edit-output="new:1:out:0"]').click();await page.locator('[data-edit-input="op:0:1"][data-edit-slot="0"]').click();
            const draft=await download('#save-edit-draft','edit-draft.json');assert.ok(parseEditSession(draft.bytes.toString('utf8')).history.commands.length>=2);
            const edited=await download('#edit-export','edited.tflite'),editedIndex=await parseModel((o,n)=>edited.bytes.subarray(o,o+n),edited.bytes.length,metadata);assert.equal(editedIndex.graphs[0].graph.nodes.length,originalLayers+1);
            await page.locator('#edit-open-result').click();await ready();row.cases.push('32px real port clicks, clone/rewire, portable draft JSON and edited model download/reopen');
            await page.close();page=await context.newPage();track(page);read=desktopDOMReader(page);await page.goto(base);await until(()=>document.querySelector('#application-startup').hidden&&!document.querySelector('#open-model').disabled);await choose();
            await page.locator('#open-edit-draft').click();const draftChooser=page.waitForEvent('filechooser');await page.locator('#choose-edit-draft-file').click();await(await draftChooser).setFiles(draft.target);
            await until(()=>!document.querySelector('#edit-draft-banner').hidden);const sourceChooser=page.waitForEvent('filechooser');await page.locator('#choose-edit-draft-model').click();await(await sourceChooser).setFiles(original);
            await until(()=>document.body.classList.contains('editing-model')&&document.querySelectorAll('.edit-node.added').length===1&&document.querySelector('#edit-workspace').getAttribute('aria-busy')==='false');
            assert.equal(await page.locator('#edit-font').inputValue(),'32');await page.locator('#edit-undo').click();await page.locator('#edit-redo').click();const resumed=await download('#edit-export','resumed.tflite');assert.equal(sha256(resumed.bytes),sha256(edited.bytes));row.cases.push('native JSON import and original-model reselection after a fresh page; view/history restored, Undo/Redo and identical re-export');
            row.editLayout=await read(()=>{const v=document.querySelector('#edit-viewport').getBoundingClientRect();return {font:document.querySelector('#edit-font').value,width:innerWidth,documentWidth:document.documentElement.scrollWidth,visibleHeight:Math.min(v.bottom,innerHeight)-Math.max(v.top,0)};});assert.equal(row.editLayout.font,'32');assert.ok(row.editLayout.documentWidth<=1280&&row.editLayout.visibleHeight>=200);await page.screenshot({path:path.join(directory,channel+'-edit-32px.png')});
            await context.close();context=await browser.newContext({acceptDownloads:true,viewport:{width:1280,height:640}});await context.route('**/*',route=>new URL(route.request().url()).origin===new URL(base).origin?route.continue():route.abort());page=await context.newPage();track(page);read=desktopDOMReader(page);
            const cdp=await context.newCDPSession(page),origin=new URL(base).origin;await cdp.send('Storage.overrideQuotaForOrigin',{origin,quotaSize:1});
            row.quota=await cdp.send('Storage.getUsageAndQuota',{origin});assert.equal(row.quota.quota,1);
            await page.goto(base);await until(()=>document.querySelector('#application-startup').hidden&&!document.querySelector('#open-model').disabled);await choose();await page.locator('#graph-font-size').selectOption('32');await ready();const unsavedQuery='#0';await page.locator('#query').fill(unsavedQuery);await until(()=>document.querySelector('#draft-status').dataset.error==='true');row.quotaFailure=await page.locator('#draft-status').textContent();assert.match(row.quotaFailure,/儲存配額不足/);assert.equal(await page.locator('#graph-font-size').inputValue(),'32');assert.equal(await read(()=>document.documentElement.scrollWidth<=innerWidth),true);await page.screenshot({path:path.join(directory,channel+'-quota-32px.png')});
            const backup=await download('#save-workspace','workspace.json');assert.equal(parseWorkspace(backup.bytes.toString('utf8')).state.query,unsavedQuery);
            await cdp.send('Storage.overrideQuotaForOrigin',{origin});await page.locator('#retry-workspace-save').click();await until(()=>document.querySelector('#draft-status').textContent.startsWith('已自動儲存'));assert.equal(await page.locator('#query').inputValue(),unsavedQuery);
            await cdp.send('Storage.clearDataForOrigin',{origin,storageTypes:'indexeddb'});await page.locator('#query').fill('#1');await until(()=>/另一分頁|無法|未儲存|不同版本|缺少/.test(document.querySelector('#draft-status').textContent));assert.equal(await page.locator('#query').inputValue(),'#1');
            await page.locator('#fork-draft').click();await until(()=>document.querySelector('#draft-status').textContent.startsWith('已自動儲存'));assert.equal(await page.locator('#query').inputValue(),'#1');
            row.cases.push('real browser quota rejection, backup, quota restored/retry, isolated-origin IndexedDB removal, state retained and explicit new draft');
            assert.equal(await read(()=>document.documentElement.scrollWidth<=innerWidth),true);await page.screenshot({path:path.join(directory,channel+'-storage-recovered.png')});
            await context.close();context=null;await browser.close();browser=null;assert.deepEqual(row.errors,[]);assert.ok(row.workers.every(w=>w.closed));row.status='passed';
        }catch(error){row.error=error.stack||String(error);if(page&&!page.isClosed())try{row.failureDOM=await desktopDOMReader(page)(()=>({mode:document.body.className,dialogs:Array.from(document.querySelectorAll('dialog[open]'),e=>e.id),notice:document.querySelector('#notice')?.textContent,edit:document.querySelector('#edit-message')?.textContent,draft:document.querySelector('#draft-status')?.textContent,banner:document.querySelector('#edit-draft-hint')?.textContent}));await page.screenshot({path:path.join(directory,channel+'-failure.png')});}catch{}throw error;}
        finally{await context?.close();await browser?.close();}
    }
    assert.deepEqual(gitSource(),source);report.status='passed';
}catch(error){report.error=error.stack||String(error);process.exitCode=1;}
finally{await new Promise(r=>server.close(r));await writeFile(path.join(directory,'report.json'),JSON.stringify(report,null,2)+'\n',{flag:'wx'});console.log(JSON.stringify({status:report.status,browsers:report.browsers.map(b=>({channel:b.channel,status:b.status,error:b.error})),error:report.error}));}
