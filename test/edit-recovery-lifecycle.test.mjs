import {test} from 'node:test';
import assert from 'node:assert/strict';
import {editRecoverySession} from '../src/edit-recovery-session.js';
import {editRecoveryFingerprint} from '../src/edit-recovery-fingerprint.js';
import {editRecoveryLifecycle} from '../src/edit-recovery-lifecycle.js';

const draft=()=>({format:'model-lens-edit-draft',version:1,source:{name:'original.tflite',bytes:16,format:'tflite',algorithm:'sha256-chunks-v1',fingerprint:'a'.repeat(64)},scope:{nodes:[{graph:0,node:0}],selected:['op:0:0'],signature:'b'.repeat(64)},history:{commands:[{kind:'clone',node:'op:0:0',side:'after'}],redo:[]},view:{selected:'new:1',zoom:.6,font:32,left:12,top:34},options:{updateSignatures:false}});
function fixture(t){
    const f={active:true,autoReply:true,created:0,workers:[],writes:[]},doc=new EventTarget(),win=new EventTarget(),file={size:16};doc.visibilityState='visible';
    const fingerprint=editRecoveryFingerprint({createWorker:()=>{f.created++;if(!f.active)throw new DOMException('Document is inactive','SecurityError');const worker={terminated:false,postMessage(input){this.input=input;if(f.autoReply)queueMicrotask(()=>this.complete());},complete(){this.onmessage({data:{id:this.input.id,fingerprint:'a'.repeat(64),bytes:16}});},terminate(){this.terminated=true;}};f.workers.push(worker);return worker;}});
    const session=editRecoverySession({owner:'a'.repeat(32),delay:60000,store:{save:async input=>{f.writes.push(input);return {revision:f.writes.length,updatedAt:1};}},capture:async()=>{await fingerprint.read(file);return draft();}});
    const dispose=editRecoveryLifecycle({session,fingerprint,document:doc,window:win});session.attach();
    t.after(async()=>{dispose();session.setEnabled(false);fingerprint.cancel();await session.detach();});
    return Object.assign(f,{session,doc,win});
}
test('leaving an inactive document starts no new fingerprint Worker; restoring the page resumes the same unsaved draft',async t=>{
    const f=fixture(t);f.session.change();f.active=false;f.win.dispatchEvent(new Event('pagehide'));
    assert.equal(f.created,0,'pagehide must not create a Worker in the inactive document');assert.equal(f.writes.length,0);
    f.active=true;f.win.dispatchEvent(new Event('pageshow'));await f.session.flush();assert.equal(f.created,1);assert.equal(f.writes.length,1);assert.deepEqual(f.writes[0].document,draft());
});
test('leaving cancels an in-flight fingerprint without claiming saved; a cached-page restore retries successfully',async t=>{
    const f=fixture(t);f.autoReply=false;f.session.change();const pending=f.session.flush();assert.equal(f.created,1);
    f.active=false;f.win.dispatchEvent(new Event('pagehide'));assert.equal(f.workers[0].terminated,true);await pending;assert.equal(f.writes.length,0);
    f.active=true;f.autoReply=true;f.win.dispatchEvent(new Event('pageshow'));await f.session.flush();assert.equal(f.created,2);assert.equal(f.writes.length,1);assert.ok(f.workers.every(w=>w.terminated));
});
test('a background but still active page continues saving; hiding after pagehide cannot restart fingerprint work',async t=>{
    const f=fixture(t);f.session.change();f.doc.visibilityState='hidden';f.doc.dispatchEvent(new Event('visibilitychange'));await f.session.flush();assert.equal(f.writes.length,1);
    f.session.change();f.active=false;f.win.dispatchEvent(new Event('pagehide'));f.doc.dispatchEvent(new Event('visibilitychange'));await f.session.flush();assert.equal(f.created,1);assert.equal(f.writes.length,1);
});
