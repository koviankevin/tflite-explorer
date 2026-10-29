import {test} from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {workerStartupDocument} from './browser/worker-startup-control.mjs';

// Execute only the synthetic fixture script in Node: no local browser.
function fixture(){
    const elements=Object.fromEntries(['start','stop','kind','timing','result'].map(id=>[id,{dataset:{},value:id==='kind'?'module':'immediate',textContent:''}])),workers=[],revoked=[];
    class NativeWorker{constructor(url,options){this.url=url;this.options=options;this.calls=0;workers.push(this);}terminate(){this.calls++;}}
    const context={document:{getElementById:id=>elements[id]},Worker:NativeWorker,Blob,Date,URL:{createObjectURL:()=>`blob:test-${workers.length+1}`,revokeObjectURL:url=>revoked.push(url)}};
    const script=workerStartupDocument().match(/<script>([\s\S]*)<\/script>/)[1];vm.runInNewContext(script,context);
    return {elements,workers,revoked,rows:()=>JSON.parse(elements.result.textContent)};
}
test('startup control immediately terminates the original native Worker and revokes its URL',()=>{
    const f=fixture();f.elements.start.onclick();const [row]=f.rows();assert.equal(f.workers.length,1);assert.equal(f.workers[0].calls,1);assert.equal(f.workers[0].options.type,'module');assert.equal(row.readyAt,null);assert.ok(row.terminateReturnedAt>=row.createdAt);assert.equal(row.revoked,true);assert.deepEqual(f.revoked,[row.url]);assert.equal('closed'in row,false);
});
test('ready control waits for an actual message, then uses the same stop button',()=>{
    const f=fixture();f.elements.kind.value='classic';f.elements.timing.value='ready';f.elements.start.onclick();assert.equal(f.workers[0].calls,0);assert.equal(f.elements.result.dataset.state,'starting');f.workers[0].onmessage({data:'ready'});assert.equal(f.elements.result.dataset.state,'ready');f.elements.stop.onclick();assert.equal(f.workers[0].calls,1);assert.ok(f.rows()[0].readyAt!==null);assert.equal(f.rows()[0].kind,'classic');assert.equal(f.elements.result.dataset.state,'terminated');
});
