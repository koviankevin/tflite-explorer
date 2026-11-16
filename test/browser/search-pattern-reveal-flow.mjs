import assert from 'node:assert/strict';
import {writeFile} from 'node:fs/promises';
import {once} from 'node:events';
import path from 'node:path';
import {fixture} from '../fixture.mjs';
import {MLIR_CFG_LOOP} from '../mlir-fixture.mjs';
export const SEARCH_PATTERN_REVEAL_CHECK='Edit search pattern reveals and focuses ordinary/CFG editors from Layers and compressed settings without model edits or automatic search';
export async function searchPatternRevealFlow({page,read,directory,check}){
    const report={status:'failed',modelWorkers:0,downloads:0,cases:[]};
    const until=async(fn,...args)=>{const end=Date.now()+30000;while(!await read(fn,...args)){if(Date.now()>end)throw Error('Pattern reveal timeout: '+fn);await new Promise(r=>setTimeout(r,50));}};
    const ready=()=>until(()=>document.querySelector('#model-tabs').getAttribute('aria-busy')!=='true'&&document.querySelector('#loading-card').hidden&&document.querySelector('#target').getAttribute('aria-busy')==='false');
    const choose=async file=>{const e=page.waitForEvent('filechooser');await page.locator('#open-model').click();await(await e).setFiles(file);report.modelWorkers++;await ready();};
    const close=async()=>{const worker=page.workers().find(w=>/\/model-worker\.js(?:\?|$)/.test(w.url()));assert.ok(worker);let timer;try{const ended=Promise.race([once(worker,'close'),new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('Pattern reveal retained worker.')),5000);})]);await page.locator('#close-model').click();await ended;}finally{clearTimeout(timer);}};
    const downloads=()=>report.downloads++;page.on('download',downloads);
    const proof=async(name,root,selector,invoke)=>{
        assert.equal(await page.locator('#edit-capture').textContent(),'編輯搜尋 pattern');
        assert.equal(await page.locator('#edit-capture').getAttribute('aria-controls'),'pattern-editor');
        const before=await read(()=>({stats:document.querySelector('#file-stats').textContent,library:document.querySelector('#saved-pattern').options.length,results:document.querySelector('#result-count').textContent}));
        await invoke();
        await until((root,selector)=>document.querySelector('[data-kind="patterns"]').getAttribute('aria-selected')==='true'&&document.querySelector(root).open&&!document.querySelector('#pattern-editor').hidden&&document.querySelector(root).contains(document.activeElement)&&document.activeElement.matches(selector),root,selector);
        const layout=await read((root,selector)=>{const field=document.querySelector(root).querySelector(selector),f=field.getBoundingClientRect(),p=document.querySelector('#search-controls').getBoundingClientRect();return {top:f.top,bottom:f.bottom,left:f.left,right:f.right,paneTop:p.top,paneBottom:p.bottom,paneLeft:p.left,paneRight:p.right,viewportWidth:innerWidth,documentWidth:document.documentElement.scrollWidth};},root,selector);
        assert.ok(layout.top>=layout.paneTop&&layout.bottom<=layout.paneBottom&&layout.left>=layout.paneLeft&&layout.right<=layout.paneRight,JSON.stringify(layout));assert.ok(layout.documentWidth<=layout.viewportWidth);
        assert.equal(await page.locator('#edit-workspace').isHidden(),true);assert.equal(await page.locator('#edit-mode').getAttribute('aria-pressed'),'false');
        assert.equal(await page.locator('#saved-pattern').inputValue(),'');assert.equal(await page.locator('#file-stats').textContent(),before.stats);assert.equal(await read(()=>document.querySelector('#saved-pattern').options.length),before.library);assert.equal(await page.locator('#result-count').textContent(),before.results);
        await page.screenshot({path:path.join(directory,name+'.png')});
        await page.locator('#run-pattern-laptop').click();await until(()=>document.querySelector('#result-count').textContent==='1 筆匹配路徑');await ready();
        report.cases.push({name,opened:true,focused:true,visible:true,modelUnchanged:true,notSaved:true,noAutomaticSearch:true,matches:1,layout});
    };
    try{
        const f=fixture({graphCount:1,repeats:1}),bytes=new Uint8Array(f.totalBytes);bytes.set(f.data);const tflite=path.join(directory,'search-pattern.tflite');await writeFile(tflite,bytes);
        for(const name of ['from-layers','compressed-settings']){
            await choose(tflite);await page.locator('#patterns-tab').click();if(await read(()=>document.querySelector('#visual-pattern-editor').open))await page.locator('#visual-pattern-editor>summary').click();
            if(name==='from-layers')await page.locator('#layers-tab').click();else{await page.locator('#search-split').focus();await page.keyboard.press('Home');}
            await page.locator('#pick-pattern').click();await page.locator('#pick-op-ids').click();await page.locator('#capture-op-ids').fill('0-2');await page.locator('#apply-op-ids').click();await page.locator('#capture-name').fill('Search '+name);
            await proof(name,'#visual-pattern-editor','#graph-node-rows select',()=>name==='from-layers'?page.locator('#edit-capture').click():page.locator('#edit-capture').press('Enter'));
            assert.equal(await page.locator('#graph-node-rows .graph-form-row').count(),3);await close();
        }
        const mlir=path.join(directory,'search-pattern-loop.mlir');await writeFile(mlir,MLIR_CFG_LOOP);await choose(mlir);await page.locator('#pick-pattern').click();await page.locator('#capture-cfg').check();for(const graph of ['0','1','2']){await page.locator('#graph-select').selectOption(graph);await ready();await page.locator('#add-capture-block').click();}
        await page.locator('#capture-name').fill('Search loop');await proof('cross-block','#cfg-pattern-editor','input[list]',()=>page.locator('#edit-capture').click());await close();
        assert.equal(report.modelWorkers,3);assert.equal(report.downloads,0);report.status='passed';check(SEARCH_PATTERN_REVEAL_CHECK);return report;
    }finally{page.off('download',downloads);}
}
