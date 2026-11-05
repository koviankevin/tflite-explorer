import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {GATES,assertRun,assertReport,assertSiteOperations,sourceScope,gitReader,readArtifact} from '../scripts/lib/release-gates.mjs';
import {RELEASE_CONTRACT_TESTS} from '../scripts/lib/release-test-plan.mjs';
import {MODEL_EDIT_LIFECYCLE_POLICY,MODEL_COMPOSITION_LIFECYCLE_POLICY} from './browser/lifecycle-policy.mjs';
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

test('a readonly memory diagnostic cannot be promoted as lifecycle release evidence even if it passes',async()=>{
    const diagnostic=evidence();diagnostic.run.path='.github/workflows/physical-memory-diagnostic.yml';diagnostic.jobs[0].name='diagnose';diagnostic.artifact.name=`browser-memory-diagnostic-${commit}-1`;
    assert.throws(()=>assertRun(diagnostic,'browser',repository));
    const report=JSON.parse(await readFile(new URL('../docs/results/browser-lifecycle-2026-10-27.json',import.meta.url))),run={head_sha:report.environment.sourceCommit};
    assert.doesNotThrow(()=>assertReport(report,'browser',run,report.environment.sourceTree));
    for(const diagnostic of [{purpose:'readonly-native-memory-attribution'},{releaseEvidenceEligible:false}])assert.throws(()=>assertReport({...report,...diagnostic},'browser',run,report.environment.sourceTree),/diagnostic/i);
});
test('a passed label cannot replace actual browser/worker/read/release evidence',async()=>{
    const report=JSON.parse(await readFile(new URL('../docs/results/browser-lifecycle-2026-10-27.json',import.meta.url))),run={head_sha:report.environment.sourceCommit};
    assert.doesNotThrow(()=>assertReport(report,'browser',run,report.environment.sourceTree));
    const worker=r=>r.audit.workers.find(w=>w.url.includes('/model-worker.js'));
    for(const [i,change] of [r=>r.cycles.pop(),r=>r.errors.push('error'),r=>worker(r).terminated=false,r=>worker(r).audit.bytes++,r=>r.audit.urls[0].revoked=false,r=>r.environment.sourceDirty=true,r=>r.policy.cycles=1,r=>r.browserClosed=false,r=>r.audit.audit.maxRead=2*1024**2,r=>worker(r).audit.violations.push('read'),r=>r.fixture.sha256='0'.repeat(64),r=>r.fixture.allocatedBytes=undefined].entries()){const r=structuredClone(report);change(r);assert.throws(()=>assertReport(r,'browser',run,report.environment.sourceTree),`negative ${i}`);}
});
async function editingReport(){
    const report=JSON.parse(await readFile(new URL('../docs/results/browser-lifecycle-2026-10-27.json',import.meta.url)));
    report.policy=MODEL_EDIT_LIFECYCLE_POLICY;
    const models=report.audit.workers.filter(w=>w.url.includes('/model-worker.js'));
    for(let i=0;i<8;i++){
        const source=models[i*2],additional=1024;
        source.verificationPasses=1;source.verificationReadBytes=additional;source.verificationFileBytes=1349966000;source.audit.bytes+=additional;
        report.audit.workers.push(structuredClone(models[i*2+1]));
        report.cycles[i].workerHeaps.push(structuredClone(report.cycles[i].workerHeaps[0]));
        report.cycles[i].modelEdit={sourceOperators:21005,outputOperators:21006,readbackOperators:21006,bytes:1349966000,weightVerified:true,optionsVerified:true,weightSHA256:report.fixture.weightSHA256,roundTrip:true,prefixMatches:1,branchMatches:1,byteComparison:'passed',comparedBytes:1342177280,byteRanges:7,sha256:'a'.repeat(64),exportMs:1000};
    }
    return report;
}
test('v2 browser gate authenticates 24 worker lifetimes and eight independently audited candidate parses',async()=>{
    const report=await editingReport(),run={head_sha:report.environment.sourceCommit};
    assert.doesNotThrow(()=>assertReport(report,'browser',run,report.environment.sourceTree));
    for(const mutate of [r=>r.audit.workers.pop(),r=>delete r.audit.workers.find(w=>w.verificationPasses).verificationPasses,r=>r.audit.workers.find(w=>w.verificationPasses).verificationReadBytes++,r=>r.audit.workers.find(w=>w.verificationPasses).verificationFileBytes=10,r=>r.cycles[3].modelEdit.byteComparison='not-run',r=>r.policy={...r.policy,version:1}]){const r=structuredClone(report);mutate(r);assert.throws(()=>assertReport(r,'browser',run,report.environment.sourceTree));}
});

test('v3 browser gate rejects missing composition native closes, identities, candidate parses or process cleanup',async()=>{
    const report=await editingReport(),run={head_sha:report.environment.sourceCommit};report.policy=MODEL_COMPOSITION_LIFECYCLE_POLICY;report.fixture.editFingerprint='f'.repeat(64);report.sourceUnchanged=true;report.processCleanup={allReaped:true,remaining:[],identities:[{pid:123,startTicks:'456'}]};
    const original=report.audit.workers.find(w=>w.url.includes('/model-worker.js'));
    for(let i=0;i<8;i++){
        const source=structuredClone(original),reopen=structuredClone(original);delete reopen.verificationPasses;delete reopen.verificationFileBytes;reopen.audit.bytes-=reopen.verificationReadBytes;delete reopen.verificationReadBytes;report.audit.workers.push(source,reopen);
        const recovery={complete:true,bytes:report.fixture.bytes,fingerprint:report.fixture.editFingerprint,maxRead:1024**2,violations:[]};for(let n=0;n<2;n++)report.audit.workers.push({url:'http://localhost/src/edit-recovery-worker.js',terminated:true,recoveryAudit:recovery});
        const c=report.cycles[i];c.workerHeaps.push({...c.workerHeaps[0]},{...c.workerHeaps[0]});c.composition={workspaceNative:true,imports:[4,4],sourceNodes:8,cloneNodes:1,undoRedo:true,sourceOperators:21005,outputOperators:9,readbackOperators:9,bytes:1345938024,weightVerified:true,optionsVerified:true,weightSHA256:report.fixture.weightSHA256,roundTrip:true,prefixMatches:1,branchMatches:1,negativePatternMatches:0,reshapeMatches:1,byteComparison:'passed',comparedBytes:1342177280,byteRanges:8,sha256:'c'.repeat(64),exportMs:1000,inputs:[0],outputs:[21009,21011],draft:{version:2,nodes:8,fingerprint:report.fixture.editFingerprint},layout:{font:32,width:1280,scrollWidth:1280,graphHeight:246},recovery};
    }
    report.workerClosures=report.audit.workers.map(w=>({url:w.url,closed:true}));assert.doesNotThrow(()=>assertReport(report,'browser',run,report.environment.sourceTree));
    for(const mutate of [r=>r.audit.workers.pop(),r=>r.workerClosures.pop(),r=>r.workerClosures.find(w=>w.url.includes('/model-worker.js')).closed=false,r=>r.sourceUnchanged=false,r=>r.processCleanup.allReaped=false,r=>r.cycles[3].composition.optionsVerified=false,r=>r.cycles[3].composition.sha256='d'.repeat(64),r=>r.audit.workers.find(w=>w.recoveryAudit).recoveryAudit.bytes--,r=>r.audit.workers.find(w=>w.verificationPasses).verificationPasses=0,r=>r.policy={...r.policy,version:2}]){const copy=structuredClone(report);mutate(copy);assert.throws(()=>assertReport(copy,'browser',run,report.environment.sourceTree));}
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

test('site operations bind the report to the upgrade snapshot, source and required scenarios',()=>{
    const buildId='1'.repeat(16),siteId='2'.repeat(64);
    const release={version:'1.7.2',buildId,source:{commit,tree,dirty:false},distribution:'public',extension:null};
    const site={candidate:release,snapshots:[{currentBuild:'3'.repeat(16)},{currentBuild:buildId,siteId},{currentBuild:'3'.repeat(16)}]};
    const checks=[
        'native model chooser and native pattern JSON import/export',
        'actual TFLite submodel download, native reopen, original pattern and worker cleanup',
        'per-OP static validation, multi-output SPLIT export/reopen, dynamic reasons, invalid SLICE rejection and 32px/21k-OP paged report without automatic interpreter',
        'real WHILE kernel: responsive UI and native cancellation, actual30s timeout, closed Workers and finite CPU/IO recovery',
        'eight manual runtime IO lifecycle cycles, 24 CPU runs, native download/reopen/close, natural URL release and bounded observed process RSS',
        ...Array.from({length:33},(_,i)=>'scenario '+i)
    ];
    const report={format:'model-lens-production-smoke',version:1,status:'passed',target:'isolated-versioned-snapshot',
        expectedBuild:buildId,siteId,driverSourceCommit:commit,siteRelease:release,coreBasePath:'versions/'+buildId+'/',
        checks,errors:[],workers:[{url:'http://127.0.0.1:4173/tflite-explorer/versions/'+buildId+'/src/model-worker.js?v='+buildId,closed:true}],
        processCleanup:{allReaped:true,identities:[{pid:7}],remaining:[]}};
    assert.equal(assertSiteOperations(report,site,[]).checks,38);
    for(const mutate of [
        r=>r.status='failed',r=>r.target='public-production',r=>r.siteId='4'.repeat(64),
        r=>r.driverSourceCommit='5'.repeat(40),r=>r.siteRelease.source.tree='6'.repeat(40),
        r=>r.expectedBuild='7'.repeat(16),r=>r.coreBasePath='versions/other/',
        r=>r.checks.pop(),r=>r.checks[0]='missing native selection',r=>r.checks[1]=r.checks[0],
        r=>r.errors.push('page error'),r=>r.workers[0].closed=false,r=>r.workers[0].url=r.workers[0].url.replace(buildId,'8'.repeat(16)),
        r=>r.processCleanup.remaining.push({pid:7}),r=>r.processCleanup.allReaped=false
    ]){
        const broken=structuredClone(report);mutate(broken);
        assert.throws(()=>assertSiteOperations(broken,site,[]),/Site operation evidence/);
    }
    const broadcast=[{path:'src/tflite-broadcast-checks.js'}];
    const oldChecker=()=>Buffer.from('export function checkBroadcastMetadata() {}');
    const newChecker=()=>Buffer.from("export const BROADCAST_OPERATORS = new Set(['ADD', 'MUL', 'SUB', 'DIV']);");
    const comparisonChecker=()=>Buffer.from("export const BROADCAST_OPERATORS = new Set(['ADD', 'MUL', 'SUB', 'DIV', 'MAXIMUM', 'MINIMUM']);");
    assert.throws(()=>assertSiteOperations(report,site,broadcast,oldChecker),/Site operation evidence/);
    const extended={...report,addValidationRequired:true,addValidation:{status:'passed'},mulValidationRequired:true,mulValidation:{status:'passed'},
        checks:[...checks,'ADD invalid input broadcast rejected before download; float32 and dynamic ADD report and reopen at 32px',
            'MUL blocks incompatible broadcast and preserves float, dynamic and mixed quantized outputs after export and reopen at 32px']};
    assert.equal(assertSiteOperations(extended,site,broadcast,oldChecker).checks,40);
    assert.throws(()=>assertSiteOperations({...extended,mulValidation:{status:'failed'}},site,broadcast,oldChecker),/Site operation evidence/);
    assert.throws(()=>assertSiteOperations(extended,site,broadcast,newChecker),/Site operation evidence/);
    const current=structuredClone(extended);
    for(const op of ['SUB','DIV','MAXIMUM','MINIMUM']){
        const key=op.toLowerCase()+'Validation';
        const layout={width:1280,height:640,left:260,right:1020,top:12,bottom:628,client:758,scroll:758};
        current[key+'Required']=true;
        current[key]={status:'passed',downloads:4,modelWorkers:7,workers:Array(7).fill(current.workers[0]),cases:[
            {kind:'invalid',status:'rejected',reason:op+' 的輸入 shape 無法 broadcast。',downloads:0},
            {kind:'valid',status:'passed',layout,reopenedOperators:3,outputSHA256:'1'.repeat(64),statuses:['passed','passed','passed']},
            {kind:'dynamic',status:'passed',layout,reopenedOperators:3,outputSHA256:'2'.repeat(64),statuses:['not-run','passed','passed']}
        ]};
        current.checks.push(op+' invalid input broadcast rejected before download; float32 and dynamic '+op+' report and reopen at 32px');
        if(op==='DIV'){
            assert.equal(assertSiteOperations(current,site,broadcast,newChecker).checks,42);
            assert.throws(()=>assertSiteOperations(current,site,broadcast,comparisonChecker),/Site operation evidence/);
        }
    }
    assert.equal(assertSiteOperations(current,site,broadcast,comparisonChecker).checks,44);
    for(const mutate of [
        r=>delete r.subValidation, r=>r.divValidationRequired=false, r=>r.divValidation.cases.pop(),
        r=>r.subValidation.cases[0].downloads=1, r=>r.divValidation.cases[1].reopenedOperators=2,
        r=>r.subValidation.cases[1].outputSHA256='fake', r=>r.divValidation.cases[2].statuses[0]='passed',
        r=>r.divValidation.cases[1].layout.right=1282, r=>r.subValidation.workers.pop(),
        r=>r.divValidation.workers[0]={...r.divValidation.workers[0],closed:false},
        r=>delete r.maximumValidation, r=>r.minimumValidation.cases[1].outputSHA256='fake'
    ]){
        const broken=structuredClone(current);
        mutate(broken);
        assert.throws(()=>assertSiteOperations(broken,site,broadcast,comparisonChecker),/Site operation evidence/);
    }
    assert.throws(()=>assertSiteOperations(current,site,broadcast,()=>Buffer.from('export const BROADCAST_OPERATORS = supported;')),
        /Unrecognized TFLite broadcast validation declaration/);
});

test('site operation archive has exactly the report and screenshot with bounded safe entries',()=>{
    const python=process.env.PYTHON_BIN||(process.platform==='win32'?'python':'python3');
    const make=(...names)=>execFileSync(python,['-I','-c',"import io,zipfile,sys\nb=io.BytesIO()\nwith zipfile.ZipFile(b,'w') as z:\n for name in sys.argv[1:]: z.writestr(name,'{}')\nsys.stdout.buffer.write(b.getvalue())",...names],{windowsHide:true});
    const read=bytes=>readArtifact(bytes,'sha256:'+createHash('sha256').update(bytes).digest('hex'),{operations:true});
    assert.deepEqual(read(make('production-smoke.png','production-smoke.json')).report,{});
    for(const names of [['production-smoke.json'],['../production-smoke.json','production-smoke.png'],
        ['production-smoke.json','production-smoke.png','extra.json'],['production-smoke.json','production-smoke.json']]){
        assert.throws(()=>read(make(...names)),/Invalid release gate archive/);
    }
});
