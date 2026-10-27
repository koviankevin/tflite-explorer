// Public synthetic fixtures only, called by the guarded hosted smoke driver.
import assert from 'node:assert/strict';
import path from 'node:path';
import {readFile,writeFile} from 'node:fs/promises';
import {once} from 'node:events';
import {parseMLIR} from '../../src/mlir-engine.js';
import {captureMLIRPattern,findMLIRPatterns} from '../../src/mlir-pattern.js';
import {validateMLIR} from '../../src/mlir-validate.js';
import {reusablePattern,exportPatterns} from '../../src/pattern-library.js';
import {MLIR_CFG_DIAMOND,MLIR_CFG_LOOP} from '../mlir-fixture.mjs';
const metadata=await readFile(new URL('../../vendor/netron/mlir-metadata.json',import.meta.url),'utf8');
const parse=text=>parseMLIR(new TextEncoder().encode(text),{metadata});

export async function mlirSelectionFlow({page,read,base,directory,check}) {
    const report={cases:[],modelWorkers:0};
    const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));
    async function until(fn,...args){const end=Date.now()+30000;while(!await read(fn,...args)){if(Date.now()>end)throw Error('MLIR selection DOM wait: '+fn);await wait(100);}}
    async function ready(){await until(()=>document.querySelector('#loading-card').hidden&&document.querySelector('#layer-count').textContent!=='—'&&document.querySelector('#target').getAttribute('aria-busy')==='false');}
    async function search(){const laptop=page.locator('#run-pattern-laptop');await (await laptop.isVisible()?laptop:page.locator('#run-pattern')).click();}
    async function workerClosed(action){const worker=page.workers().find(w=>/\/model-worker\.js(?:\?|$)/.test(w.url()));assert.ok(worker);let timer;try{const closed=Promise.race([once(worker,'close'),new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('MLIR previous worker retained.')),5000);})]);await action();await closed;}finally{clearTimeout(timer);}}
    const intercept=()=>{};page.on('filechooser',intercept);
    try {
        for(const [name,text] of [['branch-join-custom',MLIR_CFG_DIAMOND],['loop-custom',MLIR_CFG_LOOP]]) {
            const index=await parse(text),pattern=reusablePattern('MLIR edit '+name,captureMLIRPattern(index,index.mlir.graphs.map((g,graph)=>({graph,nodes:g.operations.map((_,i)=>i)}))));
            const modelFile=path.join(directory,name+'.mlir'),patternFile=path.join(directory,name+'.json');await writeFile(modelFile,text,{flag:'wx'});await writeFile(patternFile,exportPatterns([pattern]),{flag:'wx'});
            await page.setViewportSize({width:1366,height:640});await page.goto(base,{waitUntil:'domcontentloaded'});await until(()=>typeof document.querySelector('#open-model').onclick==='function');
            let event=page.waitForEvent('filechooser');await page.locator('#open-model').click();await(await event).setFiles(modelFile);await ready();report.modelWorkers++;
            const originalCount=await read(()=>document.querySelector('#layer-count').textContent);
            await page.locator('[data-kind="patterns"]').click();await page.locator('#open-import').click();event=page.waitForEvent('filechooser');await page.locator('#choose-pattern-file').click();await(await event).setFiles(patternFile);await page.locator('#confirm-import').click();await page.locator('#saved-pattern').selectOption(pattern.name);await until(()=>document.querySelector('#result-count').textContent==='1 筆匹配路徑');
            await page.locator('.result-item').first().click();await ready();await page.locator('#graph-font-size').selectOption('32');await ready();
            await page.locator('#pick-pattern').click();await page.locator('#add-visible-layers').click();
            const selection=await read(()=>document.querySelector('#capture-count').textContent);assert.ok(selection.includes(`${pattern.nodes.filter(n=>n.kind==='operator').length} 個 layers`));
            await page.locator('#edit-capture').click();await until(()=>document.querySelector('#cfg-pattern-editor').open&&!document.querySelector('#cfg-pattern-editor').hidden);
            assert.equal(await read(()=>document.querySelectorAll('[data-cfg-node]').length),pattern.nodes.filter(n=>n.kind==='operator').length);
            const aliases=await read(()=>[...document.querySelectorAll('[data-cfg-node]')].map(n=>n.dataset.cfgNode));
            await page.locator('[data-cfg-key$="-add-op"]').first().click();
            const added=await read(previous=>[...document.querySelectorAll('[data-cfg-node]')].map(n=>n.dataset.cfgNode).find(n=>!previous.includes(n)),aliases);assert.ok(added);
            await page.locator(`[data-cfg-key="${added}-remove"]`).click();assert.equal(await read(()=>document.querySelectorAll('[data-cfg-node]').length),aliases.length);
            const edge=await read(()=>{const row=[...document.querySelectorAll('[data-cfg-edge]')].find(n=>n.querySelector('select').value==='control');return {index:row.dataset.cfgEdge,value:row.querySelector('input').value};});
            const port=page.locator(`[data-cfg-key="edge-${edge.index}-port-0"]`);await port.fill(String(Number(edge.value)+17));await port.press('Tab');await search();await until(()=>document.querySelector('#result-count').textContent==='0 筆匹配路徑');
            await port.fill(edge.value);await port.press('Tab');await search();await until(()=>document.querySelector('#result-count').textContent==='1 筆匹配路徑');
            const layouts=[];
            for(const size of [{width:1366,height:640},{width:390,height:844}]){
                await page.setViewportSize(size);await wait(150);
                const layout=await read(()=>({viewport:innerWidth,width:document.documentElement.scrollWidth,editor:document.querySelector('#cfg-pattern-editor').getBoundingClientRect().width,inner:document.querySelector('#cfg-pattern-editor .cfg-scroll').scrollWidth}));
                assert.ok(layout.width<=layout.viewport+1,JSON.stringify(layout));assert.ok(layout.inner<=layout.editor+1,JSON.stringify(layout));layouts.push({...size,...layout});
            }
            await page.setViewportSize({width:1366,height:640});
            assert.equal(await read(()=>document.querySelector('#layer-count').textContent),originalCount);
            await page.locator('#pick-pattern').click();assert.equal(await read(()=>document.querySelector('#capture-count').textContent),selection);await page.locator('#cancel-capture').click();
            await page.locator('#condition-editor summary').click();await page.locator('#condition-pattern-name').fill(pattern.name+' selected');await page.locator('#save-edited-pattern').click();await until(()=>document.querySelector('#result-count').textContent==='1 筆匹配路徑');
            await page.locator('.result-item').first().click();await ready();event=page.waitForEvent('download');await page.locator('#export-match').click();const download=await event;assert.equal(await download.failure(),null);const output=path.join(directory,name+'-cut.mlir');await download.saveAs(output);await download.delete();
            const child=await parse(await readFile(output,'utf8'));assert.deepEqual(validateMLIR(child).diagnostics,[]);assert.equal((await findMLIRPatterns(child,pattern)).items.length,1);
            await workerClosed(()=>page.locator('#open-export-model').click());await ready();report.modelWorkers++;await until(()=>document.querySelector('#result-count').textContent==='1 筆匹配路徑');
            assert.equal(await read(()=>document.querySelector('#open-export-model').hidden),true);await workerClosed(()=>page.locator('#close-model').click());
            report.cases.push({name,originalLayers:Number(originalCount),operators:aliases.length,layouts,negativeMatches:0,restoredMatches:1,exportedSSA:'passed',reopenedMatches:1});
            check(`${name}: direct selected CFG edit, successor negative/repair, 32px desktop/mobile layout, saved pattern, MLIR download/direct reopen and worker closure`);
        }
    }finally{page.off('filechooser',intercept);}
    return report;
}
