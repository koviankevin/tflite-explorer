// Exercise the real 20-record limit through native UI in an isolated hosted
// profile. No IndexedDB injection, quota override, application API or DOM writes.
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import path from 'node:path';
import {parseWorkspace} from '../../src/workspace.js';
import {sha256} from '../../scripts/lib/release-artifact.mjs';
import {chromiumRuntimeDOMReader} from './runtime-module-cold-flow.mjs';

export async function workspaceStorageFlow({browser,base,modelFile,directory}){
    assert.equal(process.env.GITHUB_ACTIONS,'true');assert.equal(process.platform,'linux');
    const report={format:'model-lens-workspace-storage',version:1,status:'failed',cases:[],workers:[],errors:[],downloads:[]};
    let context,closed=false,page,read;
    try{
        context=await browser.newContext({viewport:{width:1280,height:640},acceptDownloads:true});
        await context.route('**/*',async route=>{
            const r=route.request(),u=new URL(r.url());
            if(['blob:','data:'].includes(u.protocol)||r.method()==='GET'&&r.url().startsWith(base))await route.continue();
            else{report.errors.push('Unexpected network request');await route.abort();}
        });
        page=await context.newPage();page.setDefaultTimeout(30000);read=await chromiumRuntimeDOMReader(page,context);
        page.on('pageerror',e=>report.errors.push(e.message));page.on('crash',()=>report.errors.push('Page crash'));
        page.on('worker',worker=>{const row={url:worker.url(),closed:false};report.workers.push(row);worker.on('close',()=>{row.closed=true;});});
        const until=async fn=>{const end=Date.now()+30000;while(!await read(fn)){assert.ok(Date.now()<end,'Workspace storage UI timeout: '+fn);await page.waitForTimeout(50);}};
        const ready=()=>until(()=>document.querySelector('#model-tabs').getAttribute('aria-busy')==='false'&&document.querySelector('#loading-card').hidden&&document.querySelector('#target').getAttribute('aria-busy')==='false');
        const choose=async()=>{const event=page.waitForEvent('filechooser');await page.locator('#open-model').click();const chooser=await event,handle=chooser.element();try{await chooser.setFiles(modelFile);}finally{await handle.dispose();}await ready();};
        const saved=()=>until(()=>document.querySelector('#draft-status').textContent.startsWith('已自動儲存'));
        const manager=async()=>{await page.locator('#open-drafts').click();await until(()=>document.querySelector('#draft-dialog').open&&!document.querySelector('#draft-list').disabled);};
        const download=async label=>{
            const event=page.waitForEvent('download');await page.locator('#download-draft').click();const item=await event;
            assert.equal(await item.failure(),null);const target=path.join(directory,'storage-'+label+'.json');await item.saveAs(target);await item.delete();
            const bytes=await readFile(target);report.downloads.push({label,bytes:bytes.length,sha256:sha256(bytes)});return parseWorkspace(bytes.toString('utf8'));
        };
        await page.goto(base,{waitUntil:'domcontentloaded'});await until(()=>!document.querySelector('#autosave-enabled').disabled&&document.querySelector('#application-startup').hidden);
        for(let n=1;n<=20;n++){
            await choose();if(n>1)await page.locator('#fork-draft').click();await saved();
            assert.equal(await page.locator('#retry-workspace-save').isVisible(),false);
            await page.locator('#close-model').click();await until(()=>document.querySelector('#model-tabs').hidden);
        }
        await choose();await page.locator('#fork-draft').click();await until(()=>document.querySelector('#draft-status').dataset.error==='true');
        assert.match(await page.locator('#draft-status').textContent(),/20 份/);assert.equal(await page.locator('#retry-workspace-save').isEnabled(),true);
        await page.locator('#query').fill('#0');await until(()=>document.querySelector('#result-count').textContent==='1 筆結果');await page.locator('.result-item').click();await ready();
        await page.locator('#graph-font-size').selectOption('32');await ready();await page.locator('#pick-pattern').click();
        await page.locator('#target .node[data-model-node] .node-item-type').first().click();await until(()=>document.querySelector('#capture-count').textContent==='已選取 1 個 layers');
        await page.waitForTimeout(700);assert.equal(await page.locator('#draft-status').getAttribute('data-error'),'true');
        const state=()=>read(()=>({query:document.querySelector('#query').value,font:document.querySelector('#graph-font-size').value,capture:document.querySelector('#capture-count').textContent,box:document.querySelector('#target svg').getAttribute('viewBox'),width:document.querySelector('#target svg').style.width}));
        const before=await state(),bounds=await page.locator('.session-tools').boundingBox();
        assert.ok(bounds&&bounds.x>=0&&bounds.x+bounds.width<=1280&&bounds.y>=0&&bounds.y+bounds.height<=640);assert.ok(await read(()=>document.documentElement.scrollWidth<=1280));
        const png=await page.screenshot();assert.ok(png.length>0&&png.length<=512*1024);report.failureScreenshot={encoding:'base64',mime:'image/png',bytes:png.length,sha256:sha256(png),data:png.toString('base64')};
        await page.locator('#autosave-enabled').uncheck();assert.equal(await page.locator('#retry-workspace-save').isDisabled(),true);
        await page.locator('#autosave-enabled').check();assert.equal(await page.locator('#draft-status').getAttribute('data-error'),'true');
        await manager();assert.equal(await page.locator('#draft-list option').count(),20);const backup=await download('backup');
        await page.locator('#draft-dialog .draft-removal summary').click();await page.locator('#draft-remove-confirm').check();await page.locator('#remove-draft').click();
        await until(()=>!document.querySelector('#draft-list').disabled&&document.querySelector('#draft-list').options.length===19);await page.locator('#close-drafts').click();
        await page.locator('#retry-workspace-save').press('Enter');await saved();assert.equal(await page.locator('#retry-workspace-save').isVisible(),false);assert.equal(await page.locator('#draft-status').getAttribute('data-error'),'false');assert.deepEqual(await state(),before);
        await manager();assert.equal(await page.locator('#draft-list option').count(),20);const recovered=await download('retried');
        assert.equal(recovered.state.query,'#0');assert.equal(recovered.state.font,'32');assert.equal(recovered.state.selections.reduce((sum,s)=>sum+s.nodes.length,0),1);assert.deepEqual(recovered.identity,backup.identity);
        await page.locator('#close-drafts').click();report.cases.push('20 committed records; the 21st fails visibly, editing and selection survive, pause disables retry, a native JSON backup and explicit removal free one slot, Enter retry commits the latest state without changing the graph');
        await page.reload({waitUntil:'domcontentloaded'});await until(()=>!document.querySelector('#autosave-enabled').disabled&&document.querySelector('#application-startup').hidden);
        await choose();await manager();await page.locator('#restore-draft').click();await ready();await until(()=>document.querySelector('#capture-count').textContent==='已選取 1 個 layers');
        assert.equal(await page.locator('#query').inputValue(),'#0');assert.equal(await page.locator('#graph-font-size').inputValue(),'32');
        report.cases.push('after native reload and reselection of the original model, the retried committed draft restores query, 32px and selected OP');
        await context.close();closed=true;assert.deepEqual(report.errors,[]);assert.ok(report.workers.every(w=>w.closed));
        assert.equal(report.workers.filter(w=>/\/model-worker\.js(?:\?|$)/.test(w.url)).length,22);assert.equal(report.workers.filter(w=>/\/tflite-runtime-worker\.js(?:\?|$)/.test(w.url)).length,0);
        report.recordsBefore=20;report.recordsAfterRemoval=19;report.recordsAfterRetry=20;report.nativeChoosers=22;report.contextClosed=true;report.status='passed';return report;
    }catch(error){report.error=error.stack||String(error);throw Object.assign(error,{workspaceStorage:report});}
    finally{if(context&&!closed)await context.close();}
}
