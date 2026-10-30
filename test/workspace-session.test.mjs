import {test} from 'node:test';
import assert from 'node:assert/strict';
import {WorkspaceHistory} from '../src/workspace-history.js';
import {workspaceSession} from '../src/workspace-session.js';
import {readDraft,DraftConflict,draftModelKey} from '../src/workspace-drafts.js';
import {parseWorkspace,exportWorkspace,DRAFT_FIELDS} from '../src/workspace.js';
const identity={name:'draft.tflite',bytes:1024,sourceFormat:'tflite',signature:'a'.repeat(64)};
const pattern={nodes:[{alias:'N1',type:'Reshape'},{alias:'N2',type:'Transpose'}],edges:[{from:'N1',to:'N2'}],induced:false};
const fixture=()=>structuredClone({format:'model-lens-workspace',version:2,identity,state:{kind:'layers',query:'',scope:'all',graph:0,view:'graph',activeIndex:-1,resultKey:null,pattern,patternText:'N1:Reshape -> N2:Transpose',patternMode:'visual',patternName:'draft',font:'32',direction:'horizontal',sidebarWidth:344,exportScope:'slice',full:false,collapsed:false,picking:true,across:false,captureName:'selection',selections:[],overviewExpanded:[],sliceDetails:false,expanded:[],pages:[],camera:{kind:'svg',zoom:1,scrollLeft:0,scrollTop:0,candidates:[],page:null},editor:{nodes:structuredClone(pattern.nodes),edges:structuredClone(pattern.edges),nextNode:2,induced:false,visualOpen:true,cfg:null,conditions:[],fields:{...Object.fromEntries(DRAFT_FIELDS.map(k=>[k,''])),'condition-kind':'shape','condition-side':'output'}}}});
function memoryStore() {
    const records=new Map();return {records,async list(id){return [...records.values()].filter(r=>!id || r.modelKey===draftModelKey(id)).sort((a,b)=>b.updatedAt-a.updatedAt);},async save({key,revision,workspace,owner}){const old=records.get(key);if((old?.revision || 0)!==revision)throw new DraftConflict();const record={schemaVersion:1,key,modelKey:draftModelKey(workspace.identity),revision:revision+1,owner,updatedAt:Date.now(),text:exportWorkspace(workspace),previous:old?.text || null};records.set(key,record);return record;}};
}
test('v2 round trip preserves unfinished text, disconnected visual nodes and unsubmitted condition fields; v1 still loads',()=>{
    const value=fixture();value.state.patternText='N1:Reshape -> ';value.state.patternMode='text';value.state.editor.nodes.push({alias:'N3',type:'Custom'});value.state.editor.fields['condition-value']='1, *, unfinished';
    const saved=parseWorkspace(exportWorkspace(value));assert.equal(saved.state.patternText,'N1:Reshape -> ');assert.equal(saved.state.editor.nodes.length,3);assert.equal(saved.state.editor.fields['condition-value'],'1, *, unfinished');
    const old=fixture();old.version=1;delete old.state.editor;assert.equal(parseWorkspace(exportWorkspace(old)).version,1);
    value.state.editor.model=new Uint8Array(500);assert.equal(parseWorkspace(exportWorkspace(value)).state.editor.model,undefined);
    value.state.editor.cfg={mode:'unknown',nodes:[],edges:[]};assert.throws(()=>exportWorkspace(value));
    value.version=3;assert.throws(()=>exportWorkspace(value));
});
test('history retains count/byte budgets and discards redo only for a real new edit',()=>{
    const h=new WorkspaceHistory({limit:3,bytes:100000});const value=fixture();
    for(let i=0;i<5;i++){value.state.query=String(i);h.push(value);}assert.equal(h.entries.length,3);assert.equal(h.canUndo,true);
    h.move(h.target(-1).position);assert.equal(h.canRedo,true);assert.equal(h.push(h.current),false);assert.equal(h.canRedo,true);
    value.state.query='new';h.push(value);assert.equal(h.canRedo,false);
    const bounded=new WorkspaceHistory({limit:50,bytes:5000});for(let i=0;i<10;i++){value.state.query=String(i);bounded.push(value);}assert.ok(bounded.bytes<=5000 || bounded.entries.length===1);
    bounded.clear();assert.equal(bounded.current,null);assert.equal(bounded.bytes,0);
});
test('Undo/Redo survives restore camera rounding and autosave without losing the redo branch',async()=>{
    const store=memoryStore();let value=fixture(),state;
    const controller=workspaceSession({store,owner:'tab-a',capture:()=>value,delay:60000,changed:s=>state=s,apply:async w=>{value=structuredClone(w);value.state.camera.zoom+=1e-9;}});
    try {
        await controller.attach(identity);await controller.flush();value.state.selections=[{graph:0,nodes:[1]}];await controller.flush();assert.equal(state.canUndo,true);
        await controller.travel(-1);assert.deepEqual(value.state.selections,[]);await controller.flush();assert.equal(state.canRedo,true);
        await controller.travel(1);assert.deepEqual(value.state.selections,[{graph:0,nodes:[1]}]);assert.equal(state.canRedo,false);
    }finally{controller.detach();}
});
test('concurrent tabs preserve both copies with CAS conflict and an explicit fork',async()=>{
    const store=memoryStore();let a=fixture(),b=fixture(),stateB;
    const first=workspaceSession({store,owner:'a',capture:()=>a,apply:async w=>a=w,delay:60000});
    const second=workspaceSession({store,owner:'b',capture:()=>b,apply:async w=>b=w,changed:s=>stateB=s,delay:60000});
    try {
        await first.attach(identity);await second.attach(identity);a.state.query='first';b.state.query='second';await first.flush();await second.flush();
        assert.equal(stateB.conflict,true);assert.equal(store.records.size,1);assert.equal(readDraft([...store.records.values()][0]).workspace.state.query,'first');
        assert.equal(parseWorkspace(second.current).state.query,'second');await second.fork();assert.equal(store.records.size,2);assert.equal(stateB.conflict,false);
        assert.deepEqual([...store.records.values()].map(r=>readDraft(r).workspace.state.query).sort(),['first','second']);
    }finally{first.detach();second.detach();}
});
test('existing drafts are not overwritten until restore or fork; damaged head uses last good text',async()=>{
    const store=memoryStore();const saved=fixture();saved.state.query='last good';let current=fixture(),ui;
    const record=await store.save({key:draftModelKey(identity),revision:0,owner:'old',workspace:saved});
    record.previous=record.text;record.text='corrupt';assert.equal(readDraft(record).recoveredPrevious,true);
    const controller=workspaceSession({store,owner:'new',capture:()=>current,apply:async w=>current=w,changed:s=>ui=s,delay:60000});
    try {
        await controller.attach(identity);current.state.query='fresh';await controller.flush();assert.equal(record.text,'corrupt');assert.equal(ui.pending,true);
        await controller.resume(record);assert.equal(current.state.query,'last good');assert.equal(ui.pending,false);
        assert.throws(()=>readDraft({...record,schemaVersion:2}),/不支援/);
        const future=JSON.parse(record.previous);future.version=3;
        assert.throws(()=>readDraft({...record,text:JSON.stringify(future)}),/不支援/,'future format must not be replaced by an older backup');
    }finally{controller.detach();}
});
test('IDB unavailable still allows in-memory history and visible failure without claiming saved',async()=>{
    let current=fixture(),ui;const unavailable={list:async()=>{throw new Error('storage blocked');},save:async()=>{throw new Error('storage blocked');}};
    const controller=workspaceSession({store:unavailable,owner:'tab',capture:()=>current,apply:async w=>current=w,changed:s=>ui=s,delay:60000});
    try{await controller.attach(identity);assert.match(ui.message,/無法讀取/);current.state.query='edited';await controller.flush();assert.equal(ui.canUndo,true);await controller.travel(-1);assert.equal(current.state.query,'');}
    finally{controller.detach();}
});

test('a failed committed write stays visibly failed, preserves history and stops automatic retries',async()=>{
    const store=memoryStore(),save=store.save;let current=fixture(),ui,blocked=false,calls=0;
    store.save=async args=>{calls++;if(blocked)throw new DOMException('Storage quota exceeded','QuotaExceededError');return save(args);};
    const controller=workspaceSession({store,owner:'quota-tab',capture:()=>current,apply:async w=>current=w,changed:s=>ui=s,delay:60000});
    try {
        await controller.attach(identity);await controller.flush();const committed=[...store.records.values()][0];
        blocked=true;current.state.query='unsaved selection';await controller.flush();
        assert.equal(ui.storageFailed,true,'a transaction failure must not look like autosave is protecting new changes');
        assert.equal(ui.saving,false);assert.equal(ui.conflict,false);assert.match(ui.message,/尚未儲存|無法保存/);
        assert.equal(readDraft([...store.records.values()][0]).workspace.state.query,'');assert.equal(store.records.get(committed.key).revision,1);
        const failures=calls;current.state.query='newer unsaved selection';controller.change();await controller.flush();
        assert.equal(calls,failures,'ordinary editing must not continually retry a failing database');assert.equal(ui.storageFailed,true);
        assert.equal(parseWorkspace(controller.current).state.query,'newer unsaved selection');
        await controller.travel(-1);assert.equal(current.state.query,'unsaved selection');assert.equal(ui.canRedo,true);assert.equal(ui.storageFailed,true);
    }finally{await controller.detach();}
});

test('explicit retry saves the latest unsaved state only after the database commits',async()=>{
    const store=memoryStore(),save=store.save;let current=fixture(),ui,blocked=true,release,entered;
    const started=new Promise(resolve=>entered=resolve);
    store.save=async args=>{if(blocked)throw new DOMException('Denied','SecurityError');entered();await new Promise(resolve=>release=resolve);return save(args);};
    const controller=workspaceSession({store,owner:'retry-tab',capture:()=>current,apply:async w=>current=w,changed:s=>ui=s,delay:60000});
    try {
        await controller.attach(identity);current.state.query='first';await controller.flush();
        current.state.query='latest';controller.change();blocked=false;const retry=controller.retry();await started;
        assert.equal(ui.saving,true);assert.equal(store.records.size,0);
        release();await retry;assert.equal(ui.storageFailed,false);assert.equal(ui.saving,false);
        assert.match(ui.message,/已自動儲存/);assert.equal(readDraft([...store.records.values()][0]).workspace.state.query,'latest');
        assert.equal(ui.canUndo,true);
    }finally{release?.();await controller.detach();}
});

test('retry after a failed initial read discovers existing drafts without overwriting or discarding local edits',async()=>{
    const store=memoryStore(),list=store.list;let current=fixture(),ui,blocked=true;
    const saved=fixture();saved.state.query='previous saved work';const record=await store.save({key:draftModelKey(identity),revision:0,owner:'previous',workspace:saved});
    store.list=async id=>{if(blocked)throw new DOMException('Denied','SecurityError');return list(id);};
    const controller=workspaceSession({store,owner:'retry-read',capture:()=>current,apply:async w=>current=w,changed:s=>ui=s,delay:60000});
    try {
        await controller.attach(identity);current.state.query='new unsaved work';await controller.flush();blocked=false;await controller.retry();
        assert.equal(ui.storageFailed,false);assert.equal(ui.pending,true);assert.equal(current.state.query,'new unsaved work');
        assert.equal(store.records.size,1);assert.equal(store.records.get(record.key).revision,1);assert.equal(readDraft(record).workspace.state.query,'previous saved work');
        await controller.fork();assert.equal(store.records.size,2);assert.equal(ui.pending,false);
        assert.deepEqual([...store.records.values()].map(r=>readDraft(r).workspace.state.query).sort(),['new unsaved work','previous saved work']);
    }finally{await controller.detach();}
});

test('a late read retry cannot attach an old draft to a different model',async()=>{
    const store=memoryStore(),list=store.list;let current=fixture(),ui,reads=0,release,entered;
    const started=new Promise(resolve=>entered=resolve);
    store.list=async id=>{reads++;if(reads===1)throw new Error('unavailable');if(reads===2){entered();await new Promise(resolve=>release=resolve);}return list(id);};
    const controller=workspaceSession({store,owner:'switch-read',capture:()=>current,apply:async w=>current=w,changed:s=>ui=s,delay:60000});
    try {
        await controller.attach(identity);const retry=controller.retry();await started;await controller.detach();
        current=fixture();current.identity={...identity,name:'other.mlir',sourceFormat:'mlir',signature:'c'.repeat(64)};
        await controller.attach(current.identity);release();await retry;await controller.flush();
        assert.equal(ui.storageFailed,false);assert.equal(controller.identity.name,'other.mlir');
        assert.equal(store.records.size,1);assert.equal(readDraft([...store.records.values()][0]).workspace.identity.sourceFormat,'mlir');
    }finally{release?.();await controller.detach();}
});

test('failed retry remains retryable, paused autosave cannot commit and a peer revision still wins',async()=>{
    const store=memoryStore(),save=store.save;let current=fixture(),ui,blocked=true;
    store.save=args=>{if(blocked)throw new DOMException('Quota exceeded','QuotaExceededError');return save(args);};
    const controller=workspaceSession({store,owner:'safe-retry',capture:()=>current,apply:async w=>current=w,changed:s=>ui=s,delay:60000});
    try {
        await controller.attach(identity);await controller.flush();await controller.retry();assert.equal(ui.storageFailed,true);assert.equal(ui.saving,false);
        controller.setEnabled(false);blocked=false;await controller.retry();assert.equal(store.records.size,0);assert.equal(ui.storageFailed,true);
        controller.setEnabled(true);await controller.retry();assert.equal(ui.storageFailed,false);const old=[...store.records.values()][0];
        blocked=true;current.state.query='local';await controller.flush();assert.equal(ui.storageFailed,true);
        const peer=fixture();peer.state.query='peer';blocked=false;await save({key:old.key,revision:old.revision,owner:'peer',workspace:peer});
        await controller.retry();assert.equal(ui.conflict,true);assert.equal(ui.storageFailed,false);assert.equal(current.state.query,'local');
        await controller.retry();assert.equal(readDraft(store.records.get(old.key)).workspace.state.query,'peer');assert.equal(store.records.size,1);
    }finally{await controller.detach();}
});

test('a synchronous read retry failure does not leave a permanently pending retry',async()=>{
    const store=memoryStore(),list=store.list;let current=fixture(),ui,blocked=true;
    store.list=id=>{if(blocked)throw new Error('unavailable');return list(id);};
    const controller=workspaceSession({store,owner:'sync-read',capture:()=>current,apply:async w=>current=w,changed:s=>ui=s,delay:60000});
    try {
        await controller.attach(identity);await controller.retry();assert.equal(ui.storageFailed,true);assert.equal(ui.saving,false);
        blocked=false;await controller.retry();assert.equal(ui.storageFailed,false);assert.equal(store.records.size,1);
    }finally{await controller.detach();}
});
test('an old in-flight save cannot write a newly opened model under its old identity',async()=>{
    const store=memoryStore(),save=store.save;let release,started;
    const entered=new Promise(resolve=>started=resolve);store.save=async args=>{if(args.workspace.identity.signature===identity.signature){started();await new Promise(resolve=>release=resolve);}return save(args);};
    let current=fixture();const controller=workspaceSession({store,owner:'tab',capture:()=>current,apply:async w=>current=w,delay:60000});
    try {
        await controller.attach(identity);const pending=controller.flush();await entered;controller.detach();current=fixture();current.identity={...identity,name:'other.mlir',sourceFormat:'mlir',signature:'b'.repeat(64)};
        await controller.attach(current.identity);release();await pending;await controller.flush();
        assert.equal(store.records.size,2);assert.deepEqual([...store.records.values()].map(r=>readDraft(r).workspace.identity.sourceFormat).sort(),['mlir','tflite']);
    }finally{controller.detach();}
});
test('closing during an in-flight save retains the final UI snapshot even when search/export is busy',async()=>{
    const store=memoryStore(),save=store.save;let release,started,waited=false,ready=true,current=fixture();
    const entered=new Promise(resolve=>started=resolve);
    store.save=async args=>{if(!waited){waited=true;started();await new Promise(resolve=>release=resolve);}return save(args);};
    const controller=workspaceSession({store,owner:'tab',capture:()=>current,apply:async w=>current=w,ready:()=>ready,delay:60000});
    await controller.attach(identity);const pending=controller.flush();await entered;
    current.state.query='final unsaved edit';ready=false;const closing=controller.detach();release();await pending;await closing;
    assert.equal(readDraft([...store.records.values()][0]).workspace.state.query,'final unsaved edit');
});
test('layout settles before checkpoints so a clear-selection action takes one Undo and keeps Redo',async()=>{
    const store=memoryStore();let current=fixture(),layoutPending=false;
    current.state.selections=[{graph:0,nodes:[1]}];
    const settle=async()=>{if(layoutPending){current.state.camera.scrollTop=40;layoutPending=false;}};
    const controller=workspaceSession({store,owner:'tab',capture:()=>current,delay:60000,settle,apply:async w=>{current=structuredClone(w);await settle();}});
    try {
        await controller.attach(identity);await controller.flush();
        current.state.selections=[];layoutPending=true;await controller.flush();
        await controller.travel(-1);assert.deepEqual(current.state.selections,[{graph:0,nodes:[1]}]);
        await controller.flush();await controller.travel(1);assert.deepEqual(current.state.selections,[]);assert.equal(current.state.camera.scrollTop,40);
    }finally{controller.detach();}
});
test('a draft checkpoint requested during Undo waits for the restored selection instead of saving the old state',async()=>{
    const store=memoryStore();let current=fixture(),release,entered;
    current.state.selections=[{graph:0,nodes:[1]}];const applying=new Promise(resolve=>entered=resolve);
    const controller=workspaceSession({store,owner:'tab',capture:()=>current,delay:60000,apply:async w=>{current=structuredClone(w);entered();await new Promise(resolve=>release=resolve);}});
    try {
        await controller.attach(identity);await controller.flush();current.state.selections=[];await controller.flush();
        const undo=controller.travel(-1);await applying;let saved=false;const checkpoint=controller.flush({force:true}).then(()=>saved=true);
        await Promise.resolve();assert.equal(saved,false);assert.deepEqual(readDraft([...store.records.values()][0]).workspace.state.selections,[]);
        release();await undo;await checkpoint;assert.deepEqual(readDraft([...store.records.values()][0]).workspace.state.selections,[{graph:0,nodes:[1]}]);
    }finally{controller.detach();}
});
