import {test} from 'node:test';
import assert from 'node:assert/strict';
import {server} from 'playwright-core/lib/coreBundle';
import {isolateChooserObservation,installDesktopChooserReader} from './browser/desktop-chooser-reader.mjs';
const {Page}=server;

test('the actual pinned chooser callback drops disabled main-world eval; adopting the native handle preserves the chooser event',async()=>{
    const events=[],utility={},isolated={evaluate:async fn=>fn({multiple:true})};let adopted=0;
    const handle={evaluate:async()=>{throw Error('window.eval() not supported.');},_context:{frame:{utilityContext:async()=>utility}},_adoptTo:async c=>{assert.equal(c,utility);adopted++;return isolated;}};
    const page={listenerCount:()=>1,emit:(name,event)=>events.push({name,event})},original=Page.prototype._onFileChooserOpened;
    await original.call(page,handle);assert.equal(events.length,0,'Reproduce the silently lost native chooser at the real callback seam.');
    const adapter=isolateChooserObservation(Page,'1.64.1');
    try{await Page.prototype._onFileChooserOpened.call(page,handle);assert.equal(adopted,1);assert.equal(events.length,1);assert.equal(events[0].name,Page.Events.FileChooser);assert.equal(events[0].event.element(),isolated);assert.equal(events[0].event.isMultiple(),true);assert.deepEqual(adapter.evidence,{playwright:'1.64.1',originalSHA256:'fb07c888f6df8e4bc20eed88354b17e9a212c8c3eabb427a3be16844eb10d26e',readWorld:'utility',nativeHandle:true});}finally{adapter.restore();}
    assert.equal(Page.prototype._onFileChooserOpened,original);
});
test('a dependency update cannot silently inherit the private test-driver adapter',()=>{
    const original=Page.prototype._onFileChooserOpened;
    assert.throws(()=>isolateChooserObservation(Page,'next'),/Review/);
    assert.equal(Page.prototype._onFileChooserOpened,original);
    class Changed{}Changed.prototype._onFileChooserOpened=async()=>{};
    assert.throws(()=>isolateChooserObservation(Changed,'1.64.1'),/Review/);
});

test('the installed pinned bundle resolves through the actual chooser installer and restores its callback',async()=>{
    const original=Page.prototype._onFileChooserOpened,adapter=await installDesktopChooserReader();
    try{assert.notEqual(Page.prototype._onFileChooserOpened,original);assert.equal(adapter.evidence.playwright,'1.64.1');}finally{adapter.restore();}
    assert.equal(Page.prototype._onFileChooserOpened,original);
});
