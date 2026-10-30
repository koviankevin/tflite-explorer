import test from 'node:test';
import assert from 'node:assert/strict';
import {draftStore} from '../src/workspace-drafts.js';
import {editRecoveryStore} from '../src/edit-recovery-store.js';
import {patternStore} from '../src/pattern-store.js';

// Control only the IDB open/event boundary. These are connection lifecycle
// tests, not an IndexedDB implementation or a real browser permission audit.
function factory(){
    const requests=[];let denied=false,calls=0;
    return {requests,get calls(){return calls;},set denied(value){denied=value;},open(){
        calls++;if(denied)throw new DOMException('Synthetic open denial','SecurityError');
        const request={};requests.push(request);return request;
    }};
}
function database(){
    const db={closes:0,transactions:0,close(){this.closes++;},transaction(){
        this.transactions++;const tx={};
        const request=result=>{const r={result};queueMicrotask(()=>{r.onsuccess();queueMicrotask(()=>tx.oncomplete?.());});return r;};
        tx.objectStore=()=>({getAll:()=>request([]),get:()=>request({key:'library',schemaVersion:1,revision:1,patterns:[]}),put(){assert.fail('A connection read must not rewrite the existing pattern record.');}});
        return tx;
    }};return db;
}
function succeed(request,db=database()){request.result=db;request.onsuccess();return db;}
function fail(request){request.error=new DOMException('Synthetic request failure','UnknownError');request.onerror();}
const adapters=[
    {name:'exploration drafts',create:indexedDB=>draftStore({indexedDB}),read:store=>store.list()},
    {name:'edit recovery',create:indexedDB=>editRecoveryStore({indexedDB}),read:store=>store.list()},
    {name:'pattern library',create:indexedDB=>patternStore({indexedDB,legacyStorage:()=>{assert.fail('Existing pattern record must not read legacy storage.');}}),read:async store=>(await store.load()).patterns}
];
for(const {name,create,read} of adapters){
    test(`${name}: explicit retry reopens after a synchronous open rejection`,async()=>{
        const idb=factory(),store=create(idb);idb.denied=true;
        await assert.rejects(read(store),{name:'SecurityError'});idb.denied=false;
        const retried=read(store);retried.catch(()=>{});
        assert.equal(idb.calls,2,'the rejected connection Promise must not suppress a new open');
        const db=succeed(idb.requests[0]);assert.deepEqual(await retried,[]);assert.equal(db.transactions,1);await store.close();assert.equal(db.closes,1);
    });
    test(`${name}: concurrent reads share one open and an asynchronous failure stays retryable`,async()=>{
        const idb=factory(),store=create(idb),a=read(store),b=read(store);
        const rejected=Promise.all([assert.rejects(a,{name:'UnknownError'}),assert.rejects(b,{name:'UnknownError'})]);
        assert.equal(idb.calls,1);fail(idb.requests[0]);await rejected;
        const retry=read(store);assert.equal(idb.calls,2);const db=succeed(idb.requests[1]);assert.deepEqual(await retry,[]);
        assert.deepEqual(await read(store),[]);assert.equal(idb.calls,2);await store.close();assert.equal(db.closes,1);
    });
    test(`${name}: late callbacks from a blocked request cannot invalidate the newer connection`,async()=>{
        const idb=factory(),store=create(idb),first=read(store),rejected=assert.rejects(first,/阻擋/),old=idb.requests[0];old.onblocked();await rejected;
        const retry=read(store),fresh=idb.requests[1];assert.equal(idb.calls,2);
        // A delayed failure from the abandoned attempt must not evict fresh.
        fail(old);const another=read(store);another.catch(()=>{});assert.equal(idb.calls,2);
        const db=succeed(fresh);assert.deepEqual(await retry,[]);assert.deepEqual(await another,[]);
        assert.deepEqual(await read(store),[]);assert.equal(idb.calls,2);await store.close();assert.equal(db.closes,1);
    });
    test(`${name}: a blocked request that later succeeds is closed without replacing the active database`,async()=>{
        const idb=factory(),store=create(idb),first=read(store),rejected=assert.rejects(first,/阻擋/),old=idb.requests[0];old.onblocked();await rejected;
        const retry=read(store),fresh=idb.requests[1];assert.equal(idb.calls,2);
        const abandoned=succeed(old);assert.equal(abandoned.closes,1);assert.equal(abandoned.transactions,0);
        const db=succeed(fresh);assert.deepEqual(await retry,[]);assert.deepEqual(await read(store),[]);assert.equal(idb.calls,2);
        await store.close();assert.equal(db.closes,1);
    });
    test(`${name}: a stale versionchange callback cannot clear a replacement database`,async()=>{
        const idb=factory(),store=create(idb),first=read(store),old=succeed(idb.requests[0]);await first;const late=old.onversionchange;
        await store.close();const retry=read(store),fresh=succeed(idb.requests[1]);await retry;late();
        const again=read(store);again.catch(()=>{});assert.equal(idb.calls,2,'stale close must not evict the replacement');
        assert.deepEqual(await again,[]);assert.equal(fresh.closes,0);await store.close();assert.equal(fresh.closes,1);
    });
}
