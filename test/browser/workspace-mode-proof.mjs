import assert from 'node:assert/strict';
// Observes the actual navigation and editor after a native action; no UI state
// is assigned by the test. All three buttons must agree with the shown panel.
export async function assertWorkspaceMode(page,mode){
    assert.ok(['explore','edit','composition'].includes(mode));
    const contextual=await page.locator('#edit-session').count()>0;
    const ids=contextual?['explore-mode','edit-mode']:['explore-mode','edit-mode','compose-mode'],pressed=await Promise.all(ids.map(id=>page.locator('#'+id).getAttribute('aria-pressed'))),expected=contextual?[String(mode==='explore'),String(mode!=='explore')]:ids.map((_,i)=>String(i===['explore','edit','composition'].indexOf(mode)));
    assert.deepEqual(pressed,expected,`workspace mode ${mode}: navigation must select exactly the visible workspace`);
    const editorHidden=await page.locator('#edit-workspace').isHidden();assert.equal(editorHidden,mode==='explore');if(contextual&&mode!=='explore')assert.equal(await page.locator('#edit-session').inputValue(),mode==='composition'?'composition':'edit');return {mode,pressed,editorHidden};
}
