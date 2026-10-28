import {test} from 'node:test';
import assert from 'node:assert/strict';
import {Page} from '../node_modules/playwright-core/lib/server/page.js';
import {isolateChooserObservation} from './browser/desktop-chooser-reader.mjs';

test('the actual pinned chooser callback drops disabled main-world eval; adopting the native handle preserves the chooser event',async()=>{
    const events=[],utility={},isolated={evaluate:async fn=>fn({multiple:true})};let adopted=0;
    const handle={evaluate:async()=>{throw Error('window.eval() not supported.');},_context:{frame:{_utilityContext:async()=>utility}},_adoptTo:async c=>{assert.equal(c,utility);adopted++;return isolated;}};
    const page={listenerCount:()=>1,emit:(name,event)=>events.push({name,event})},original=Page.prototype._onFileChooserOpened;
    await original.call(page,handle);assert.equal(events.length,0,'Reproduce the silently lost native chooser at the real callback seam.');
    const adapter=isolateChooserObservation(Page,'1.56.1');
    try{await Page.prototype._onFileChooserOpened.call(page,handle);assert.equal(adopted,1);assert.equal(events.length,1);assert.equal(events[0].name,Page.Events.FileChooser);assert.equal(events[0].event.element(),isolated);assert.equal(events[0].event.isMultiple(),true);assert.deepEqual(adapter.evidence,{playwright:'1.56.1',originalSHA256:'43f26a718e33a0ab23f5b459249221ae00955ab78373a5ab1c93cf5df844ae42',readWorld:'utility',nativeHandle:true});}finally{adapter.restore();}
    assert.equal(Page.prototype._onFileChooserOpened,original);
});
test('a dependency update cannot silently inherit the private test-driver adapter',()=>{
    const original=Page.prototype._onFileChooserOpened;
    assert.throws(()=>isolateChooserObservation(Page,'next'),/Review/);
    assert.equal(Page.prototype._onFileChooserOpened,original);
    class Changed{}Changed.prototype._onFileChooserOpened=async()=>{};
    assert.throws(()=>isolateChooserObservation(Changed,'1.56.1'),/Review/);
});
