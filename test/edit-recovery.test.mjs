import test from 'node:test';
import assert from 'node:assert/strict';
import {editRecoverySession} from '../src/edit-recovery-session.js';
import {nextEditRecovery,readEditRecovery,editRecoveryStore,EditRecoveryConflict} from '../src/edit-recovery-store.js';
import {parseEditSession,exportEditSession,EDIT_DRAFT_LIMIT} from '../src/model-edit-session.js';
const owner='a'.repeat(32),key='b'.repeat(32);
const document=()=>({format:'model-lens-edit-draft',version:1,source:{name:'original.tflite',bytes:123456,format:'tflite',algorithm:'sha256-chunks-v1',fingerprint:'a'.repeat(64)},scope:{nodes:[{graph:0,node:0}],selected:['op:0:0'],signature:'b'.repeat(64)},history:{commands:[{kind:'clone',node:'op:0:0',side:'after'}],redo:[]},view:{selected:'new:1',zoom:.6,font:32,left:123,top:456},options:{updateSignatures:false}});
function memoryStore(){const records=new Map();return {records,async save(args){const record=nextEditRecovery(records.get(args.key),args,records.size);records.set(args.key,record);return record;}};}
test('an active database AbortError remains visibly unsaved and explicit retry commits the original draft',async()=>{
    const store=memoryStore(),save=store.save;let fail=true,state;
    store.save=async args=>{if(fail)throw new DOMException('','AbortError');return save(args);};
    const session=editRecoverySession({store,owner,delay:60000,capture:document,changed:s=>state=s});
    try{session.attach();session.change();await session.flush();assert.equal(state.failed,true);assert.equal(state.saved,false);assert.match(state.message,/尚未完成保存/);assert.equal(store.records.size,0);fail=false;await session.retry();assert.equal(state.failed,false);assert.equal(state.saved,true);assert.deepEqual(readEditRecovery([...store.records.values()][0]).document,document());}finally{session.setEnabled(false);await session.detach();}
});
test('recovery records preserve canonical history/view, a last-good backup and deletion CAS; unknown data stays untouched',()=>{
    const d=document(),first=nextEditRecovery(null,{key,owner,revision:0,document:d});assert.deepEqual(readEditRecovery(first).document,d);const changed=structuredClone(d);changed.history.redo=[changed.history.commands.pop()];const second=nextEditRecovery(first,{key,owner,revision:1,document:changed});assert.deepEqual(readEditRecovery(second).document.history,changed.history);assert.deepEqual(parseEditSession(second.previous),d);
    const corrupt={...second,text:'{torn'};assert.equal(readEditRecovery(corrupt).recoveredPrevious,true);assert.deepEqual(readEditRecovery(corrupt).document,d);
    const future={...second,text:JSON.stringify({...d,version:2})};assert.throws(()=>readEditRecovery(future));assert.throws(()=>nextEditRecovery(future,{key,owner,revision:2,document:d}));assert.equal(JSON.parse(future.text).version,2);
    assert.throws(()=>nextEditRecovery(null,{key,owner,revision:2,document:d}),EditRecoveryConflict);assert.throws(()=>nextEditRecovery(first,{key,owner,revision:0,document:d}),EditRecoveryConflict);
    assert.throws(()=>nextEditRecovery(null,{key,owner,revision:0,document:d},20),/20/);assert.equal(nextEditRecovery(first,{key,owner,revision:1,document:d},20).revision,2);
    for(const mutate of [x=>x.source.weights=[1,2],x=>x.history.commands.push({kind:'eval',node:'op:0:0'}),x=>x.source.format='mlir']){const bad=structuredClone(d);mutate(bad);assert.throws(()=>nextEditRecovery(null,{key,owner,revision:0,document:bad}));}
});
test('serialized documents near the size cap round trip instead of exporting an unimportable pretty JSON',()=>{
    const d=document();d.history.commands=[];for(let i=0;i<16;i++)d.history.commands.push({kind:'builtin',node:'new:1',code:18,version:1,settings:{padding:'x'.repeat(15700)},inputCount:2,outputLike:['t:0:1']});
    const text=exportEditSession(d);assert.ok(new TextEncoder().encode(text).length<=EDIT_DRAFT_LIMIT);assert.deepEqual(parseEditSession(text),d);
});
test('autosave commits before claiming saved; later commands and redo form a new revision',async()=>{
    const store=memoryStore();let value=document(),state;const session=editRecoverySession({store,owner,delay:60000,capture:()=>structuredClone(value),changed:s=>{state=s;}});session.attach();session.change();assert.equal(state.saved,false);await session.flush();assert.equal(state.saved,true);assert.equal([...store.records.values()][0].revision,1);
    value.history.redo=[value.history.commands.pop()];value.view.left=777;session.change();await session.flush();const record=[...store.records.values()][0];assert.equal(record.revision,2);assert.deepEqual(readEditRecovery(record).document,value);await session.detach();
});
test('one preparation is coalesced while editing; switching sources never puts old history under the new key',async()=>{
    const store=memoryStore();let value=document(),release,calls=0;const session=editRecoverySession({store,owner,delay:60000,capture:()=>{calls++;const captured=structuredClone(value);if(calls===1)return new Promise(resolve=>{release=()=>resolve(captured);});return captured;}});session.attach();session.change();const pending=session.flush();value.view.left=999;session.change();session.flush();assert.equal(calls,1);const oldTab=session.binding;const detached=session.detach();value={...document(),source:{...document().source,name:'other.tflite',fingerprint:'f'.repeat(64)}};session.attach();session.change();await session.flush();release();await pending;await detached;
    assert.equal(store.records.size,2);const docs=[...store.records.values()].map(r=>readEditRecovery(r).document);assert.equal(docs.find(d=>d.source.name==='original.tflite').view.left,999);assert.equal(docs.find(d=>d.source.name==='other.tflite').view.left,123);
    await session.detach();value=document();session.attach(oldTab);value.view.left=1001;session.change();await session.flush();const original=[...store.records.values()].find(r=>readEditRecovery(r).document.source.name==='original.tflite');assert.equal(original.revision,3);assert.equal(readEditRecovery(original).document.view.left,1001);await session.detach();
});
test('concurrent resume conflicts preserve the peer version and an explicit fork preserves both',async()=>{
    const store=memoryStore(),initial=await store.save({key,owner,revision:0,document:document()});let a=document(),b=document(),state;
    const first=editRecoverySession({store,owner,delay:60000,capture:()=>a}),second=editRecoverySession({store,owner:'c'.repeat(32),delay:60000,capture:()=>b,changed:s=>{state=s;}});first.attach(initial);second.attach(initial);a.view.left=10;first.change();await first.flush();b.view.left=20;second.change();await second.flush();assert.equal(state.conflict,true);assert.equal(readEditRecovery(store.records.get(key)).document.view.left,10);
    await second.fork();assert.equal(state.conflict,false);assert.equal(store.records.size,2);assert.deepEqual([...store.records.values()].map(r=>readEditRecovery(r).document.view.left).sort((x,y)=>x-y),[10,20]);await first.detach();await second.detach();
});
test('quota/unavailable failures do not claim protection and pause prevents commits',async()=>{
    const unavailable=editRecoveryStore({indexedDB:null});await assert.rejects(unavailable.list());await assert.rejects(unavailable.save({document:document()}));let state;const session=editRecoverySession({store:{save:async()=>{throw Error('quota');}},owner,delay:60000,capture:document,changed:s=>{state=s;}});session.attach();session.change();await session.flush();assert.equal(state.failed,true);assert.equal(state.saved,false);session.setEnabled(false);await session.retry();assert.equal(state.saved,false);await session.detach();
});

test('twenty distinct sessions keep the retention guard; archiving one owned record and explicit retry preserves the other nineteen',async()=>{
    const store=memoryStore();let state;const session=editRecoverySession({store,owner,delay:60000,capture:document,changed:s=>{state=s;}});
    try{
        for(let i=0;i<20;i++){session.attach();session.change();await session.flush();assert.equal(state.saved,true);await session.detach();}
        session.attach();session.change();await session.flush();assert.equal(state.saved,false);assert.equal(state.failed,true);assert.match(state.message,/20 份/);assert.equal(store.records.size,20);
        const [oldKey,old]=store.records.entries().next().value,backup=exportEditSession(readEditRecovery(old).document),others=[...store.records.keys()].filter(k=>k!==oldKey);assert.deepEqual(parseEditSession(backup),document());
        store.records.delete(oldKey);session.external({key:oldKey,owner,revision:old.revision+1,deleted:true},true);await session.retry();assert.equal(state.saved,true);assert.equal(state.failed,false);assert.equal(store.records.size,20);assert.equal(store.records.has(oldKey),false);assert.ok(others.every(k=>store.records.has(k)));
        assert.ok([...store.records.values()].every(r=>exportEditSession(readEditRecovery(r).document)===backup));
    }finally{session.setEnabled(false);await session.detach();}
});
