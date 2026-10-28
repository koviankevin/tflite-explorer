import {test} from 'node:test';
import assert from 'node:assert/strict';
import {snapshotLifecycleAudit,installLifecycleDOMProof} from './browser/lifecycle-dom-proof.mjs';
const counters=()=>({bytes:12,calls:1,maxRead:12,violations:[]});
test('cross-engine proof copies only counters and strips raw messages/model data without accessing them',()=>{
    const state={audit:counters(),workers:[{url:'http://localhost/src/model-worker.js',terminated:true,audit:counters(),stats:{bytesRead:12,fileBytes:1349965216},payload:new Blob(['private-weight'])}],urls:[{url:'blob:observer',bytes:100,revoked:true}]};
    Object.defineProperty(state,'model',{get(){throw Error('Model must never be read.');}});
    const proof=snapshotLifecycleAudit(state);assert.equal(proof.workers[0].payload,undefined);assert.deepEqual(proof.workers[0].stats,state.workers[0].stats);proof.audit.violations.push('changed');assert.deepEqual(state.audit.violations,[]);
    assert.throws(()=>snapshotLifecycleAudit({...state,audit:{...counters(),bytes:NaN}}));assert.throws(()=>snapshotLifecycleAudit({...state,workers:Array(129).fill({})}));
});
test('proof bridge exports metadata only on the explicit test event, without inserting or focusing DOM nodes',()=>{
    const previous={document:globalThis.document,state:globalThis.__lifecycle},attributes=new Map();let listener,event;
    try{
        globalThis.document={addEventListener(name,fn){event=name;listener=fn;},documentElement:{setAttribute(name,value){attributes.set(name,value);}}};globalThis.__lifecycle={audit:counters(),workers:[],urls:[]};
        installLifecycleDOMProof(snapshotLifecycleAudit);assert.equal(attributes.size,0);assert.equal(event,'model-lens-lifecycle-observe');listener();assert.deepEqual(JSON.parse(attributes.get('data-model-lens-lifecycle-proof')),globalThis.__lifecycle);
    }finally{if(previous.document===undefined)delete globalThis.document;else globalThis.document=previous.document;if(previous.state===undefined)delete globalThis.__lifecycle;else globalThis.__lifecycle=previous.state;}
});
