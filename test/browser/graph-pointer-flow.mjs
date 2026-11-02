import assert from 'node:assert/strict';

// Real pointer input and read-only DOM geometry. A click on an already-visible
// OP must retain the same camera, while an offscreen search must still locate.
export async function graphPointerFlow({page,read}){
    const surface=page.locator('#target'),wait=ms=>new Promise(r=>setTimeout(r,ms));
    const observe=()=>read(()=>{const t=document.querySelector('#target'),n=t.querySelector('.node'),r=n.getBoundingClientRect();return {x:r.left,y:r.top,width:r.width,viewBox:document.querySelector('#canvas').getAttribute('viewBox'),paneWidth:t.clientWidth,selected:document.querySelector('#capture-count').textContent};});
    async function settled(){let before=await observe(),stable=0;const end=Date.now()+5000;while(stable<3){await wait(80);const after=await observe();stable=Math.abs(after.x-before.x)+Math.abs(after.y-before.y)<.1?stable+1:0;before=after;if(Date.now()>end)throw Error('Pointer camera did not settle.');}return before;}
    const cases=[];
    for(const keys of [['d'],['q','s'],['e','a']]){
        await page.locator('#keyboard-graph').click();for(const key of keys)await page.keyboard.press(key);await settled();
        const point=await read(()=>{const t=document.querySelector('#target').getBoundingClientRect();for(const n of document.querySelectorAll('#target .graph-node[data-model-node]')){const b=n.getBoundingClientRect(),r=(n.querySelector('.node-item-type')||n).getBoundingClientRect();if(b.left>t.left+10&&b.right<t.right-10&&b.top>t.top+10&&b.bottom<t.bottom-10)return {x:(r.left+r.right)/2,y:(r.top+r.bottom)/2,node:n.id};}return null;});assert.ok(point,'A visible OP must be clicked through its actual header.');
        const before=await settled();await page.mouse.click(point.x,point.y);const after=await settled();assert.ok(Math.hypot(after.x-before.x,after.y-before.y)<1,JSON.stringify({keys,point,before,after}));assert.equal(after.viewBox,before.viewBox);assert.equal(after.paneWidth,before.paneWidth);assert.equal(after.selected,before.selected);cases.push({kind:'visible-op-click',keys,point,before,after});
    }
    const bounds=await surface.boundingBox(),point={x:bounds.x+5,y:bounds.y+5},before=await settled();await page.mouse.click(point.x,point.y);const clicked=await settled();assert.ok(Math.hypot(clicked.x-before.x,clicked.y-before.y)<1);cases.push({kind:'blank-click',before,after:clicked});
    await page.mouse.move(point.x,point.y);await page.mouse.down();await page.mouse.move(point.x+20,point.y+15,{steps:6});await page.mouse.up();const dragged=await settled();assert.ok(Math.abs(dragged.x-clicked.x-20)<1&&Math.abs(dragged.y-clicked.y-15)<1);assert.equal(dragged.selected,clicked.selected);cases.push({kind:'mouse-drag',before:clicked,after:dragged,expectedDelta:[20,15]});
    await page.keyboard.press('d');const keyed=await settled();assert.ok(Math.abs(keyed.x-dragged.x+80)<1);assert.equal(keyed.selected,dragged.selected);cases.push({kind:'keyboard-after-mouse-drag',before:dragged,after:keyed});
    for(let i=0;i<8;i++)await page.keyboard.press('Shift+d');await page.locator('.result-item').first().click();await settled();assert.equal(await read(()=>{const t=document.querySelector('#target').getBoundingClientRect();return [...document.querySelectorAll('#target .graph-node.select')].some(n=>{const r=n.getBoundingClientRect();return r.right>t.left&&r.left<t.right&&r.bottom>t.top&&r.top<t.bottom;});}),true,'Search must bring an offscreen OP back into view.');
    return {status:'passed',font:await page.locator('#graph-font-size').inputValue(),cases,offscreenSearch:true};
}
