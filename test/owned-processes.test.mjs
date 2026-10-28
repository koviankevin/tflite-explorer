import {test} from 'node:test';
import assert from 'node:assert/strict';
import {parseProcProcess,OwnedProcessTree,findOwnedBrowserRoot} from './browser/owned-processes.mjs';
import {parseProcessMemory,createProcessMemoryProbe,summarizeMemoryProfile} from './browser/process-memory-profile.mjs';
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

const status=(rss=100)=>`Name:\tWeb Content\nVmRSS:\t${rss} kB\nRssAnon:\t80 kB\nRssFile:\t16 kB\nRssShmem:\t4 kB\n`;
const procStat=(pid,ticks=String(pid))=>`${pid} (Web Content) S 7 `+Array(17).fill('0').join(' ')+` ${ticks} 0 0`;
const anchor=()=>({elapsedMs:10,phase:'cycle-1-full-export',rssBytes:100*1024,processes:1});

test('supplementary RSS parser preserves component units, real zero and unavailable values',()=>{
    assert.deepEqual(parseProcessMemory(status()),{name:'Web Content',rssBytes:102400,anonymousBytes:81920,fileBytes:16384,sharedBytes:4096});
    assert.equal(parseProcessMemory(status().replace('4 kB','0 kB')).sharedBytes,0);
    assert.equal(parseProcessMemory(status().replace('RssShmem:\t4 kB\n','')).sharedBytes,null);
    assert.deepEqual(parseProcessMemory(''),{name:null,rssBytes:null,anonymousBytes:null,fileBytes:null,sharedBytes:null});
    assert.equal(parseProcessMemory(status().replace('Web Content','/private/model/path')).name,null);
    for(const text of [status().replace('80 kB','-1 kB'),status().replace('80 kB','80 MB'),status().replace('80 kB','9007199254740991 kB'),status()+'RssAnon:\t80 kB\n'])assert.throws(()=>parseProcessMemory(text));
});

test('memory probe reads only supplied owned identities and retains timing differences from the RSS gate',async()=>{
    const reads=[],probe=createProcessMemoryProbe({now:()=>20,readText:async file=>{reads.push(file);return file.endsWith('/status')?status(105):procStat(12);}});
    const observed=await probe.capture([{pid:12,startTicks:'12'}],anchor());
    assert.deepEqual(reads,['/proc/12/stat','/proc/12/status','/proc/12/stat']);assert.equal(observed.gateRssBytes,102400);assert.equal(observed.totals.rssBytes,107520);assert.equal(observed.differenceFromGateRSSBytes,5120);assert.equal(observed.observedStartMs,20);assert.equal(observed.observedEndMs,20);
    const summary=summarizeMemoryProfile({format:'model-lens-proc-memory',version:1,samples:[observed]},[anchor()]);assert.equal(summary.completeObservations,1);assert.equal(summary.phasePeaks[0].phase,'full-export');assert.equal(summary.phasePeaks[0].differenceFromGateRSSBytes,5120);
});

test('process exit and PID reuse remain missing evidence, never zero or a foreign process memory',async()=>{
    for(const mode of ['exit','reuse','late-reuse']){
        let statReads=0;const probe=createProcessMemoryProbe({now:()=>20,readText:async file=>{if(mode==='exit')throw Object.assign(Error('gone'),{code:'ENOENT'});return file.endsWith('/status')?status(9999):procStat(12,mode==='late-reuse'&&++statReads===1?'12':'999');}});
        const observed=await probe.capture([{pid:12,startTicks:'12'}],anchor());assert.deepEqual(observed.processes,[{pid:12,startTicks:'12',observation:mode==='exit'?'exited':'reused'}]);assert.equal(observed.totals.rssBytes,null);assert.equal(observed.differenceFromGateRSSBytes,null);
        const summary=summarizeMemoryProfile({format:'model-lens-proc-memory',version:1,samples:[observed]},[anchor()]);assert.equal(summary.completeObservations,0);assert.equal(summary[mode==='exit'?'exitedObservations':'reusedPidObservations'],1);
    }
    const probe=createProcessMemoryProbe({now:()=>20,readText:async()=>{throw Object.assign(Error('denied'),{code:'EACCES'});}});await assert.rejects(probe.capture([{pid:12,startTicks:'12'}],anchor()),/denied/);
});

test('unknown component fields cannot silently produce a complete memory profile',async()=>{
    const probe=createProcessMemoryProbe({now:()=>20,readText:async file=>file.endsWith('/status')?'Name:\tWeb Content\nVmRSS:\t100 kB\n':procStat(12)}),observed=await probe.capture([{pid:12,startTicks:'12'}],anchor());
    assert.equal(observed.totals.rssBytes,102400);assert.equal(observed.totals.anonymousBytes,null);
    assert.equal(summarizeMemoryProfile({format:'model-lens-proc-memory',version:1,samples:[observed]},[anchor()]).completeObservations,0);
});

test('probe rejects foreign input, malformed counters, unsafe bounds and an unanchored clock before claiming observations',async()=>{
    let reads=0;const probe=createProcessMemoryProbe({now:()=>5,readText:async file=>{reads++;return file.endsWith('/status')?status():procStat(12);}});
    for(const ids of [[],[{pid:1,startTicks:'1'}],[{pid:12,startTicks:'bad'}],[{pid:12,startTicks:'12'},{pid:12,startTicks:'12'}],Array.from({length:129},(_,i)=>({pid:i+2,startTicks:'1'}))])await assert.rejects(probe.capture(ids,anchor()));
    assert.equal(reads,0);await assert.rejects(probe.capture([{pid:12,startTicks:'12'}],{...anchor(),phase:'private/model'}));assert.equal(reads,0);
    await assert.rejects(probe.capture([{pid:12,startTicks:'12'}],anchor()),/clock/);
});

test('profile summaries reject altered gate anchors, totals, identities and hidden read-time RSS changes',async()=>{
    const probe=createProcessMemoryProbe({now:()=>20,readText:async file=>file.endsWith('/status')?status(105):procStat(12)}),observed=await probe.capture([{pid:12,startTicks:'12'}],anchor());
    for(const mutate of [m=>m.phase='source',m=>m.elapsedMs++,m=>m.gateRssBytes++,m=>m.observedStartMs=1,m=>m.observedEndMs=0,m=>m.processes.push({...m.processes[0]}),m=>m.processes[0].observation='unknown',m=>m.processes[0].rssBytes=-1,m=>m.totals.rssBytes=1,m=>m.differenceFromGateRSSBytes=0]){
        const m=structuredClone(observed);mutate(m);assert.throws(()=>summarizeMemoryProfile({format:'model-lens-proc-memory',version:1,samples:[m]},[anchor()]));
    }
    assert.throws(()=>summarizeMemoryProfile({format:'model-lens-proc-memory',version:1,samples:[]},[anchor()]));
});
