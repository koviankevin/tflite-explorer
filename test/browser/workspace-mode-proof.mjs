import assert from 'node:assert/strict';
// Observes the actual navigation and editor after a native action; no UI state
// is assigned by the test. Navigation and local draft kind agree with the panel;
// older immutable builds keep their previous three-button navigation contract.
export async function assertWorkspaceMode(page,mode){
    assert.ok(['explore','edit','composition','run'].includes(mode));
    const contextual=await page.locator('#edit-session').count()>0;
    const standalone=await page.locator('#run-mode').count()>0,ids=standalone?['explore-mode','edit-mode','run-mode']:contextual?['explore-mode','edit-mode']:['explore-mode','edit-mode','compose-mode'],pressed=await Promise.all(ids.map(id=>page.locator('#'+id).getAttribute('aria-pressed'))),expected=standalone?[String(mode==='explore'),String(['edit','composition'].includes(mode)),String(mode==='run')]:contextual?[String(mode==='explore'),String(mode!=='explore')]:ids.map((_,i)=>String(i===['explore','edit','composition'].indexOf(mode)));
    assert.deepEqual(pressed,expected,`workspace mode ${mode}: navigation must select exactly the visible workspace`);
    const editorHidden=await page.locator('#edit-workspace').isHidden();assert.equal(editorHidden,['explore','run'].includes(mode));if(contextual&&['edit','composition'].includes(mode))assert.equal(await page.locator('#edit-session').inputValue(),mode==='composition'?'composition':'edit');if(standalone)assert.equal(await page.locator('#run-workspace').isHidden(),mode!=='run');return {mode,pressed,editorHidden};
}
