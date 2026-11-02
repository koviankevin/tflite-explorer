import assert from 'node:assert/strict';

// Trusted UI keys only; observations read public DOM geometry and Canvas data.
export async function graphNavigationFlow({page,read,mode,enhanced=false}){
    if(enhanced&&mode!=='edit')return focusNavigationFlow({page,read,mode});
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

// Measure drawn landmarks rather than native scroll offsets: a fitted SVG must
// pan too. All interactions are trusted UI keys/clicks, never app-state writes.
export async function focusNavigationFlow({page,read,mode,opened=false}){
    const canvas=mode==='canvas',selector=canvas?'.overview-canvas':'#target',surface=page.locator(selector);
    const observe=()=>read(({selector,canvas})=>{const e=document.querySelector(selector),n=canvas?e:e.querySelector('.node'),r=n.getBoundingClientRect();return {x:canvas?-Number(e.dataset.panX):-r.left,y:canvas?-Number(e.dataset.panY):-r.top,zoom:canvas?Number(e.dataset.zoom):r.width,selected:document.querySelector('#capture-count').textContent};},{selector,canvas});
    const until=async fn=>{const end=Date.now()+10000;while(!await fn()){if(Date.now()>end)throw Error(`${mode} focus navigation did not update`);await new Promise(r=>setTimeout(r,30));}};
    const moves=[];
    async function move(key,axis,sign){const before=await observe(),expected=before[axis]+sign*(key.startsWith('Shift')?240:80);await page.keyboard.press(key);await until(async()=>Math.abs((await observe())[axis]-expected)<1);const after=await observe();assert.ok(Math.abs(after.zoom/before.zoom-1)<.0001,'Pan must retain zoom (SVG geometry permits subpixel rounding).');assert.equal(after.selected,before.selected);moves.push({key,axis,before:before[axis],after:after[axis],expected});}
    if(opened){await move('d','x',1);return {mode,afterOpen:moves[0]};}
    await page.locator('#keyboard-graph').click();await page.keyboard.press('Home');await surface.screenshot();
    for(const [key,axis,sign] of [['d','x',1],['a','x',-1],['s','y',1],['w','y',-1],['Shift+d','x',1],['Shift+a','x',-1],['Shift+s','y',1],['Shift+w','y',-1]])await move(key,axis,sign);
    // A toolbar button retains focus, so the document route must move/zoom the
    // active exploration graph without stealing text or changing selections.
    await page.locator('#zoom-in').focus();await move('d','x',1);await move('a','x',-1);
    const zooms=[];for(const [key,factor] of [['q',1/1.4],['e',1.4],['-',1/1.4],['=',1.4]]){const before=await observe();await page.keyboard.press(key);await until(async()=>Math.abs((await observe()).zoom/before.zoom-factor)<.01);const after=await observe();assert.equal(after.selected,before.selected);zooms.push({key,before:before.zoom,after:after.zoom});}
    let formKeysPreserved=false;
    if(!canvas){
        // Search locating resets any unbounded SVG pan. The selected result is
        // still visible after moving far outside the original scroll bounds.
        await page.keyboard.press('Shift+d');await page.keyboard.press('Shift+d');await page.keyboard.press('Shift+d');
        await page.locator('.result-item').first().click();await until(()=>read(()=>document.querySelector('#target').getAttribute('aria-busy')==='false'));
        await surface.screenshot();await move('s','y',1);
        const rect=await surface.boundingBox();await page.mouse.click(rect.x+5,rect.y+5);assert.equal(await read(()=>document.activeElement.id),'target');await move('a','x',-1);
        const query=page.locator('#query'),previous=await query.inputValue();await query.focus();const before=await observe();await page.keyboard.press('Control+a');await page.keyboard.type('wasdqe');assert.equal(await query.inputValue(),'wasdqe');assert.deepEqual(await observe(),before);await query.fill(previous);formKeysPreserved=true;
    }
    await page.locator('#keyboard-graph').click();await page.keyboard.press('Home');
    return {mode,keys:moves,zooms,selected:(await observe()).selected,formKeysPreserved,fittedPan:true,toolbarFocus:true};
}
