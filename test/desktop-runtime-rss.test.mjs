import {test} from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {DESKTOP_RUNTIME_RSS_POLICY as p,DESKTOP_RUNTIME_MEASUREMENTS,evaluateDesktopRuntimeRSS as evaluate} from './browser/desktop-runtime-rss-policy.mjs';
import {RUNTIME_LIFECYCLE_POLICY as original} from './browser/runtime-lifecycle-policy.mjs';
import {installDesktopRuntimeURLAudit} from './browser/desktop-runtime-url-audit.mjs';

function accepted(){
    const hash='a'.repeat(64),base='http://127.0.0.1:1234/tflite-explorer/',samples=Array.from({length:401},(_,i)=>({elapsedMs:i*500,rssBytes:200e6,processes:4,phase:'runtime'}));
    const settled=(phase,start,rss=200e6)=>{const indices=Array.from({length:5},(_,j)=>start+j*2);for(const i of indices)Object.assign(samples[i],{phase,rssBytes:rss});return {indices,rssBytes:rss};};
    const identity={pid:1234,startTicks:'1000'},files=Array.from({length:33},(_,i)=>({id:`file-${i+1}`,path:`/tmp/synthetic-run/file-${i+1}.bin`,status:'removed',bytes:4194304}));
    return {format:'model-lens-desktop-runtime-rss',version:1,engine:'firefox',base,source:{commit:'a'.repeat(40),tree:'b'.repeat(40),dirty:false},sourceUnchanged:true,policy:p,measurements:DESKTOP_RUNTIME_MEASUREMENTS,forcedGC:false,shortenedURLTimer:false,fixture:{modelBytes:4195488,inputBytes:4194304,outputBytes:4194304,modelSHA256:hash},
        cycles:Array.from({length:8},(_,i)=>({cycle:i+1,runs:[0,1,2].map(j=>({status:'passed',input:i*3+j,workerClosed:true})),io:{input:i*3+2,modelSHA256:hash,sha256:hash,inputSHA256:hash,outputSHA256:hash,inputBytes:4194304,outputBytes:4194304,zipBytes:8389608,urlId:i+1,bytesVerified:true,crcVerified:true},liveRuntimeWorkers:0,liveModelWorkers:0,fileInputEmpty:true,closedRssBytes:200e6+i*1000,settled:settled(`cycle-${i+1}-settle`,20+i*20,200e6+i*1000)})),samples,elapsedMs:200000,warmBaseline:settled('warmup-settle',50),final:settled('final-settle',380),
        modelWorkers:Array.from({length:8},()=>({closed:true,url:base+'src/model-worker.js?v=0123456789abcdef'})),runtimeWorkers:Array.from({length:24},()=>({closed:true,url:base+'src/tflite-runtime-worker.js?v=0123456789abcdef'})),urlWindows:[{before:2,after:0,elapsedMs:50000},{before:6,after:0,elapsedMs:50000}],urls:Array.from({length:8},(_,i)=>({id:i+1,bytes:8389608,createdAt:0,revokedAt:60000})),urlAuditOverflow:false,
        inputCleanupRequired:true,inputCleanup:Array.from({length:24},(_,i)=>({kind:`cycle-${Math.floor(i/3)+1}-run-${i%3+1}`,open:false,controls:0,fileInputs:0,callbackCleared:true,error:''})),ownership:{root:identity,method:'direct Node child plus exact per-launch random environment marker'},ownedProcesses:[identity],browserClosed:true,processCleanup:{identities:[identity],remaining:[],allReaped:true},requests:[{url:base+'src/app.js',method:'GET',allowed:true}],errors:[],temporary:{directory:'/tmp/synthetic-run',files,events:files.flatMap(f=>['create_intent','created','delete_intent','removed'].map(event=>({artifact_id:f.id,event})))}};
}
test('desktop RSS supplements Chromium: shared numeric limits stay exact and unknown heaps remain null',()=>{
    for(const key of Object.keys(p).filter(k=>k!=='version'))assert.equal(p[key],original[key],key);assert.equal(original.closedMainHeapDriftBytes,32*1024**2);assert.equal('closedMainHeapDriftBytes'in p,false);
    for(const engine of ['firefox','webkit']){const r=accepted();r.engine=engine;assert.equal(evaluate(r).status,'passed');assert.equal(evaluate(r).summary.measuredCycles,6);assert.equal(r.measurements.mainHeap,null);assert.equal(r.measurements.workerIsolateHeap,null);}
});
test('every cycle is bound to actual sampled medians, full IO, native close and cleared input callbacks',()=>{
    const cases=[
        [r=>r.cycles[2].settled.indices[0]=1,'cycle-3'],[r=>r.cycles[2].closedRssBytes++,'cycle-3'],[r=>r.cycles[3].runs[1].input=0,'cycle-4'],[r=>r.cycles[4].io.input=0,'io-5'],[r=>r.cycles[5].io.crcVerified=false,'io-6'],[r=>r.cycles[5].io.bytesVerified=false,'io-6'],[r=>r.urls[6].bytes++,'io-7'],[r=>r.cycles[7].liveRuntimeWorkers=1,'cycle-8'],[r=>r.runtimeWorkers[5].closed=false,'worker-close'],[r=>r.modelWorkers.pop(),'worker-close'],[r=>r.inputCleanup[6].callbackCleared=false,'input-cleanup'],[r=>r.inputCleanup[7].fileInputs=1,'input-cleanup'],[r=>r.inputCleanup[8].kind='stale','input-cleanup']
    ];
    for(const [change,issue]of cases){const r=accepted();change(r);assert.ok(evaluate(r).issues.includes(issue),issue);}
});
test('RSS drift, slope, peak, sparse samples and forged heap substitutes fail under original thresholds',()=>{
    const cases=[
        [r=>{r.final.rssBytes+=129*1024**2;for(const i of r.final.indices)r.samples[i].rssBytes=r.final.rssBytes;},'settled-rss-drift'],
        [r=>r.cycles.forEach((c,i)=>{c.closedRssBytes+=i*17*1024**2;c.settled.rssBytes=c.closedRssBytes;for(const slot of c.settled.indices)r.samples[slot].rssBytes=c.closedRssBytes;}),'closed-rss-slope'],
        [r=>r.samples[250].rssBytes+=769*1024**2,'peak-growth'],[r=>r.samples[250].elapsedMs+=4000,'samples'],[r=>r.elapsedMs=p.deadlineMs+1,'sample-coverage'],[r=>r.warmBaseline.rssBytes++,'settled-metrics'],[r=>r.measurements={...r.measurements,mainHeap:'rss'},'memory-boundary'],[r=>r.policy={...r.policy,closedRssDriftBytes:p.closedRssDriftBytes+1},'policy']
    ];
    for(const [change,issue]of cases){const r=accepted();change(r);assert.ok(evaluate(r).issues.includes(issue),issue);}
});
test('natural URLs, owned process exit, scope and request boundaries cannot be omitted or relabelled',()=>{
    for(const [change,issue]of [[r=>r.urls[0].revokedAt=1000,'native-url-lifetime'],[r=>r.urlWindows[0].after=1,'url-release'],[r=>r.urlAuditOverflow=true,'url-release'],[r=>r.forcedGC=true,'natural-lifecycle'],[r=>r.shortenedURLTimer=true,'natural-lifecycle'],[r=>r.ownedProcesses.push({pid:9999,startTicks:'2000'}),'process-cleanup'],[r=>r.processCleanup.remaining=[{pid:1234,startTicks:'1000'}],'process-cleanup'],[r=>r.processCleanup.allReaped=false,'process-cleanup'],[r=>r.sourceUnchanged=false,'source'],[r=>r.requests[0].method='POST','network'],[r=>r.requests[0].url='https://foreign.invalid/','network'],[r=>r.temporary.files[0].path='/foreign/file.bin','generated-file-cleanup'],[r=>r.temporary.files[0].status='created','generated-file-cleanup'],[r=>r.temporary.events.pop(),'generated-file-cleanup']]){const r=accepted();change(r);assert.ok(evaluate(r).issues.includes(issue),issue);}
    for(const r of [null,{}, {cycles:[null],urls:[null],samples:[null]}])assert.equal(evaluate(r).status,'failed');
});
function urlFixture(){
    const attrs=new Map(),calls=[],context={Date:{now:()=>1000},document:{documentElement:{setAttribute:(k,v)=>attrs.set(k,v)},addEventListener(){}},URL:{createObjectURL(blob){calls.push({kind:'create',value:blob});if(blob.fail)throw Error('native-create');return 'blob:synthetic-'+calls.length;},revokeObjectURL(value){calls.push({kind:'revoke',value});if(value==='native-fail')throw Error('native-revoke');return 'native-return';}}};
    vm.runInNewContext('('+installDesktopRuntimeURLAudit.toString()+')()',context);return {context,calls,read:()=>JSON.parse(attrs.get('data-lens-runtime-urls'))};
}
test('DOM-only URL audit delegates native values/exceptions, drops payloads and bounds metadata',()=>{
    const f=urlFixture(),blob={size:8389608,privatePayload:'never-retain'},url=f.context.URL.createObjectURL(blob);assert.equal(f.calls[0].value,blob);assert.equal(f.read().rows[0].bytes,blob.size);assert.equal(f.context.URL.revokeObjectURL(url),'native-return');assert.equal(f.read().rows[0].revokedAt,1000);assert.doesNotMatch(JSON.stringify(f.read()),/privatePayload|never-retain|blob:/);assert.throws(()=>f.context.URL.createObjectURL({fail:true}),/native-create/);assert.throws(()=>f.context.URL.revokeObjectURL('native-fail'),/native-revoke/);assert.equal(f.read().rows.length,1);
    for(let i=0;i<520;i++)f.context.URL.createObjectURL({size:1});assert.equal(f.read().overflow,true);assert.equal(f.read().rows.length,512);
});
