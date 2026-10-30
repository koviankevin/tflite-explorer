import {test} from 'node:test';
import assert from 'node:assert/strict';
import {startApplication} from '../src/bootstrap.js';

test('pending application stays loading until the real initialization settles',async()=>{
    const events=[];let finish,calls=0;
    const initialized=new Promise(resolve=>{finish=resolve;});
    const result=startApplication(()=>{calls++;return initialized;},(...args)=>events.push(args));
    await Promise.resolve();assert.deepEqual(events,[['loading']]);assert.equal(calls,1);
    finish();assert.equal(await result,true);assert.deepEqual(events,[['loading'],['ready']]);
});
test('failed dependency and synchronous initialization errors yield recoverable failure without exposing error data or retrying',async()=>{
    for(const load of [()=>Promise.reject(new Error('private-model-name /home/engineer/source.mlir')),()=>{throw new Error('private-model-name');}]){
        const events=[];let calls=0;
        assert.equal(await startApplication(()=>{calls++;return load();},(...args)=>events.push(args)),false);
        assert.equal(calls,1);assert.deepEqual(events,[['loading'],['failed']]);
        await Promise.resolve();assert.deepEqual(events,[['loading'],['failed']]);
    }
});
