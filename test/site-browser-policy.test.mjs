import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {evaluateSiteBrowser} from '../scripts/lib/site-browser-policy.mjs';
import {assertReport,GATES} from '../scripts/lib/release-gates.mjs';
const report=JSON.parse(await readFile(new URL('../docs/results/site-browser-2026-10-27.json',import.meta.url)));

test('actual hosted upgrade/rollback evidence includes complete scenarios, namespaces and closed workers',()=>{
    const result=evaluateSiteBrowser(report);assert.equal(result.status,'passed',result.issues.join('; '));assert.deepEqual(result.summary,{modelWorkers:7,requests:508,scenarios:6,snapshots:3});
});

test('a passed marker cannot replace lazy loads, persisted-pattern flow, retained snapshots or clean shutdown',()=>{
    for(const [i,change] of [r=>r.status='failed',r=>r.baseline.sha256='0'.repeat(64),r=>r.source.dirty=true,r=>r.sourceUnchanged=false,r=>r.candidate.source.tree='0'.repeat(40),r=>r.candidate.extension={},r=>r.browserClosed=false,r=>r.errors.push('error'),r=>r.checks.pop(),r=>r.checks[0]=r.checks[1],r=>r.workers.pop(),r=>r.workers[0].closed=false,r=>r.workers.find(w=>w.page==='candidate').url='./src/model-worker.js?v='+r.candidate.buildId,r=>r.requests=r.requests.filter(q=>!(q.page==='candidate'&&q.phase==='rollback'&&q.url.includes('/tflite.js'))),r=>r.requests=r.requests.filter(q=>!(q.page==='legacy'&&q.phase==='upgrade'&&q.url.includes('/mlir.js'))),r=>r.requests.push({page:'candidate',phase:'rollback',url:'https://invalid.example/upload',method:'POST'}),r=>r.snapshots.pop(),r=>r.snapshots[1].versions.pop(),r=>r.snapshots[2].files--,r=>r.workers=[null],r=>r.requests=[null],r=>r.snapshots=[null]].entries()){
        const copy=structuredClone(report);change(copy);assert.equal(evaluateSiteBrowser(copy).status,'failed','negative '+i);
    }
});

test('the public release requires the site browser gate and binds its report to exact tested source',()=>{
    assert.deepEqual(Object.keys(GATES),['core','browser','contract','site']);
    assert.doesNotThrow(()=>assertReport(report,'site',{head_sha:report.source.commit},report.source.tree));
    assert.throws(()=>assertReport(report,'site',{head_sha:'0'.repeat(40)},report.source.tree));
    assert.throws(()=>assertReport(report,'site',{head_sha:report.source.commit},'0'.repeat(40)));
    assert.throws(()=>assertReport({...report,checks:[]},'site',{head_sha:report.source.commit},report.source.tree));
});
