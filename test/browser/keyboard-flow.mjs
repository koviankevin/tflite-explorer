// UI actions use real keys and native file choosers; CDP only observes the DOM.
// Called by the hosted, public-fixture-only production smoke driver.
import assert from 'node:assert/strict';
import {once} from 'node:events';
import {readFile,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {reusablePattern,exportPatterns,parsePatternFile} from '../../src/pattern-library.js';

export async function keyboardFlow({page,read,base,demo,directory,check}){
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
    async function ready(layers){await until(()=>document.querySelector('#loading-card').hidden&&document.querySelector('#target').getAttribute('aria-busy')==='false'&&document.querySelector('#layer-count').textContent!=='—');assert.equal(await read(()=>document.querySelector('#layer-count').textContent),String(layers));}
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
        const previous=await read(()=>document.querySelector('[role="tab"][aria-selected="true"]').dataset.kind);await page.keyboard.press(key);
        assert.equal(await read(()=>document.activeElement?.dataset.kind),kind,'Arrow/Home/End must move tab focus.');
        assert.equal(await read(()=>document.querySelector('[role="tab"][aria-selected="true"]').dataset.kind),previous,'Moving focus must not start another search.');await page.keyboard.press(activate);await selectedTab(kind);
    }

    // Enable Playwright's asynchronous chooser interception before navigation,
    // rather than toggling its subscription immediately before a trusted key.
    const intercept=()=>{};page.on('filechooser',intercept);
    try{
    await page.goto(base,{waitUntil:'domcontentloaded'});
    await until(()=>typeof document.querySelector('#open-model').onclick==='function');
    await choose(demo);await ready(26);
    if(await read(()=>document.querySelector('#autosave-enabled').checked)){await tabTo('#autosave-enabled');await page.keyboard.press('Space');}
    await page.keyboard.press('Control+f');assert.equal(await read(()=>document.activeElement.id),'query');await page.keyboard.press('Control+a');await page.keyboard.type('#0');
    await until(()=>document.querySelector('#result-count').textContent==='1 筆結果');await enter('.result-item');await until(()=>document.querySelector('#target').getAttribute('aria-busy')==='false'&&document.querySelectorAll('#target .node').length>0);
    await option('#graph-font-size','16');await option('#graph-font-size','32');await until(()=>document.querySelector('#target').getAttribute('aria-busy')==='false');
    await tabTo('[data-kind="layers"]');await switchTab('ArrowRight','tensors');await switchTab('ArrowRight','patterns','Space');await switchTab('Home','layers');await switchTab('End','patterns','Space');await switchTab('ArrowLeft','tensors');await switchTab('ArrowRight','patterns');
    assert.equal(await read(()=>[...document.querySelectorAll('[role="tab"]')].filter(t=>t.tabIndex===0).length),1);
    assert.equal(await read(()=>{const t=document.activeElement,p=document.getElementById(t.getAttribute('aria-controls'));return p?.getAttribute('role')==='tabpanel'&&p.getAttribute('aria-labelledby')===t.id;}),true);
    await until(()=>document.querySelector('#result-count').textContent==='4 筆匹配路徑');
    check('keyboard native open, Ctrl F, result location, 32px and roving search tabs with labelled results');

    await tabTo('#pick-pattern');await page.keyboard.press('Space');assert.equal(await read(()=>document.querySelector('#pick-pattern').getAttribute('aria-pressed')),'true');
    await tabTo('#target .node[role="button"][tabindex="0"]');await page.keyboard.press('Space');await until(()=>document.querySelector('#capture-count').textContent==='已選取 1 個 layers');
    await enter('#open-import');await until(()=>document.querySelector('#import-dialog').open);
    for(const key of [...Array(10).fill('Tab'),...Array(10).fill('Shift+Tab')]){await page.keyboard.press(key);assert.equal(await read(()=>!!document.activeElement?.closest('#import-dialog')),true,'Modal Tab must stay inside the dialog.');}
    await page.keyboard.press('Control+f');assert.equal(await read(()=>document.querySelector('[data-kind="patterns"]').getAttribute('aria-selected')),'true','Modal shortcut must not switch the hidden background tab.');
    for(let i=0;i<2&&await read(()=>document.querySelector('#import-dialog').open);i++)await page.keyboard.press('Escape');
    assert.equal(await read(()=>document.querySelector('#import-dialog').open),false);assert.equal(await read(()=>document.activeElement.id),'open-import');assert.equal(await read(()=>document.querySelector('#pick-pattern').getAttribute('aria-pressed')),'true');assert.equal(await read(()=>document.querySelector('#capture-count').textContent),'已選取 1 個 layers');
    await enter('#cancel-capture');
    check('modal Tab containment, shortcut isolation, Escape focus return and retained selected layer');

    const pattern=reusablePattern('Keyboard acceptance RTR',{nodes:[{alias:'N1',type:'Reshape'},{alias:'N2',type:'Transpose'},{alias:'N3',type:'Reshape'}],edges:[{from:'N1',to:'N2'},{from:'N2',to:'N3'}],induced:true}),input=path.join(directory,'keyboard-pattern.json');await writeFile(input,exportPatterns([pattern]),{flag:'wx'});
    await enter('#open-import');await choose(input,'#choose-pattern-file');await until(()=>!document.querySelector('#confirm-import').disabled);await enter('#confirm-import');await until(()=>!document.querySelector('#import-dialog').open);
    await option('#saved-pattern',pattern.name);await until(()=>document.querySelector('#result-count').textContent==='4 筆匹配路徑');
    await tabTo('#export-pattern');let event=page.waitForEvent('download');await page.keyboard.press('Enter');let download=await event;assert.equal(await download.failure(),null);const exported=path.join(directory,'keyboard-pattern-export.json');await download.saveAs(exported);await download.delete();assert.deepEqual(parsePatternFile(await readFile(exported,'utf8')),[pattern]);
    check('keyboard native pattern import, saved selection, search and exact JSON export');

    await enter('.result-item');await until(()=>document.querySelector('#target').getAttribute('aria-busy')==='false');await tabTo('#export-match');event=page.waitForEvent('download');await page.keyboard.press('Enter');download=await event;assert.equal(await download.failure(),null);const child=path.join(directory,'keyboard-child.tflite');await download.saveAs(child);await download.delete();await close();
    event=page.waitForEvent('filechooser');await page.keyboard.press('Control+o');await(await event).setFiles(child);await ready(3);await until(()=>document.querySelector('#result-count').textContent==='1 筆匹配路徑');await enter('.result-item');await until(()=>document.querySelector('#target').getAttribute('aria-busy')==='false'&&document.querySelectorAll('#target .node').length>0);await close();
    check('keyboard child-model download, Ctrl O native reopen, original pattern match and worker closure');
    return {tabPresses,modelWorkers:2};
    }finally{page.off('filechooser',intercept);}
}
