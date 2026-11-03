import assert from 'node:assert/strict';

// Real separator gestures; CDP reads geometry only.
export async function patternSplitFlow({page,read}) {
    const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));
    const geometry=()=>read(()=>{
        const rect=id=>{const r=document.getElementById(id).getBoundingClientRect();return {x:r.x,y:r.y,width:r.width,height:r.height,bottom:r.bottom};};
        return {settings:rect('search-controls'),split:rect('search-split'),results:rect('results'),pane:rect('search-results-pane'),workspace:rect('search-workspace'),footer:document.querySelector('.panel-footer').getBoundingClientRect().y,hidden:document.getElementById('search-split').hidden,stored:localStorage.getItem('model-lens.pattern-split.v1'),scroll:document.getElementById('search-controls').scrollTop,viewBox:document.querySelector('#canvas')?.getAttribute('viewBox')};
    });
    const check=g=>{assert.ok(g.results.height>=100,`Results compressed to ${g.results.height}px`);assert.ok(g.results.bottom<=g.pane.bottom+1);assert.ok(g.pane.bottom<=g.footer+1);assert.ok(g.settings.bottom<=g.split.y+1);assert.ok(g.split.bottom<=g.pane.y+1);};
    const records=[];
    await page.locator('#patterns-tab').click();await wait(200);
    for(const size of [{width:1366,height:768},{width:1280,height:640}]){
        await page.setViewportSize(size);await wait(200);await page.locator('#search-split').focus();await page.keyboard.press('Enter');await wait(100);
        const initial=await geometry();check(initial);assert.equal(initial.hidden,false);assert.ok(initial.results.height>=150,JSON.stringify(initial));
        const h=initial.split;await page.mouse.move(h.x+h.width/2,h.y+h.height/2);await page.mouse.down();await page.mouse.move(h.x+h.width/2,h.y-75,{steps:8});await page.mouse.up();await wait(100);
        const dragged=await geometry();check(dragged);const minimum=Number(await page.locator('#search-split').getAttribute('aria-valuemin'));assert.ok(dragged.results.height>=initial.results.height+Math.min(70,initial.settings.height-minimum)-1);assert.equal(dragged.viewBox,initial.viewBox,'Resizing the search panes must not move the model.');
        await page.locator('#search-split').focus();await page.keyboard.press('ArrowDown');await wait(100);const key=await geometry();assert.ok(Math.abs(key.settings.height-dragged.settings.height-10)<=1);
        for(const press of ['Home','End']){await page.keyboard.press(press);await wait(100);const extreme=await geometry();check(extreme);records.push({size,press,...extreme});}
        await page.keyboard.press('Enter');await wait(100);
        const beforeCancel=await geometry(),point=beforeCancel.split;
        await page.mouse.move(point.x+point.width/2,point.y+6);await page.mouse.down();await page.mouse.move(point.x+point.width/2,point.y-30,{steps:4});await page.keyboard.press('Escape');await page.mouse.up();await wait(100);
        assert.equal((await geometry()).settings.height,beforeCancel.settings.height,'Escape must restore the previous split.');
        await page.locator('#condition-editor summary').click();await wait(100);check(await geometry());
        await page.locator('#search-controls').hover();await page.mouse.wheel(0,10000);await wait(200);const scrolled=await geometry();assert.ok(scrolled.scroll>0);check(scrolled);
        await page.locator('#search-split').focus();await page.keyboard.press('Home');await page.keyboard.press('Shift+ArrowDown');await wait(100);const saved=await geometry();check(saved);
        await page.locator('#layers-tab').click();await wait(100);assert.equal((await geometry()).hidden,true);
        await page.locator('#patterns-tab').click();await wait(100);const restored=await geometry();assert.equal(restored.settings.height,saved.settings.height);check(restored);
        records.push({size,initial,dragged,key,scrolled,saved,restored});
        await page.locator('#search-split').dblclick();await wait(100);assert.equal((await geometry()).settings.height,initial.settings.height);
        await page.locator('#condition-editor summary').click();
    }
    await page.setViewportSize({width:1366,height:768});await wait(200);
    await page.locator('#search-split').focus();await page.keyboard.press('Home');await page.keyboard.press('Shift+ArrowDown');await wait(100);
    return {records,saved:await geometry()};
}
