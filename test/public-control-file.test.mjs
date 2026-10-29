import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {sha256,buildEvent} from '../scripts/lib/release-artifact.mjs';
import {publicControlFile} from './browser/public-control-file.mjs';

const bytes=Uint8Array.from({length:32},(_,i)=>i*7),spec={expectedBytes:bytes.length,expectedSHA256:sha256(bytes)};
test('public control File records intent before each mutation, verifies bytes and removes only its empty directory',async()=>{
    const events=[],log=async e=>{if(e.artifact_id.endsWith('-file')){
        if(e.event==='create_intent'||e.event==='removed')await assert.rejects(readFile(e.path),{code:'ENOENT'});
        else assert.deepEqual(await readFile(e.path),Buffer.from(bytes));
    }events.push(e);await buildEvent({...e,producer:'test/public-control-file.test.mjs'});};
    const file=await publicControlFile(bytes,{...spec,log});assert.equal(file.record.status,'created');assert.deepEqual(await readFile(file.path),Buffer.from(bytes));await file.cleanup();await file.cleanup();assert.equal(file.record.status,'removed');assert.equal(file.record.directoryRemoved,true);await assert.rejects(readFile(file.path),{code:'ENOENT'});
    for(const target of ['file','directory'])assert.deepEqual(events.filter(e=>e.artifact_id.endsWith('-'+target)).map(e=>e.event),['create_intent','created','delete_intent','removed']);
});
test('unverified, malformed or oversized public bytes fail before creating any temporary file',async()=>{
    const events=[],log=async e=>events.push(e);
    for(const [data,options]of [[bytes,{...spec,expectedBytes:31}],[bytes,{...spec,expectedSHA256:'0'.repeat(64)}],[bytes,{...spec,expectedSHA256:'bad'}],[new Uint8Array(0),spec],[new Uint8Array(16*1024**2+1),spec],[{},spec]])await assert.rejects(publicControlFile(data,{...options,log}));
    assert.deepEqual(events,[]);
});
test('failed deletion-intent persistence retains the file; mutable report paths cannot redirect later cleanup',async()=>{
    let fail=false;const events=[],log=async e=>{if(fail&&e.event==='delete_intent')throw Error('ledger unavailable');events.push(e);await buildEvent({...e,producer:'test/public-control-file.test.mjs'});};
    const file=await publicControlFile(bytes,{...spec,log});fail=true;await assert.rejects(file.cleanup(),/ledger unavailable/);assert.deepEqual(await readFile(file.path),Buffer.from(bytes));assert.equal(file.record.status,'created');
    fail=false;file.record.path='not-an-owned-path';file.record.directory='not-an-owned-directory';file.record.identity={};await file.cleanup();assert.equal(file.record.directoryRemoved,true);await assert.rejects(readFile(file.path),{code:'ENOENT'});assert.ok(events.filter(e=>e.event==='delete_intent').every(e=>!e.path.includes('not-an-owned')));
});
