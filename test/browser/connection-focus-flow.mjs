import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';

export async function connectionFocusFlow({page,read,mode='svg'}){
    const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));
    const state=()=>read(mode=>{const c=document.querySelector(mode==='canvas'?'.overview-canvas':'#canvas'),t=document.getElementById('target');return {edges:Number(c.dataset.focusedEdges),enabled:document.getElementById('connection-focus').getAttribute('aria-pressed'),camera:mode==='canvas'?[c.dataset.zoom,c.dataset.panX,c.dataset.panY]:[c.getAttribute('viewBox'),t.scrollLeft,t.scrollTop],selection:document.getElementById('capture-count').textContent,halos:document.querySelectorAll('.connection-halo').length,inputs:document.querySelectorAll('.connection-input').length,outputs:document.querySelectorAll('.connection-output').length};},mode);
    if(await page.locator('#connection-focus').getAttribute('aria-pressed')!=='true')await page.locator('#connection-focus').click();
    await wait(100);const before=await state();assert.ok(before.edges>0,JSON.stringify(before));
    const screenshot=async()=>createHash('sha256').update(await page.locator(mode==='canvas'?'.overview-canvas':'#canvas').screenshot()).digest('hex');
    const highlighted=await screenshot();await page.locator('#connection-focus').click();await wait(100);const disabled=await state(),all=await screenshot();assert.equal(disabled.edges,0);assert.equal(disabled.halos,0);assert.deepEqual(disabled.camera,before.camera);assert.equal(disabled.selection,before.selection);assert.notEqual(all,highlighted,'Focus must change actual rendered connections.');
    await page.locator('#connection-focus').click();await wait(100);const restored=await state();assert.equal(restored.edges,before.edges);assert.equal(restored.halos,before.halos);assert.deepEqual(restored.camera,before.camera);assert.equal(restored.selection,before.selection);
    for(let i=0;i<6;i++)await page.locator('#connection-focus').click();await wait(100);const repeated=await state();assert.deepEqual(repeated,restored,'Repeated focus switches must not accumulate halos, change selection, or move the viewport.');
    return {mode,before,disabled,restored,highlighted,all};
}
