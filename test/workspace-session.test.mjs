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
