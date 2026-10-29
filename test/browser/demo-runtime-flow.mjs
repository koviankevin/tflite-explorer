// Exercise the exact published demo bytes, not a separate executable fixture.
import assert from 'node:assert/strict';
import path from 'node:path';
export async function demoRuntimeFlow({page,read,directory}){
    const report={cases:[],modelWorkers:1,runtimeWorkers:[]},worker=w=>{if(/\/tflite-runtime-worker\.js(?:\?|$)/.test(w.url())){const row={closed:false};report.runtimeWorkers.push(row);w.on('close',()=>{row.closed=true;});}};
    const until=async(fn,...args)=>{const end=Date.now()+35000;while(!await read(fn,...args)){if(Date.now()>end)throw Error('Demo runtime timeout: '+fn);await new Promise(r=>setTimeout(r,70));}};
    const choose=async(file,button)=>{const next=page.waitForEvent('filechooser');await page.locator(button).click();await(await next).setFiles(file);};
    page.on('worker',worker);
    try{
        await choose(path.join(directory,'demo.tflite'),'#open-model');
        await until(()=>document.querySelector('#target').getAttribute('aria-busy')==='false'&&document.querySelector('#loading-card').hidden);
        const standalone=await page.locator('#run-mode').count()>0;
        if(!standalone){await page.locator('#edit-mode').click();await until(()=>document.querySelector('#edit-workspace').getAttribute('aria-busy')==='false'&&document.querySelectorAll('[data-edit-node]').length>0);}
        for(const edited of [false,true]){
            if(edited){
                if(standalone){await page.locator('#edit-mode').click();await until(()=>document.querySelector('#edit-workspace').getAttribute('aria-busy')==='false'&&document.querySelectorAll('[data-edit-node]').length>0);}
                await page.locator('[data-edit-node="op:0:0"] .edit-node-title').click();await page.locator('#edit-add-after').click();await page.locator('[data-edit-output="new:1:out:0"]').click();await page.locator('[data-edit-input="op:0:1"][data-edit-slot="0"]').click();
                if(standalone){const download=page.waitForEvent('download');await page.locator('#edit-export').click();const item=await download;assert.equal(await item.failure(),null);await item.delete();await until(()=>!document.querySelector('#edit-open-result').disabled);await page.locator('#edit-open-result').click();await until(()=>document.querySelector('#model-tabs').getAttribute('aria-busy')!=='true'&&document.querySelector('#loading-card').hidden);report.modelWorkers++;}
            }
            if(standalone)await page.locator('#run-mode').click();
            for(const mode of ['zero','random']){
                await page.locator('#edit-runtime-check').click();await until(()=>document.querySelector('#edit-runtime-dialog').open);
                for(const input of await page.locator('#edit-runtime-inputs select[id^=runtime-input-mode-]').all())await input.selectOption(mode);
                await page.locator('#edit-runtime-run').click();await until(()=>!!document.querySelector('#edit-runtime-result').dataset.status&&(document.querySelector('#run-workspace')||document.querySelector('#edit-workspace')).getAttribute('aria-busy')==='false');
                const result=await read(()=>({status:document.querySelector('#edit-runtime-result').dataset.status,detail:document.querySelector('#edit-runtime-result').textContent}));
                assert.equal(result.status,'passed',`published demo ${edited?'edited':'original'} / ${mode}: ${JSON.stringify(result)}`);if(standalone)assert.doesNotMatch(result.detail,/Found builtin operator .* with custom options/);report.cases.push({edited,mode,status:result.status});
            }
        }
        if(!standalone)await page.locator('#edit-clear').click();else {await page.locator('.close-model-tab').last().click();await until(()=>document.querySelector('#model-tabs').getAttribute('aria-busy')!=='true'&&!document.querySelector('#edit-workspace').hidden);report.modelWorkers++;await page.locator('#edit-clear').click();}await page.locator('#close-model').click();
        await until(()=>document.querySelector('#layer-count').textContent==='—');
        const end=Date.now()+5000;while(report.runtimeWorkers.some(w=>!w.closed)&&Date.now()<end)await new Promise(r=>setTimeout(r,30));assert.equal(report.runtimeWorkers.length,4);assert.ok(report.runtimeWorkers.every(w=>w.closed));return report;
    }catch(error){error.demoRuntime=report;throw error;}finally{page.off('worker',worker);}
}
