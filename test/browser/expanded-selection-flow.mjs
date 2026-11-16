import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {once} from 'node:events';
import {fixture} from '../fixture.mjs';
import {MLIR_CFG_LOOP} from '../mlir-fixture.mjs';
import {parsePatternFile} from '../../src/pattern-library.js';
import {validateMLIRText} from '../../src/mlir-validate.js';

export const EXPANDED_SELECTION_CHECK='Above-32 TFLite marquee and cross-block MLIR selection, pattern JSON search and submodel reopen';
export async function expandedSelectionFlow({page,read,directory,check}){
    const report={status:'failed',modelWorkers:0,cases:[]};
    const until=async(fn,arg)=>{const end=Date.now()+30000;while(!await read(fn,arg)){if(Date.now()>end)throw Error('Expanded selection timeout: '+fn);await new Promise(r=>setTimeout(r,50));}};
    const ready=()=>until(()=>document.querySelector('#model-tabs').getAttribute('aria-busy')!=='true'&&document.querySelector('#loading-card').hidden&&document.querySelector('#target').getAttribute('aria-busy')==='false');
    const choose=async file=>{const event=page.waitForEvent('filechooser');await page.locator('#open-model').click();await(await event).setFiles(file);report.modelWorkers++;await ready();};
    const close=async()=>{const workers=page.workers().filter(w=>/\/model-worker\.js(?:\?|$)/.test(w.url()));assert.equal(workers.length,1);let timer;try{const closed=Promise.race([once(workers[0],'close'),new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('Expanded selection worker retained.')),5000);})]);await page.locator('#close-model').click();await closed;}finally{clearTimeout(timer);}};
    const download=async(selector,name)=>{const event=page.waitForEvent('download');await page.locator(selector).click();const item=await event;assert.equal(await item.failure(),null);const file=path.join(directory,name);await item.saveAs(file);await item.delete();return file;};
    const f=fixture({graphCount:1,repeats:22}),bytes=new Uint8Array(f.totalBytes);bytes.set(f.data);
    const source=path.join(directory,'expanded-selection.tflite');await writeFile(source,bytes);
    await choose(source);assert.equal(await page.locator('#layer-count').textContent(),'67');
    await page.locator('#pick-pattern').click();await page.locator('#keyboard-graph').click();await page.keyboard.press('Home');
    await new Promise(r=>setTimeout(r,250));
    const target=await page.locator('#target').boundingBox();
    await page.mouse.move(target.x+5,target.y+5);await page.mouse.down();await page.mouse.move(target.x+target.width-20,target.y+target.height-20,{steps:12});await page.mouse.up();
    await page.screenshot({path:path.join(directory,'marquee.png')});
    const marquee=Number((await page.locator('#capture-count').textContent()).match(/已選取 (\d+)/)[1]);
    assert.ok(marquee>32&&marquee<=67,'real marquee must select more than 32 visible OPs');
    assert.equal(await page.locator('#target .pattern-picked').count(),marquee);
    await page.locator('#pick-op-ids').click();await page.locator('#capture-op-ids').fill('0-65,0');await page.locator('#apply-op-ids').click();
    assert.equal(await page.locator('#capture-count').textContent(),'已選取 66 個 layers');
    await page.locator('#capture-name').fill('Expanded TFLite 66');await page.locator('#save-capture').click();
    await until(()=>document.querySelector('#result-count').textContent==='1 筆匹配路徑');await ready();
    const json=await download('#export-pattern','expanded-tflite-pattern.json'),[pattern]=parsePatternFile(await readFile(json,'utf8'));assert.equal(pattern.nodes.length,66);
    const child=await download('#export-match','expanded-selection-cut.tflite');await close();await choose(child);
    assert.equal(await page.locator('#layer-count').textContent(),'66');await until(()=>document.querySelector('#result-count').textContent==='1 筆匹配路徑');await close();
    report.cases.push({format:'tflite',marquee,selected:66,patternNodes:66,reopened:66,matches:1});

    const extra=Array.from({length:64},(_,i)=>`  %extra${i} = "company.custom${i}"(%${i?'extra'+(i-1):'iteration'}) : (i32) -> i32`).join('\n');
    const text=MLIR_CFG_LOOP.replace('  %next =',extra+'\n  %next =').replace('"company.step"(%iteration)','"company.step"(%extra63)');
    const mlir=path.join(directory,'expanded-selection.mlir');await writeFile(mlir,text);await choose(mlir);
    await page.locator('#pick-pattern').click();await page.locator('#capture-cfg').check();
    for(const graph of ['0','1','2']){await page.locator('#graph-select').selectOption(graph);await ready();await page.locator('#add-capture-block').click();}
    assert.match(await page.locator('#capture-count').textContent(),/已選取 68 個 layers · 3 個 blocks/);
    await page.locator('#capture-name').fill('Expanded MLIR loop 68');await page.locator('#save-capture').click();
    await until(()=>document.querySelector('#result-count').textContent==='1 筆匹配路徑');await ready();
    const mlJson=await download('#export-pattern','expanded-mlir-pattern.json'),[mlPattern]=parsePatternFile(await readFile(mlJson,'utf8'));assert.equal(mlPattern.nodes.filter(n=>n.kind==='operator').length,68);
    const mlChild=await download('#export-match','expanded-selection-cut.mlir'),result=await validateMLIRText(await readFile(mlChild,'utf8'),{metadata:await readFile(new URL('../../vendor/netron/mlir-metadata.json',import.meta.url),'utf8')});
    assert.equal(result.passed,true);
    await close();await choose(mlChild);await until(()=>document.querySelector('#result-count').textContent==='1 筆匹配路徑');await close();
    report.cases.push({format:'mlir',selected:68,blocks:3,patternOperators:68,matches:1,validSSA:true});
    report.status='passed';check(EXPANDED_SELECTION_CHECK);return report;
}
