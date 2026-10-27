import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {validatePerformancePolicy,evaluatePerformanceSample,evaluatePerformanceRun} from '../scripts/lib/performance-policy.mjs';
const policy=JSON.parse(await readFile(new URL('./performance-policy.json',import.meta.url),'utf8'));
const sample=(c,iteration=1)=>({caseId:c.id,iteration,status:'measured',fixture:structuredClone(c.fixture),metrics:Object.fromEntries(Object.entries(c.limits).map(([key,max])=>[key,max/2])),checks:structuredClone(c.expected)});
const complete=()=>policy.cases.flatMap(c=>Array.from({length:policy.samplesPerCase},(_,i)=>sample(c,i+1)));
test('the published fixed policy requires three fresh samples for each scale and matching expected structure',()=>{
    assert.equal(validatePerformancePolicy(policy),policy);assert.equal(policy.samplesPerCase,3);
    assert.equal(policy.cases.find(c=>c.id==='tflite-21001').expected.overviewNodes,7003,'7,000 capsules, Add, input and output boundaries');
    assert.equal(evaluatePerformanceRun(policy,complete()).status,'passed');
    for(const missing of [[],complete().slice(1),[...complete(),complete()[0]]])assert.equal(evaluatePerformanceRun(policy,missing).status,'failed');
});
test('missing, NaN, infinite, negative, zero and over-budget measurements fail instead of becoming zero/success',()=>{
    const c=policy.cases[0];
    for(const value of [undefined,null,NaN,Infinity,-1,0,c.limits.parseMs+1]) {
        const s=sample(c);s.metrics.parseMs=value;assert.ok(evaluatePerformanceSample(c,s).includes('limit.parseMs'));
    }
    const empty=sample(c);delete empty.metrics;assert.ok(evaluatePerformanceSample(c,empty).includes('limit.maxRSSBytes'));
    const boundary=sample(c);boundary.metrics.parseMs=c.limits.parseMs;assert.deepEqual(evaluatePerformanceSample(c,boundary),[]);
});
test('failed, truncated, smaller/different fixtures and missing functional checks cannot pass on fast timings',()=>{
    for(const c of policy.cases) {
        const s=sample(c);s.status='failed';assert.ok(evaluatePerformanceSample(c,s).includes('measurement-missing-or-failed'));
        delete s.checks;assert.ok(evaluatePerformanceSample(c,s).some(x=>x.startsWith('check.')));
    }
    const c=policy.cases[1],s=sample(c);s.fixture.repeats=1000;s.fixture.headerSHA256='0'.repeat(64);s.checks.truncated=true;
    assert.ok(evaluatePerformanceSample(c,s).includes('fixture.repeats'));assert.ok(evaluatePerformanceSample(c,s).includes('fixture.headerSHA256'));assert.ok(evaluatePerformanceSample(c,s).includes('check.truncated'));
});
test('MLIR paging must reuse its path cache, keep helper bounds and preserve repeated export bytes',()=>{
    const c=policy.cases[2],s=sample(c);assert.deepEqual(evaluatePerformanceSample(c,s),[]);
    s.metrics.newMaterializationsAfterWarmup=1;s.metrics.pathWorkMax=50001;s.checks.exportStableAfterPaging=false;
    const issues=evaluatePerformanceSample(c,s);assert.ok(issues.includes('limit.newMaterializationsAfterWarmup'));assert.ok(issues.includes('limit.pathWorkMax'));assert.ok(issues.includes('check.exportStableAfterPaging'));
});
test('unknown/duplicate iterations and invalid policies are explicit failures',()=>{
    for(const edit of [p=>p.cases.push(p.cases[0]),p=>p.samplesPerCase=0,p=>p.cases[0].limits.maxRSSBytes=null,p=>p.cases[0].fixture.repeats=0,p=>p.cases[2].fixture.hidden=20,p=>p.reference=null,p=>p.reference.nodeVersion='22',p=>delete p.cases[0].limits.cancelMs,p=>delete p.cases[2].expected.ssaValid,p=>delete p.cases[0].fixture.bytes]) {
        const changed=structuredClone(policy);edit(changed);assert.throws(()=>validatePerformancePolicy(changed));
    }
    const s=complete();s[0].caseId='unknown';assert.equal(evaluatePerformanceRun(policy,s).status,'failed');s[0].caseId=policy.cases[0].id;s[0].iteration=0;assert.equal(evaluatePerformanceRun(policy,s).status,'failed');
});
