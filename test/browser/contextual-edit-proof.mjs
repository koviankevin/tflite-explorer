import assert from 'node:assert/strict';

export async function rectangleToggleProof({page,read,until}){
    assert.equal(await page.locator('.model-modes #compose-mode').count(),0);
    assert.equal(await page.locator('.result-heading #compose-mode').count(),1);
    await page.locator('#graph-font-size').selectOption('32');
    await until(()=>document.querySelector('#target').getAttribute('aria-busy')==='false');
    await page.locator('#pick-pattern').click();await page.locator('#clear-capture').click();
    const node=page.locator('#target [data-model-node="0"]');await node.scrollIntoViewIfNeeded();
    const b=await node.boundingBox(),v=await page.locator('#target').boundingBox();
    const x=Math.max(v.x+12,Math.min(v.x+v.width-12,b.x+b.width/2)),y=Math.max(v.y+12,Math.min(v.y+v.height-12,b.y+b.height/2));
    assert.ok(x>b.x&&x<b.x+b.width&&y>b.y&&y<b.y+b.height,'native rectangle must actually intersect the OP');
    const selected=()=>read(()=>document.querySelector('#capture-count').textContent);
    for(const [before,after]of [[0,1],[1,0],[0,1]]){
        await page.mouse.move(x-6,y-6);await page.mouse.down();
        for(let n=0;n<8;n++)await page.mouse.move(x+6,y+6,{steps:2});
        assert.match(await selected(),new RegExp(`^已選取 ${before} 個 layers`),'moving the rectangle never mutates the base selection');
        await page.mouse.move(x-5,y-5);await page.mouse.move(x+6,y+6);await page.mouse.up();
        await until(n=>document.querySelector('#capture-count').textContent.startsWith(`已選取 ${n} 個 layers`),after);
    }
    await page.mouse.move(x-6,y-6);await page.mouse.down();await page.mouse.move(x+6,y+6);await page.keyboard.press('Escape');await page.mouse.up();
    assert.match(await selected(),/^已選取 1 個 layers/);assert.equal(await page.locator('#compose-capture').isEnabled(),true);
    return {font:32,repeatToggle:true,moveDoesNotFlip:true,reversal:true,cancelPreserves:true,contextualAction:true};
}

export async function resetDraftProof({page,read,until}){
    const before=await page.locator('[data-edit-node]').count();assert.ok(before>0);
    await page.locator('#edit-restart').click();assert.equal(await page.locator('#edit-restart-dialog').isVisible(),true);
    await page.locator('#edit-restart-cancel').click();assert.equal(await page.locator('[data-edit-node]').count(),before);
    await page.locator('#edit-restart').click();await page.locator('#edit-restart-confirm').click();
    await until(()=>document.querySelector('#edit-workspace').hidden&&document.querySelectorAll('[data-edit-node]').length===0);
    assert.equal(await page.locator('#explore-mode').getAttribute('aria-pressed'),'true');
    assert.match(await page.locator('#edit-draft-hint').textContent(),/已重置/);
    return {cancelPreserves:true,scopeCleared:true,returnsToExplore:true};
}

export async function nonOverlappingEditCards(read){
    const cards=await read(()=>[...document.querySelectorAll('[data-edit-node]')].map(e=>{const r=e.getBoundingClientRect();return {id:e.dataset.editNode,x:r.x,y:r.y,width:r.width,height:r.height};}));
    for(let i=0;i<cards.length;i++)for(let j=i+1;j<cards.length;j++){const a=cards[i],b=cards[j];assert.ok(a.x+a.width<=b.x+.5||b.x+b.width<=a.x+.5||a.y+a.height<=b.y+.5||b.y+b.height<=a.y+.5,JSON.stringify({a,b}));}
    return {cards:cards.length,noOverlap:true};
}
