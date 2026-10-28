// UI actions use real keys and native file choosers; CDP only observes the DOM.
// Called by the hosted, public-fixture-only production smoke driver.
import assert from 'node:assert/strict';
import {once} from 'node:events';
import {readFile,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {reusablePattern,exportPatterns,parsePatternFile} from '../../src/pattern-library.js';

export async function keyboardFlow({page,read,base,demo,directory,check,selectionTools=false}){
    let tabPresses=0;
    const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
    async function until(fn,...args){const end=Date.now()+30000;while(!await read(fn,...args)){if(Date.now()>end)throw Error('Keyboard DOM wait: '+fn);await pause(100);}}
    async function tabTo(selector){
        for(let i=0;i<160;i++){
            if(await read(s=>document.activeElement?.matches(s),selector))return;
            await page.keyboard.press('Tab');tabPresses++;
        }
        throw Error('Keyboard could not reach '+selector);
    }
    async function enter(selector){await tabTo(selector);await page.keyboard.press('Enter');}
    async function choose(filename,selector='#open-model'){
        await tabTo(selector);const event=page.waitForEvent('filechooser',{timeout:5000});await page.keyboard.press('Enter');await(await event).setFiles(filename);
    }
    async function ready(layers){await until(()=>document.querySelector('#model-tabs')?.getAttribute('aria-busy')!=='true'&&document.querySelector('#loading-card').hidden&&document.querySelector('#target').getAttribute('aria-busy')==='false'&&document.querySelector('#layer-count').textContent!=='—');assert.equal(await read(()=>document.querySelector('#layer-count').textContent),String(layers));}
    async function close(){
        const worker=page.workers().find(w=>/\/model-worker\.js(?:\?|$)/.test(w.url()));assert.ok(worker);await tabTo('#close-model');let timer;
        try{const ended=Promise.race([once(worker,'close'),new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('Keyboard model worker did not close.')),5000);})]);await page.keyboard.press('Enter');await ended;}finally{clearTimeout(timer);}
        assert.equal(await read(()=>document.querySelector('#model-file').files.length),0);
    }
    async function option(selector,value){
        const values=await read(s=>[...document.querySelector(s).options].map(o=>o.value),selector),index=values.indexOf(value);assert.ok(index>=0&&index<51);
        await tabTo(selector);await page.keyboard.press('Alt+ArrowDown');await page.keyboard.press('Home');for(let i=0;i<index;i++)await page.keyboard.press('ArrowDown');await page.keyboard.press('Enter');
        await until((s,v)=>document.querySelector(s).value===v,selector,value);
    }
    async function selectedTab(kind){assert.equal(await read(()=>document.activeElement?.dataset.kind),kind,'Arrow key must move focus to the new tab.');assert.equal(await read(k=>document.querySelector('[data-kind="'+k+'"]').getAttribute('aria-selected'),kind),'true');}
    async function switchTab(key,kind,activate='Enter'){
        const previous=await read(()=>document.querySelector('#explorer-panel [role="tab"][aria-selected="true"]').dataset.kind);await page.keyboard.press(key);
        assert.equal(await read(()=>document.activeElement?.dataset.kind),kind,'Arrow/Home/End must move tab focus.');
        assert.equal(await read(()=>document.querySelector('#explorer-panel [role="tab"][aria-selected="true"]').dataset.kind),previous,'Moving focus must not start another search.');await page.keyboard.press(activate);await selectedTab(kind);
    }
    async function cycleModal(dialog,first,last){
        await tabTo(first);await page.keyboard.press('Shift+Tab');assert.equal(await read(s=>document.activeElement?.matches(s),last),true,'Shift Tab must reach the last visible enabled modal control.');await page.keyboard.press('Tab');assert.equal(await read(s=>document.activeElement?.matches(s),first),true);
        for(const key of [...Array(10).fill('Tab'),...Array(10).fill('Shift+Tab')]){await page.keyboard.press(key);assert.equal(await read(s=>!!document.activeElement?.closest(s),dialog),true,'Modal Tab must stay inside the dialog.');}
    }

    // Enable Playwright's asynchronous chooser interception before navigation,
    // rather than toggling its subscription immediately before a trusted key.
    const intercept=()=>{};page.on('filechooser',intercept);
    try{
    await page.goto(base,{waitUntil:'domcontentloaded'});
    await until(()=>typeof document.querySelector('#open-model').onclick==='function'&&typeof document.querySelector('#autosave-enabled').onchange==='function'&&!document.querySelector('#autosave-enabled').disabled);
    await choose(demo);await ready(26);
    if(await read(()=>document.querySelector('#autosave-enabled').checked)){await tabTo('#autosave-enabled');await page.keyboard.press('Space');}
    await page.keyboard.press('Control+f');assert.equal(await read(()=>document.activeElement.id),'query');await page.keyboard.press('Control+a');await page.keyboard.type('#0');
    await until(()=>document.querySelector('#result-count').textContent==='1 筆結果');await enter('.result-item');await until(()=>document.querySelector('#target').getAttribute('aria-busy')==='false'&&document.querySelectorAll('#target .node').length>0);
    for(const size of ['16','32']){await option('#graph-font-size',size);await until(()=>document.querySelector('#target').getAttribute('aria-busy')==='false');assert.equal(await read(()=>document.activeElement.id),'graph-font-size','Graph redraw must retain keyboard control focus.');}
    await tabTo('[data-kind="layers"]');await switchTab('ArrowRight','tensors');await switchTab('ArrowRight','patterns','Space');await switchTab('Home','layers');await switchTab('End','patterns','Space');await switchTab('ArrowLeft','tensors');await switchTab('ArrowRight','patterns');
    assert.equal(await read(()=>[...document.querySelectorAll('#explorer-panel [role="tab"]')].filter(t=>t.tabIndex===0).length),1);
    assert.equal(await read(()=>{const t=document.activeElement,p=document.getElementById(t.getAttribute('aria-controls'));return p?.getAttribute('role')==='tabpanel'&&p.getAttribute('aria-labelledby')===t.id;}),true);
    await until(()=>document.querySelector('#result-count').textContent==='4 筆匹配路徑');
    check('keyboard native open, Ctrl F, result location, 32px and roving search tabs with labelled results');

    await tabTo('#pick-pattern');await page.keyboard.press('Space');assert.equal(await read(()=>document.querySelector('#pick-pattern').getAttribute('aria-pressed')),'true');
    await tabTo('#target .node[role="button"][aria-label^="選取 layer #0 "]');await page.keyboard.press('Space');await until(()=>document.querySelector('#capture-count').textContent==='已選取 1 個 layers');
    await enter('#open-import');await until(()=>document.querySelector('#import-dialog').open);
    await cycleModal('#import-dialog','#close-import','#cancel-import');
    await page.keyboard.press('Control+f');assert.equal(await read(()=>document.querySelector('[data-kind="patterns"]').getAttribute('aria-selected')),'true','Modal shortcut must not switch the hidden background tab.');
    for(let i=0;i<2&&await read(()=>document.querySelector('#import-dialog').open);i++)await page.keyboard.press('Escape');
    assert.equal(await read(()=>document.querySelector('#import-dialog').open),false);assert.equal(await read(()=>document.activeElement.id),'open-import');assert.equal(await read(()=>document.querySelector('#pick-pattern').getAttribute('aria-pressed')),'true');assert.equal(await read(()=>document.querySelector('#capture-count').textContent),'已選取 1 個 layers');
    await enter('#open-drafts');await until(()=>document.querySelector('#draft-dialog').open);await cycleModal('#draft-dialog','#close-drafts','.draft-removal>summary');await page.keyboard.press('Escape');await until(()=>!document.querySelector('#draft-dialog').open);assert.equal(await read(()=>document.activeElement.id),'open-drafts');
    await enter('#release-info-button');await until(()=>document.querySelector('#release-dialog').open&&document.querySelector('#release-fields dd'));await cycleModal('#release-dialog','#close-release-info','#open-diagnostics');await enter('#open-diagnostics');await until(()=>document.querySelector('#diagnostic-dialog').open&&!document.querySelector('#download-diagnostics').disabled);await cycleModal('#diagnostic-dialog','#close-diagnostics','#diagnostic-preview');await page.keyboard.press('Escape');await until(()=>!document.querySelector('#diagnostic-dialog').open);assert.equal(await read(()=>document.activeElement.id),'release-info-button');assert.equal(await read(()=>document.querySelector('#pick-pattern').getAttribute('aria-pressed')),'true');assert.equal(await read(()=>document.querySelector('#capture-count').textContent),'已選取 1 個 layers');
    for(const index of [1,2]){await tabTo('#target .node[role="button"][aria-label^="選取 layer #'+index+' "]');await page.keyboard.press('Space');}
    assert.equal(await read(()=>document.querySelector('#capture-count').textContent),'已選取 3 個 layers');await tabTo('#capture-name');await page.keyboard.press('Control+a');await page.keyboard.type('Keyboard captured RTR');
    if(selectionTools){
        const camera=await read(()=>({box:document.querySelector('#target svg').getAttribute('viewBox'),width:document.querySelector('#target svg').style.width}));
        await enter('#edit-capture');await until(()=>document.querySelector('#pick-pattern').getAttribute('aria-pressed')==='false'&&document.querySelectorAll('#graph-node-rows .graph-form-row').length===3);
        assert.equal(await read(()=>document.querySelectorAll('#graph-edge-rows .graph-form-row').length),2);
        assert.equal(await read(()=>[...document.querySelector('#saved-pattern').options].some(o=>o.value==='Keyboard captured RTR')),false,'Editing a selection must not save it automatically.');
        assert.deepEqual(await read(()=>({box:document.querySelector('#target svg').getAttribute('viewBox'),width:document.querySelector('#target svg').style.width})),camera,'Loading a query draft must not redraw the model.');
        await enter('#add-graph-node');await until(()=>document.querySelectorAll('#graph-node-rows .graph-form-row').length===4);await enter('button[aria-label="移除節點 N4"]');await until(()=>document.querySelectorAll('#graph-node-rows .graph-form-row').length===3);
        await enter('#add-graph-edge');await until(()=>document.querySelectorAll('#graph-edge-rows .graph-form-row').length===3);await enter('button[aria-label="移除連線 3"]');await until(()=>document.querySelectorAll('#graph-edge-rows .graph-form-row').length===2);
        assert.equal(await read(()=>document.querySelector('#layer-count').textContent),'26','Pattern edits must not modify the model.');
        await enter('#pick-pattern');assert.equal(await read(()=>document.querySelector('#capture-count').textContent),'已選取 3 個 layers');
        check('selected pattern opens an unsaved editable query; adding/removing query nodes and edges preserves model, camera and selection');
    }
    await enter('#save-capture');
    await until(()=>document.querySelector('#pick-pattern').getAttribute('aria-pressed')==='false'&&document.querySelector('#result-count').textContent==='4 筆匹配路徑');
    await tabTo('#export-pattern');const captureEvent=page.waitForEvent('download');await page.keyboard.press('Enter');const captureDownload=await captureEvent;assert.equal(await captureDownload.failure(),null);const captureFile=path.join(directory,'keyboard-captured-pattern.json');await captureDownload.saveAs(captureFile);await captureDownload.delete();const captured=parsePatternFile(await readFile(captureFile,'utf8'));assert.equal(captured.length,1);assert.equal(captured[0].name,'Keyboard captured RTR');assert.deepEqual(captured[0].nodes.map(n=>n.type),['Reshape','Transpose','Reshape']);assert.equal(captured[0].edges.length,2);
    check('modal focus and shortcut isolation preserve selection; keyboard adds layers and saves a searchable pattern');

    const pattern=reusablePattern('Keyboard acceptance RTR',{nodes:[{alias:'N1',type:'Reshape'},{alias:'N2',type:'Transpose'},{alias:'N3',type:'Reshape'}],edges:[{from:'N1',to:'N2'},{from:'N2',to:'N3'}],induced:true}),input=path.join(directory,'keyboard-pattern.json');await writeFile(input,exportPatterns([pattern]),{flag:'wx'});
    await enter('#open-import');await choose(input,'#choose-pattern-file');await until(()=>!document.querySelector('#confirm-import').disabled);await tabTo('#confirm-import');await page.keyboard.press('Tab');assert.equal(await read(()=>document.activeElement.id),'close-import');await page.keyboard.press('Shift+Tab');assert.equal(await read(()=>document.activeElement.id),'confirm-import');await page.keyboard.press('Enter');await until(()=>!document.querySelector('#import-dialog').open);
    await option('#saved-pattern',pattern.name);await until(()=>document.querySelector('#result-count').textContent==='4 筆匹配路徑');
    await tabTo('#export-pattern');let event=page.waitForEvent('download');await page.keyboard.press('Enter');let download=await event;assert.equal(await download.failure(),null);const exported=path.join(directory,'keyboard-pattern-export.json');await download.saveAs(exported);await download.delete();assert.deepEqual(parsePatternFile(await readFile(exported,'utf8')),[pattern]);
    check('keyboard native pattern import, saved selection, search and exact JSON export');

    await enter('.result-item');await until(()=>document.querySelector('#target').getAttribute('aria-busy')==='false');await tabTo('#export-match');event=page.waitForEvent('download');await page.keyboard.press('Enter');download=await event;assert.equal(await download.failure(),null);const child=path.join(directory,'keyboard-child.tflite');await download.saveAs(child);await download.delete();await enter('#export-report-button');await until(()=>document.querySelector('#export-report-dialog').open&&!document.querySelector('#download-export-report').disabled);await cycleModal('#export-report-dialog','#close-export-report','#download-export-report');await page.keyboard.press('Escape');await until(()=>!document.querySelector('#export-report-dialog').open);assert.equal(await read(()=>document.activeElement.id),'export-report-button');
    if(selectionTools){
        const worker=page.workers().find(w=>/\/model-worker\.js(?:\?|$)/.test(w.url()));assert.ok(worker);let timer;
        try{const ended=Promise.race([once(worker,'close'),new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('Direct reopen retained the original model worker.')),5000);})]);await enter('#open-export-model');await ended;}finally{clearTimeout(timer);}
        await ready(3);await until(()=>document.querySelector('#result-count').textContent==='1 筆匹配路徑');assert.equal(await read(()=>document.querySelector('#open-export-model').hidden&&document.querySelector('#open-export-model').disabled),true);
        assert.equal(await read(()=>document.querySelector('#model-file').files.length),0);
        check('direct local export reopen closes the previous worker, preserves the pattern and consumes the one-shot result');
    }
    await close();
    if(selectionTools)assert.equal(await read(()=>document.querySelector('#open-export-model').hidden&&document.querySelector('#open-export-model').disabled),true);
    event=page.waitForEvent('filechooser');await page.keyboard.press('Control+o');await(await event).setFiles(child);await ready(3);await until(()=>document.querySelector('#result-count').textContent==='1 筆匹配路徑');await enter('.result-item');await until(()=>document.querySelector('#target').getAttribute('aria-busy')==='false'&&document.querySelectorAll('#target .node').length>0);await close();
    check('keyboard child-model download, Ctrl O native reopen, original pattern match and worker closure');
    return {tabPresses,modelWorkers:selectionTools?3:2};
    }finally{page.off('filechooser',intercept);}
}
