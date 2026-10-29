import {test} from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {installIdentityWorkerAudit,identityWorkerDiagnostics} from './browser/identity-worker-diagnostics.mjs';
test('identity audit preserves native Worker arguments/termination and excludes payloads from metadata',()=>{
    const previous={Worker:globalThis.Worker,document:globalThis.document,location:globalThis.location,debug:console.debug},events=[],attributes=new Map();
    class NativeWorker extends EventTarget{constructor(url,options){super();this.url=url;this.options=options;this.terminations=0;}terminate(value){this.terminations++;this.terminationArgument=value;return 'native-result';}}
    globalThis.Worker=NativeWorker;globalThis.document={baseURI:'https://test.invalid/',documentElement:{setAttribute:(k,v)=>attributes.set(k,v)},addEventListener(){}};globalThis.location={href:'https://test.invalid/'};console.debug=value=>events.push(value);
    try{
        installIdentityWorkerAudit();const options={type:'module'},plain=new Worker('https://test.invalid/model-worker.js',options);assert.equal(plain.options,options);assert.equal(Object.hasOwn(plain,'terminate'),false);
        const worker=new Worker('https://test.invalid/src/edit-recovery-worker.js?v=1234567890abcdef',options);assert.ok(worker instanceof NativeWorker);assert.equal(worker.options,options);const handler=()=>{};worker.onmessage=handler;worker.dispatchEvent(new MessageEvent('message',{data:{fingerprint:'secret-fingerprint',file:new Blob(['secret-model-data']),extra:'private'}}));assert.equal(worker.onmessage,handler);assert.equal(worker.terminate('unchanged'),'native-result');assert.equal(worker.terminations,1);assert.equal(worker.terminationArgument,'unchanged');const before=events.length;worker.dispatchEvent(new MessageEvent('message',{data:{error:'secret-error'}}));assert.equal(events.length,before,'diagnostic listeners must detach before native termination');
        const serialized=attributes.get('data-lens-identity-workers'),audit=JSON.parse(serialized);assert.equal(audit.rows.length,1);assert.equal(audit.rows[0].fingerprintReply,true);assert.equal(audit.rows[0].terminateCalls,1);assert.ok(audit.rows[0].terminateReturnedAt>=audit.rows[0].terminateStartedAt);assert.equal(audit.rows[0].terminateThrew,false);assert.doesNotMatch(serialized+events.join(''),/secret-|private/);
    }finally{console.debug=previous.debug;for(const k of ['Worker','document','location'])if(previous[k]===undefined)delete globalThis[k];else globalThis[k]=previous[k];}
});

test('native context probes preserve unknown close state and never terminate a Worker to pass',async()=>{
    const page=new EventEmitter(),browser={isConnected:()=>true},frame={};page.workers=()=>[];page.isClosed=()=>false;page.context=()=>({browser:()=>browser});page.mainFrame=()=>frame;
    const diagnostics=identityWorkerDiagnostics({page,read:async()=>JSON.stringify({version:1,rows:[]}),getPhase:()=> 'test'}),rows=[];
    for(const status of ['alive','gone']){const worker=new EventEmitter();worker.url=()=> 'https://test.invalid/src/edit-recovery-worker.js?v=1234567890abcdef';worker.terminate=()=>assert.fail('diagnosis must not terminate');worker.evaluate=async fn=>{assert.equal(fn(),1);if(status==='gone')throw Error('native execution context gone');return 1;};const row={url:worker.url(),closed:false};diagnostics.track(worker,row,rows.length);row.creationEventAt-=6000;rows.push(row);}
    const snapshot=await diagnostics.snapshot('native-check',{probe:true});assert.equal(snapshot.pending.length,2);assert.ok(snapshot.pending.every(r=>r.presentInNativeWorkerList===false));assert.deepEqual(diagnostics.report.probes.map(p=>p.status),['returned','rejected']);assert.equal(diagnostics.report.probes[0].value,1);assert.match(diagnostics.report.probes[1].error,/context gone/);assert.ok(rows.every(r=>r.closed===false),'probe results must never fabricate close events');diagnostics.dispose();
});
