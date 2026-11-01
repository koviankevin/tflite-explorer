import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdir,mkdtemp,readFile,rm} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';
import {RENDERER_RELEASE_PLAN as policy,createRendererProjection,summarizeRendererRelease,assertPublicRendererReport,assertRendererProbeWorkflow} from './browser/renderer-release-policy.mjs';
import {parse as yaml} from 'yaml';
import {createProcessMemoryProbe} from './browser/process-memory-profile.mjs';
import {physicalFixtureHeader} from './physical-tflite-fixture.mjs';
import {assertReport} from '../scripts/lib/release-gates.mjs';
const MiB=1024**2,metrics=[{name:'JSHeapUsedSize',value:6*MiB},{name:'JSHeapTotalSize',value:8*MiB}],types=new Map([[12,'renderer'],[13,'browser']]);
const owner=(pid,anonymousBytes,startTicks=String(pid))=>({pid,startTicks,observation:'present',rssBytes:anonymousBytes+21*MiB,anonymousBytes,fileBytes:20*MiB,sharedBytes:MiB});
function input(index,elapsedMs,phase='closed',anon=200*MiB,other=50*MiB){
    const processes=[owner(12,anon),owner(13,other)],totals=Object.fromEntries(['rssBytes','anonymousBytes','fileBytes','sharedBytes'].map(k=>[k,processes.reduce((n,p)=>n+p[k],0)]));
    const anchor={index,elapsedMs,phase,rssBytes:totals.rssBytes,processes:2},native={elapsedMs,phase,gateRssBytes:anchor.rssBytes,observedStartMs:elapsedMs+1,observedEndMs:elapsedMs+2,processes,totals,differenceFromGateRSSBytes:0};return {anchor,native};
}
const project=(p,i,...args)=>{const {anchor,native}=input(i,...args);return p.project(anchor,native,metrics,types);};
function measured({renderer=true,gap=false}={}){
    const p=createRendererProjection();return [project(p,0,0,'loaded'),project(p,1,2000,'closing'),project(p,2,2500),project(p,3,3000),project(p,4,gap?5000:3500,'closed',renderer?50*MiB:200*MiB,renderer?50*MiB:0)];
}
function report(cases=[]){return {format:'model-lens-renderer-release-probe',version:1,purpose:'readonly-native-memory-attribution',releaseEvidenceEligible:false,forcedGC:false,status:'complete',operation:'open-close',policy,cases,failures:[]};}

test('the observed delayed renderer-anonymous drop has an explicit red-capable signal and exact deltas',()=>{
    const summary=summarizeRendererRelease(measured(),2000);assert.equal(summary.delayedReleaseStepObserved,true);assert.equal(summary.changes.length,1);assert.equal(summary.changes[0].anonymousDeltaBytes,-150*MiB);assert.equal(summary.changes[0].gateRssDeltaBytes,-150*MiB);assert.equal(summary.changes[0].mainHeapTotalDeltaBytes,0);assert.equal(summary.changes[0].afterCloseMs,1500);
});

test('other-process drops and large observation gaps cannot masquerade as a renderer step',()=>{
    assert.equal(summarizeRendererRelease(measured({renderer:false}),2000).delayedReleaseStepObserved,false);
    assert.equal(summarizeRendererRelease(measured({gap:true}),2000).delayedReleaseStepObserved,false);
});

test('missing or reused renderer observations fail explicitly instead of becoming zero or a false absence',()=>{
    for(const observation of ['exited','reused']){
        const rows=measured();rows[3].owners[0]={...rows[3].owners[0],kind:'unknown',observation,rssBytes:null,anonymousBytes:null,fileBytes:null,sharedBytes:null};assert.throws(()=>summarizeRendererRelease(rows,2000),/missing-renderer-memory/);
    }
    const rows=measured();rows[3].owners[0].label=9;assert.throws(()=>summarizeRendererRelease(rows,2000),/ambiguous-renderer/);
});

test('projection keeps stable labels per creation identity and drops all private identity/name/annotation fields',()=>{
    const p=createRendererProjection(),a=input(0,0);a.anchor.secret='Bearer secret';a.native.processes[0].name='PRIVATE_NAME';a.native.processes[0].parent=999;a.native.processes[0].commandLine='PRIVATE_COMMAND';a.native.privatePath='C:/private/model';
    const row=p.project(a.anchor,a.native,metrics,types),text=JSON.stringify(row);for(const word of ['pid','startTicks','parent','PRIVATE','Bearer','privatePath'])assert.ok(!text.includes(word),word);assert.equal(row.owners[0].label,0);
    const b=input(1,500);b.native.processes[0].startTicks='123456';const next=p.project(b.anchor,b.native,metrics,types);assert.notEqual(next.owners[0].label,row.owners[0].label);assert.equal(p.labelCount,3);
});

test('the actual guarded process probe composes with safe observations and retains temporal RSS differences',async()=>{
    let clock=10;const probe=createProcessMemoryProbe({now:()=>clock++,readText:async file=>file.endsWith('/stat')?'12 (chrome) S 10 '+Array(17).fill('0').join(' ')+' 12 0':'Name:\tprivate-name\nVmRSS:\t105 kB\nRssAnon:\t80 kB\nRssFile:\t20 kB\nRssShmem:\t5 kB\n'});
    const anchor={index:0,phase:'baseline',elapsedMs:10,rssBytes:102400,processes:1},native=await probe.capture([{pid:12,startTicks:'12'}],anchor),row=createRendererProjection().project(anchor,native,metrics,types);
    assert.equal(row.totals.rssBytes,107520);assert.equal(row.differenceFromGateRSSBytes,5120);assert.equal(row.owners[0].anonymousBytes,81920);assert.equal(row.owners[0].kind,'renderer');assert.ok(!JSON.stringify(row).includes('private-name'));
});

test('invalid anchors, unmatched totals, indices and owner budgets are rejected before publication',()=>{
    const mutations=[v=>v.anchor.index=policy.maxSamplesPerCase,v=>v.native.elapsedMs++,v=>v.native.observedStartMs=-1,v=>v.native.totals.rssBytes++,v=>v.native.differenceFromGateRSSBytes++,v=>v.anchor.processes=1,v=>v.native.processes[0].startTicks='bad',v=>v.native.processes[0].anonymousBytes=NaN];
    for(const mutate of mutations){const value=input(0,10);mutate(value);assert.throws(()=>createRendererProjection().project(value.anchor,value.native,metrics,types));}
    const value=input(0,10);value.anchor.processes=33;value.native.processes=Array.from({length:33},(_,i)=>owner(i+12,10));assert.throws(()=>createRendererProjection().project(value.anchor,value.native,metrics,types),/owner-budget/);
});

test('public report schema rejects paths, PID/creation data, raw logs and arbitrary diagnostic strings',()=>{
    assertPublicRendererReport(report());
    for(const [key,value]of [['pid',12],['startTicks','123'],['environment',{private:'secret'}],['stdout','private log'],['path','C:/private']]){const r=report();r[key]=value;assert.throws(()=>assertPublicRendererReport(r),/private-report-field/);}
    const r=report();r.status='PRIVATE_MODEL';assert.throws(()=>assertPublicRendererReport(r),/private-report-string/);
    for(const flag of ['releaseEvidenceEligible','forcedGC']){const r=report();r[flag]=true;assert.throws(()=>assertPublicRendererReport(r),/diagnostic-marker/);}
});

test('a valid probe result stays ineligible for all release gates even with a forged passed label',()=>{
    for(const kind of ['core','browser','contract','site'])assert.throws(()=>assertReport({...report(),status:'passed'},kind,{},''),/diagnostic reports are not release evidence/);
});

test('maximum numeric observations stay inside the explicit public report budget',()=>{
    const base=measured()[2],owners=Array.from({length:32},(_,i)=>({label:i,kind:i?'unknown':'renderer',observation:'present',rssBytes:2**40,anonymousBytes:2**39,fileBytes:2**38,sharedBytes:2**38}));
    const rows=Array.from({length:512},(_,i)=>({...base,index:i,elapsedMs:i*500,owners})),r=report([{id:'small',samples:rows},{id:'large',samples:rows}]);assertPublicRendererReport(r);assert.ok(Buffer.byteLength(JSON.stringify(r))<policy.maxReportBytes);
});

test('minimized fixtures keep the structural scales while both actual payloads remain one MiB',async()=>{
    for(const c of policy.cases){const f=await physicalFixtureHeader({repeats:c.repeats,weightBytes:c.weightBytes});assert.equal(f.operators,c.operators);assert.equal(f.weightBytes,MiB);assert.ok(f.payloadOffset+f.weightBytes<16*MiB);}
    assert.deepEqual(policy.cases.map(c=>c.operators),[3005,21005]);assert.equal(policy.sampleIntervalMs,500);assert.equal(policy.observeAfterCloseMs,45000);
});

test('actual opt-in entry rejects a non-hosted environment before fixture, build or browser creation',async()=>{
    const build=fileURLToPath(new URL('../build/',import.meta.url));await mkdir(build,{recursive:true});const directory=await mkdtemp(path.join(build,'renderer-probe-entry-'));
    try{
        const output=path.join(directory,'report.json'),result=spawnSync(process.execPath,[fileURLToPath(new URL('./browser/renderer-release-probe.mjs',import.meta.url))],{env:{...process.env,GITHUB_ACTIONS:'false',RENDERER_PROBE_REPORT:output},timeout:20000,encoding:'utf8',windowsHide:true});
        assert.equal(result.error,undefined);assert.equal(result.status,1,result.stderr);const r=JSON.parse(await readFile(output,'utf8'));assert.equal(r.status,'failed');assert.equal(r.failures[0].stage,'host');assert.deepEqual(r.cases,[]);assert.equal(r.source,undefined);assertPublicRendererReport(r);assert.ok(!JSON.stringify(r).includes(directory));
    }finally{assert.equal(path.dirname(directory),build.replace(/[\\/]$/,''));await rm(directory,{recursive:true,force:true});}
});

test('the actual workflow uploads one safe numeric summary and cannot include private reports or fixtures',async()=>{
    const w=yaml(await readFile(new URL('../.github/workflows/renderer-release-probe.yml',import.meta.url),'utf8'));assertRendererProbeWorkflow(w);
    const mutations=[v=>v.on.push={},v=>v.permissions.contents='write',v=>v.jobs.minimize.if='true',v=>v.jobs.minimize.environment='production',v=>v.jobs.minimize.env.REPORT_NAME='private.json',v=>v.jobs.minimize.steps.at(-1).with.path='${{ runner.temp }}/**',v=>v.jobs.minimize.steps.at(-1).with.path+='*',v=>v.jobs.minimize.steps[5].run+=' --force-gc',v=>v.jobs.minimize.steps[5].env={PRIVATE:'value'}];
    for(const change of mutations){const copy=structuredClone(w);change(copy);assert.throws(()=>assertRendererProbeWorkflow(copy));}
});
