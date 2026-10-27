import {test} from 'node:test';
import assert from 'node:assert/strict';
import {diagnosticJournal,createDiagnosticReport,diagnosticRuntime,diagnosticCount,diagnosticSize,DIAGNOSTIC_EVENT_LIMIT,DIAGNOSTIC_BYTE_LIMIT} from '../src/diagnostics.js';
const build='a'.repeat(16),release={version:'0.2.0-preview.5',buildId:build,distribution:'internal',source:{commit:'b'.repeat(40),dirty:false},extension:{name:'SECRET_DIALECT',version:'SECRET_VERSION',sourceHash:'SECRET_HASH'}};
const createdAt='2026-10-27T01:00:00.000Z';
test('journal stores bounded classified events and quantized durations, with no arbitrary action/error names',()=>{
    let clock=0;const journal=diagnosticJournal({now:()=>clock});
    const finish=journal.begin('open');clock=127;finish('success');finish('error',new Error('not retained'));
    assert.deepEqual(journal.snapshot().events,[{id:1,operation:'open',outcome:'started',atMs:0},{id:1,operation:'open',outcome:'success',atMs:130,durationMs:130}]);
    journal.record('SECRET_OP','error',{name:'SECRET_ERROR',message:'SECRET_TEXT',stack:'SECRET_STACK'});
    assert.equal(journal.snapshot().events.at(-1).operation,'other');assert.equal(journal.snapshot().events.at(-1).errorKind,'UnknownError');
    for(let i=0;i<100;i++)journal.record('search','success');
    const snapshot=journal.snapshot();assert.equal(snapshot.events.length,DIAGNOSTIC_EVENT_LIMIT);assert.equal(snapshot.discarded,140);
    snapshot.events[0].operation='mutated';assert.equal(journal.snapshot().events[0].operation,'search');
});
test('clearing transient history prevents unfinished old operations from reappearing',()=>{
    let clock=100;const journal=diagnosticJournal({now:()=>clock}),old=journal.begin('open');
    journal.clear();clock=120;old('error',new Error('old'));
    assert.deepEqual(journal.snapshot(),{events:[],discarded:0});journal.record('search','success');assert.equal(journal.snapshot().events[0].id,1);
});
test('tracking preserves returned values and thrown errors without retaining payloads or raw exceptions',async()=>{
    const journal=diagnosticJournal(),value={weights:'SECRET_WEIGHT'},error=new DOMException('SECRET_MESSAGE','AbortError');
    assert.equal(await journal.track('search',async()=>value),value);
    await assert.rejects(journal.track('exportMLIR',async()=>{throw error;}),e=>e===error);
    assert.equal(journal.snapshot().events.at(-1).outcome,'cancelled');
    const text=JSON.stringify(journal.snapshot());assert.ok(!text.includes('SECRET'));
    const failure=new DOMException('SECRET_QUOTA','QuotaExceededError');await assert.rejects(journal.track('pattern-save',async()=>{throw failure;}),e=>e===failure);
    assert.equal(journal.snapshot().events.at(-1).errorKind,'QuotaExceededError');
});
test('report whitelist excludes names, content, internal extensions, storage identities, full UA and unknown keys',()=>{
    const journal=diagnosticJournal();journal.record('ui','error',new Error('SECRET_PATH C:\\company\\model.mlir'));
    const context={modelLoaded:true,format:'mlir',fileBytes:2.5*2**30,layers:21005,scopes:6,selected:5,renderer:'canvas',view:'overview',fontPx:32,pendingRequests:0,modelWorkerPresent:true,bytesRead:7.55*2**20,parseMs:592,autosave:{enabled:true,conflict:true,message:'SECRET_STORAGE',owner:'SECRET_OWNER'},fileName:'SECRET_MODEL',query:'SECRET_QUERY',pattern:'SECRET_PATTERN'};
    Object.defineProperty(context,'weights',{get(){throw Error('Must not read model content');}});
    const {report,text}=createDiagnosticReport({journal,context,release,loadedBuild:build,userAgent:'Mozilla Windows SECRET_AGENT Chrome/140.0 Edg/141.2',createdAt});
    assert.equal(report.application.releaseStatus,'matched');assert.equal(report.context.fileSize,'2-4GiB');assert.equal(report.context.layers,'>20000');assert.equal(report.context.parseMs,590);
    assert.deepEqual(report.runtime,{browser:'Edge',major:141,os:'Windows'});
    assert.equal(report.context.autosave.conflict,true);assert.equal(report.context.autosave.saving,null);
    assert.ok(!text.includes('SECRET'));assert.ok(!text.includes('company'));assert.ok(text.length<DIAGNOSTIC_BYTE_LIMIT);
    assert.equal(JSON.parse(text).privacy.rawMessages,false);
});
test('unknown release data, custom version suffixes and missing metrics are explicit rather than invented',()=>{
    const journal=diagnosticJournal();
    const missing=createDiagnosticReport({journal,createdAt}).report;
    assert.equal(missing.application.releaseStatus,'unavailable');assert.equal(missing.context.parseMs,null);assert.equal(missing.context.fileSize,'unknown');
    const mismatch=createDiagnosticReport({journal,release:{...release,version:'1.2.3-company',extension:{name:'PRIVATE'}},loadedBuild:'c'.repeat(16),createdAt}).report;
    assert.equal(mismatch.application.version,null);assert.equal(mismatch.application.releaseStatus,'mismatch');
    assert.equal(diagnosticCount(NaN),'unknown');assert.equal(diagnosticSize(-1),'unknown');
    assert.equal(diagnosticSize(1_349_965_216),'1-2GiB');assert.equal(diagnosticCount(1500),'501-1500');
    assert.equal(createDiagnosticReport({journal,context:{parseMs:NaN},createdAt}).report.context.parseMs,null);
});
test('hostile error getters and enormous operation history cannot leak or exceed the report limit',()=>{
    const journal=diagnosticJournal();
    const hostile={get name(){throw new Error('SECRET_GETTER');},get stack(){throw new Error('Must not inspect');}};
    journal.record('ui','error',hostile);
    let reads=0;const changing={get name(){return reads++?'SECRET_CHANGED':'Error';}};journal.record('ui','error',changing);assert.equal(reads,1);
    for(let i=0;i<10000;i++)journal.record('SECRET_'+'x'.repeat(1000),'error',new Error('SECRET_'+i));
    const {report,text}=createDiagnosticReport({journal,createdAt});
    assert.equal(report.operations.events.length,64);assert.ok(new TextEncoder().encode(text).length<DIAGNOSTIC_BYTE_LIMIT);assert.ok(!text.includes('SECRET'));
});
test('malformed snapshots are re-whitelisted at the report boundary',()=>{
    const journal={snapshot:()=>({discarded:Infinity,events:[{id:1,operation:'PRIVATE_OP',outcome:'PRIVATE_RESULT',atMs:NaN,durationMs:Infinity,errorKind:'PRIVATE_ERROR',message:'PRIVATE_MESSAGE',stack:'PRIVATE_STACK'}]})};
    const {report,text}=createDiagnosticReport({journal,createdAt});
    assert.equal(report.operations.events[0].operation,'other');assert.equal(report.operations.events[0].outcome,'error');assert.equal(report.operations.events[0].errorKind,'UnknownError');assert.ok(!text.includes('PRIVATE'));
});
