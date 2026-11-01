import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,writeFile,rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {POOL_LOG_LIMIT,POOL_TRACE_FLAG,poolTraceSettings,decodeRendererPoolLog,correlateRendererPoolSteps} from './browser/renderer-pool-log.mjs';
import {assertPublicRendererReport,RENDERER_RELEASE_PLAN} from './browser/renderer-release-policy.mjs';
const start=Date.parse('2026-11-01T00:00:00.000Z'),MiB=1024**2;
const scope={rootPid:100,rendererPid:103,rendererLabel:5,startedAtMs:start,throughAtMs:start+45000};
const line=({root=100,pid=103,at=30000,normal=150*MiB,large=0}={})=>`${new Date(start+at).toISOString()} pw:browser [pid=${root}][out] [${pid}:0xabc:7]  1234 ms: Memory pool: Removed pages: ${normal}, removed large pages: ${large}\n`;

test('pool log decodes only fixed numeric fields and preserves the V8 byte units',()=>{
    const raw=line()+`${new Date(start+30000).toISOString()} pw:browser [pid=100][out] , removed zone reservations: 0\n`,r=decodeRendererPoolLog(raw,scope);
    assert.deepEqual(r.events,[{label:5,elapsedMs:30000,v8ElapsedUs:1234000,normalPageBytes:150*MiB,largePageBytes:0}]);assert.equal(r.scopedPoolLines,1);
    for(const text of ['pid','0xabc','2026','100','103','zone'])assert.ok(!JSON.stringify(r.events).includes(text));
    assert.throws(()=>decodeRendererPoolLog(line().replace('0xabc:7','0xabc'),scope),/pool-log-format/);
});

test('foreign browser, renderer and old/future case logs cannot be attributed to this renderer',()=>{
    const raw=line({root:101})+line({pid:104})+line({at:-1})+line({at:45001})+line({normal:1});const r=decodeRendererPoolLog(raw,scope);assert.equal(r.events.length,1);assert.equal(r.events[0].normalPageBytes,1);assert.equal(r.foreignPoolLines,4);
});

test('raw log, line, event and numeric budgets fail with fixed codes rather than private contents',()=>{
    for(const [text,code]of [['x'.repeat(POOL_LOG_LIMIT+1),'pool-log-budget'],['PRIVATE'.repeat(6000),'pool-log-line-budget'],[line().repeat(129),'pool-log-event-budget'],[line({normal:2**51}),'pool-log-number'],[line().replace('0xabc','private-address'),'pool-log-format']])assert.throws(()=>decodeRendererPoolLog(text,scope),e=>e.message===code);
    assert.throws(()=>decodeRendererPoolLog(line(),{...scope,throughAtMs:start-1}),/pool-log-scope/);
});

test('pool correlation is explicit and does not treat a small, foreign or distant release as the large step',()=>{
    const samples=[{elapsedMs:29500},{elapsedMs:30000}],summary={rendererLabel:5,changes:[{from:0,to:1}]},event={label:5,elapsedMs:29750,normalPageBytes:150*MiB,largePageBytes:0};
    const yes=correlateRendererPoolSteps(samples,summary,[event])[0];assert.equal(yes.poolReleaseCoincidesWithStep,true);assert.deepEqual(yes.poolEventIndexes,[0]);assert.equal(yes.normalPageBytes,150*MiB);
    for(const other of [{...event,label:6},{...event,elapsedMs:5000},{...event,normalPageBytes:MiB}])assert.equal(correlateRendererPoolSteps(samples,summary,[other])[0].poolReleaseCoincidesWithStep,false);
    assert.equal(correlateRendererPoolSteps(samples,summary,[])[0].normalPageBytes,0);
});

test('instrumentation requires the exact private sink and no memory-policy flag',()=>{
    const report=path.resolve('test-results/pool-probe.json'),env={DEBUG:'pw:browser',DEBUG_FILE:report+'.browser-private.log'};assert.deepEqual(poolTraceSettings(report,env),{privateLogPath:env.DEBUG_FILE,args:[POOL_TRACE_FLAG]});
    for(const change of [{DEBUG:'*'},{DEBUG_FILE:report},{DEBUG_FILE:report+'.other.log'}])assert.throws(()=>poolTraceSettings(report,{...env,...change}),/pool-log-environment/);
    const r={format:'model-lens-renderer-release-probe',version:1,purpose:'readonly-native-memory-attribution',releaseEvidenceEligible:false,forcedGC:false,poolLogging:true,v8:'15.6.75',status:'complete',operation:'open-close',policy:RENDERER_RELEASE_PLAN,cases:[{id:'large',poolLog:decodeRendererPoolLog(line(),scope)}],failures:[]};assertPublicRendererReport(r);
    r.cases[0].poolLog.rawLog='PRIVATE';assert.throws(()=>assertPublicRendererReport(r),/private-report-field/);
});

test('the actual pinned SDK sends native stdout to the private DEBUG_FILE sink without opening a browser',async()=>{
    const directory=await mkdtemp(path.join(os.tmpdir(),'pool-sdk-private-log-'));
    try{
        const sink=path.join(directory,'browser-private.log'),emitter=path.join(directory,'synthetic-process.mjs'),entry=path.join(directory,'sdk-routing.mjs');
        // This is a short-lived Node process, never Chrome or a user profile.
        await writeFile(emitter,"console.log('['+process.pid+':0xabc:7] 1234 ms: Memory pool: Removed pages: 1048576, removed large pages: 0');\n");
        const playwright=new URL('../node_modules/playwright/index.mjs',import.meta.url).href;
        await writeFile(entry,`import {chromium} from ${JSON.stringify(playwright)};try {await chromium.launch({executablePath:process.execPath,ignoreDefaultArgs:true,args:[${JSON.stringify(emitter)}],timeout:5000});process.exitCode=2;}catch{}\n`);
        const result=spawnSync(process.execPath,[entry],{env:{...process.env,DEBUG:'pw:browser',DEBUG_FILE:sink},encoding:'utf8',timeout:15000,windowsHide:true});assert.equal(result.error,undefined);assert.equal(result.status,0);assert.equal(result.stdout,'');assert.equal(result.stderr,'');
        const raw=await readFile(sink,'utf8'),row=raw.split('\n').find(s=>s.includes('Memory pool: Removed pages:'));assert.ok(row,'SDK private sink lacks the synthetic stdout line');
        const root=Number(row.match(/\[pid=(\d+)\]/)[1]),pid=Number(row.match(/\[(\d+):0xabc:7\]/)[1]),r=decodeRendererPoolLog(raw,{rootPid:root,rendererPid:pid,rendererLabel:0,startedAtMs:Date.now()-60000,throughAtMs:Date.now()+1000});assert.equal(r.events.length,1);assert.equal(r.events[0].normalPageBytes,MiB);
    }finally{assert.equal(path.dirname(directory),os.tmpdir());await rm(directory,{recursive:true,force:true});}
});
