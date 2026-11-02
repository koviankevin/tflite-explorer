import assert from 'node:assert/strict';

// Trusted UI keys only; observations read public DOM geometry and Canvas data.
export async function graphNavigationFlow({page,read,mode}){
    const canvas=mode==='canvas',selector=mode==='edit'?'#edit-viewport':canvas?'.overview-canvas':'#target',surface=page.locator(selector);
    const observe=()=>read(({selector,canvas})=>{const e=document.querySelector(selector);return {x:canvas?-Number(e.dataset.panX):e.scrollLeft,y:canvas?-Number(e.dataset.panY):e.scrollTop,zoom:canvas?Number(e.dataset.zoom):null,maxX:e.scrollWidth-e.clientWidth,maxY:e.scrollHeight-e.clientHeight,selected:document.querySelector('#capture-count').textContent};},{selector,canvas});
    const until=async fn=>{const end=Date.now()+10000;while(!await fn()){if(Date.now()>end)throw Error(`${mode} navigation did not update`);await new Promise(r=>setTimeout(r,30));}};
    if(mode==='edit')await surface.focus();else await page.locator('#keyboard-graph').click();
    assert.equal(await read(s=>document.activeElement===document.querySelector(s),selector),true);
    const selected=(await observe()).selected;
    await page.keyboard.press('Home');
    // Guarantee scrolling room on SVG/editor surfaces; Canvas is unbounded.
    if(!canvas)for(let i=0;i<6;i++)await page.keyboard.press('=');
    await surface.screenshot(); // Wait for the same display frame used by DOM observations.
    const moves=[];
    for(const [key,axis,sign] of [['d','x',1],['a','x',-1],['s','y',1],['w','y',-1],['Shift+d','x',1],['Shift+a','x',-1],['Shift+s','y',1],['Shift+w','y',-1]]){
        const before=await observe(),step=key.startsWith('Shift')?240:80,max=axis==='x'?before.maxX:before.maxY;
        const expected=canvas?before[axis]+sign*step:Math.max(0,Math.min(max,before[axis]+sign*step));
        await page.keyboard.press(key);await until(async()=>Math.abs((await observe())[axis]-expected)<.1);const after=await observe();
        assert.equal(after.selected,selected);if(canvas)assert.equal(after.zoom,before.zoom);moves.push({key,axis,before:before[axis],after:after[axis],expected});
    }
    assert.ok(moves.some(m=>m.before!==m.after),'The actual surface must move.');
    if(mode==='svg'){
        const query=page.locator('#query'),previous=await query.inputValue();await query.focus();const before=await observe();await page.keyboard.press('Control+a');await page.keyboard.type('wasd');assert.equal(await query.inputValue(),'wasd');assert.deepEqual(await observe(),before);await query.fill(previous);
    }
    if(mode==='edit')await surface.focus();else await page.locator('#keyboard-graph').click();await page.keyboard.press('Home');
    return {mode,keys:moves,selected,formKeysPreserved:mode==='svg'};
}
