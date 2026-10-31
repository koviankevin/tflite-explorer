import test from 'node:test';
import assert from 'node:assert/strict';
import {validateWindowsRows} from './browser/windows-process-memory.mjs';
const value=()=>({rows:[{pid:123,parent:20,startTicks:'134378000000000000',state:'R',rssBytes:123456,privateCommitBytes:200000}],identities:[{pid:123,startTicks:'134378000000000000'}],observedAtNs:'12345678'});
test('Windows counters preserve resident and private commit independently without subtracting shared pages',()=>{
 const v=value();assert.equal(validateWindowsRows(v),v);assert.equal(v.rows[0].rssBytes,123456);assert.equal(v.rows[0].privateCommitBytes,200000);
 const ended=value();ended.rows=[];assert.equal(validateWindowsRows(ended,{memory:false}),ended);
});
test('Windows observation rejects recycled PID,unproven identity and unavailable counters',()=>{
 for(const mutate of [v=>v.rows[0].startTicks='134378000000000001',v=>v.rows.push({...v.rows[0]}),v=>v.identities.push({...v.identities[0]}),v=>v.rows[0].rssBytes=0,v=>delete v.rows[0].privateCommitBytes,v=>v.rows[0].state='Z',v=>v.observedAtNs='not-clock',v=>v.observedAtNs=123,v=>v.identities[0].startTicks=123,v=>v.rows[0].parent=-1]){const v=value();mutate(v);assert.throws(()=>validateWindowsRows(v));}
});
test('normal close observations allow absent counters but require original creation identity',()=>{
 const v=value();delete v.rows[0].rssBytes;delete v.rows[0].privateCommitBytes;assert.equal(validateWindowsRows(v,{memory:false}),v);v.rows[0].startTicks='9';assert.throws(()=>validateWindowsRows(v,{memory:false}));
});
