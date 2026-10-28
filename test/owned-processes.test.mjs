import {test} from 'node:test';
import assert from 'node:assert/strict';
import {parseProcProcess,OwnedProcessTree,findOwnedBrowserRoot} from './browser/owned-processes.mjs';
const row=(pid,parent,rssBytes=100,startTicks=String(pid),state='S')=>({pid,parent,rssBytes,startTicks,state});

test('process identity parser handles spaces and parentheses in comm without confusing start time or RSS',()=>{
    const stat='12 (browser ) with spaces) S 7 '+Array(17).fill('0').join(' ')+' 98765 0 0';
    assert.deepEqual(parseProcProcess(12,'Name:\tbrowser\nVmRSS:\t123 kB\n',stat),row(12,7,123*1024,'98765'));
    for(const [pid,text] of [[13,stat],[12,'12 (x) S 7 0'],[12,stat.replace('98765','invalid')]])assert.throws(()=>parseProcProcess(pid,'',text));
});
test('RSS includes owned descendants and previously observed orphans, excluding unrelated processes',()=>{
    const owner=new OwnedProcessTree(row(10,1));
    assert.deepEqual(owner.sample([row(10,1),row(11,10,200),row(12,11,300),row(20,1,90000)]),{rssBytes:600,processes:3});
    assert.deepEqual(owner.sample([row(10,1),row(11,1,200),row(12,11,300),row(20,1,90000)]),{rssBytes:600,processes:3});
    assert.equal(owner.identities.length,3);
    assert.equal(owner.remaining([row(11,1),row(20,1)]).length,1);
    assert.equal(owner.remaining([row(20,1)]).length,0);
});
test('PID reuse cannot attribute or terminate a foreign process and root loss fails measurement',()=>{
    const owner=new OwnedProcessTree(row(10,1));owner.sample([row(10,1),row(11,10,200)]);
    assert.deepEqual(owner.sample([row(10,1),row(11,1,50000,'other-start')]),{rssBytes:100,processes:1});
    assert.deepEqual(owner.remaining([row(11,1,50000,'other-start')]),[]);
    assert.throws(()=>owner.sample([row(10,1,100,'other-start')]));assert.throws(()=>owner.sample([]));assert.throws(()=>owner.sample([row(10,1,0,'10','Z')]));
});
test('ownership discovery reads only this Node process children and requires an exact per-launch marker',async()=>{
    const marker='a'.repeat(32),rows=[row(10,5),row(11,5),row(20,1)],reads=[],read=async pid=>{reads.push(pid);return pid===10?'MODEL_LENS_PHYSICAL_OWNER='+marker+'\0':'OTHER_MODEL_LENS_PHYSICAL_OWNER='+marker+'\0';};
    assert.deepEqual(await findOwnedBrowserRoot(rows,5,marker,read),{pid:10,startTicks:'10'});assert.deepEqual(reads,[10,11]);
    await assert.rejects(findOwnedBrowserRoot(rows,5,marker,async()=>'MODEL_LENS_PHYSICAL_OWNER='+marker+'\0'));
    await assert.rejects(findOwnedBrowserRoot(rows,5,marker,async()=>''));await assert.rejects(findOwnedBrowserRoot(rows,5,'invalid',read));
});
