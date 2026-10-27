import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {GATES,assertRun,assertReport,sourceScope,gitReader,readArtifact} from '../scripts/lib/release-gates.mjs';
import {RELEASE_CONTRACT_TESTS} from '../scripts/lib/release-test-plan.mjs';
import {MODEL_EDIT_LIFECYCLE_POLICY} from './browser/lifecycle-policy.mjs';
const repository='koviankevin/tflite-explorer',commit='a'.repeat(40),tree='b'.repeat(40);
function evidence(kind='browser'){
    const spec=GATES[kind];return {run:{id:123,status:'completed',conclusion:'success',event:'workflow_dispatch',head_branch:'main',head_repository:{full_name:repository},path:spec.workflow,head_sha:commit,run_attempt:1},jobs:[{name:spec.job,status:'completed',conclusion:'success'}],artifact:{id:456,name:`${spec.artifact}-${commit}-1`,expired:false,size_in_bytes:100,digest:'sha256:'+'c'.repeat(64)}};
}
test('release gate rejects unsuccessful, foreign, PR and stale-attempt workflows before trusting reports',()=>{
    for(const kind of Object.keys(GATES))assert.doesNotThrow(()=>assertRun(evidence(kind),kind,repository));
    for(const [key,value] of Object.entries({status:'in_progress',conclusion:'failure',event:'pull_request',head_branch:'other',path:'.github/workflows/other.yml',head_sha:'bad',head_repository:{full_name:'other/repo'},run_attempt:2})){
        const e=evidence();e.run[key]=value;assert.throws(()=>assertRun(e,'browser',repository),key);
    }
    for(const change of [e=>e.jobs=[],e=>e.jobs[0].conclusion='skipped',e=>e.jobs.push({...e.jobs[0]}),e=>e.artifact.expired=true,e=>e.artifact.digest=null,e=>e.artifact.size_in_bytes=undefined,e=>e.artifact.size_in_bytes=5*1024**2]){const e=evidence();change(e);assert.throws(()=>assertRun(e,'browser',repository));}
});
test('a passed label cannot replace actual browser/worker/read/release evidence',async()=>{
    const report=JSON.parse(await readFile(new URL('../docs/results/browser-lifecycle-2026-10-27.json',import.meta.url))),run={head_sha:report.environment.sourceCommit};
    assert.doesNotThrow(()=>assertReport(report,'browser',run,report.environment.sourceTree));
    const worker=r=>r.audit.workers.find(w=>w.url.includes('/model-worker.js'));
    for(const [i,change] of [r=>r.cycles.pop(),r=>r.errors.push('error'),r=>worker(r).terminated=false,r=>worker(r).audit.bytes++,r=>r.audit.urls[0].revoked=false,r=>r.environment.sourceDirty=true,r=>r.policy.cycles=1,r=>r.browserClosed=false,r=>r.audit.audit.maxRead=2*1024**2,r=>worker(r).audit.violations.push('read'),r=>r.fixture.sha256='0'.repeat(64),r=>r.fixture.allocatedBytes=undefined].entries()){const r=structuredClone(report);change(r);assert.throws(()=>assertReport(r,'browser',run,report.environment.sourceTree),`negative ${i}`);}
});
test('v2 browser gate authenticates 24 worker lifetimes and eight independently audited candidate parses',async()=>{
    const report=JSON.parse(await readFile(new URL('../docs/results/browser-lifecycle-2026-10-27.json',import.meta.url))),run={head_sha:report.environment.sourceCommit};
    report.policy=MODEL_EDIT_LIFECYCLE_POLICY;
    const models=report.audit.workers.filter(w=>w.url.includes('/model-worker.js'));
    for(let i=0;i<8;i++){
        const source=models[i*2],additional=1024;
        source.verificationPasses=1;source.verificationReadBytes=additional;source.verificationFileBytes=1349966000;source.audit.bytes+=additional;
        report.audit.workers.push(structuredClone(models[i*2+1]));
        report.cycles[i].workerHeaps.push(structuredClone(report.cycles[i].workerHeaps[0]));
        report.cycles[i].modelEdit={sourceOperators:21005,outputOperators:21006,readbackOperators:21006,bytes:1349966000,weightVerified:true,optionsVerified:true,weightSHA256:report.fixture.weightSHA256,roundTrip:true,prefixMatches:1,branchMatches:1,byteComparison:'passed',comparedBytes:1342177280,byteRanges:7,sha256:'a'.repeat(64),exportMs:1000};
    }
    assert.doesNotThrow(()=>assertReport(report,'browser',run,report.environment.sourceTree));
    for(const mutate of [r=>r.audit.workers.pop(),r=>delete r.audit.workers.find(w=>w.verificationPasses).verificationPasses,r=>r.audit.workers.find(w=>w.verificationPasses).verificationReadBytes++,r=>r.audit.workers.find(w=>w.verificationPasses).verificationFileBytes=10,r=>r.cycles[3].modelEdit.byteComparison='not-run',r=>r.policy={...r.policy,version:1}]){const r=structuredClone(report);mutate(r);assert.throws(()=>assertReport(r,'browser',run,report.environment.sourceTree));}
});
test('contract evidence requires real tests, clean bound source and zero skips',()=>{
    const r={format:'model-lens-release-contract',version:1,status:'passed',source:{commit,tree,dirty:false},sourceUnchanged:true,tests:[...RELEASE_CONTRACT_TESTS],exitCode:0,counts:{tests:10,fail:0,skipped:0,cancelled:0}};
    assert.doesNotThrow(()=>assertReport(r,'contract',{head_sha:commit},tree));
    for(const change of [r=>r.status='not_required',r=>r.tests.pop(),r=>r.counts.skipped=1,r=>r.counts.tests=0,r=>r.exitCode=1,r=>r.source.tree='f'.repeat(40)]){const c=structuredClone(r);change(c);assert.throws(()=>assertReport(c,'contract',{head_sha:commit},tree));}
});
test('Git dependency scope follows imported processors and rejects changed executed sources',()=>{
    const data=new Map([['package.json','{"version":"1","scripts":{"test":"node --test"}}'],['package-lock.json','{"version":"1","packages":{"":{"version":"1"}}}'],[GATES.core.workflow,'workflow'],['scripts/accept-performance.mjs',"import './lib/helper.mjs';"],['scripts/lib/helper.mjs','export const value=1;'],['scripts/measure-performance.mjs','// fixture runner'],['test/performance-policy.json','{}']]);
    const reader={tree:()=>new Map([...data].map(([name,text])=>[name,{mode:'100644',sha:Buffer.from(text).toString('hex')}])),bytes:(_,name)=>Buffer.from(data.get(name))};
    const before=sourceScope('core',commit,reader);assert.ok(before.files.some(f=>f.path==='scripts/lib/helper.mjs'));
    data.set('package.json','{"version":"2","scripts":{"test":"node --test"}}');data.set('package-lock.json','{"version":"2","packages":{"":{"version":"2"}}}');assert.equal(sourceScope('core',commit,reader).fingerprint,before.fingerprint);
    data.set('scripts/lib/helper.mjs','export const value=2;');assert.notEqual(sourceScope('core',commit,reader).fingerprint,before.fingerprint);
    data.delete('scripts/lib/helper.mjs');assert.throws(()=>sourceScope('core',commit,reader),/Unresolved/);
});
test('artifact bytes must match the server digest before archive parsing',()=>{
    assert.throws(()=>readArtifact(Buffer.from('passed'),'sha256:'+'0'.repeat(64)),/digest/);
});
test('artifact parser accepts only one bounded plain JSON entry and rejects path tricks',()=>{
    const python=process.env.PYTHON_BIN||(process.platform==='win32'?'python':'python3');
    const make=(name,extra=false)=>execFileSync(python,['-I','-c',"import io,zipfile,sys\nb=io.BytesIO()\nwith zipfile.ZipFile(b,'w') as z:\n z.writestr(sys.argv[1],'{\"status\":\"passed\"}')\n if sys.argv[2]=='yes': z.writestr('extra.json','{}')\nsys.stdout.buffer.write(b.getvalue())",name,extra?'yes':'no'],{windowsHide:true});
    const read=bytes=>readArtifact(bytes,'sha256:'+createHash('sha256').update(bytes).digest('hex'));
    assert.equal(read(make('report.json')).report.status,'passed');
    for(const name of ['../report.json','folder\\report.json','report.js'])assert.throws(()=>read(make(name)));
    assert.throws(()=>read(make('report.json',true)));
});
