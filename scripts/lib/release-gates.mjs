import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import path from 'node:path';
import {readFile,mkdir,mkdtemp} from 'node:fs/promises';
import {root,verifyArtifact,gitSource} from './release-artifact.mjs';
import {buildSite} from '../build.mjs';
import {RELEASE_CONTRACT_TESTS} from './release-test-plan.mjs';
import {evaluatePerformanceRun} from './performance-policy.mjs';
import {evaluateLifecycle,LIFECYCLE_POLICY,MODEL_EDIT_LIFECYCLE_POLICY,MODEL_COMPOSITION_LIFECYCLE_POLICY} from '../../test/browser/lifecycle-policy.mjs';
import {evaluateSiteBrowser} from './site-browser-policy.mjs';
import {graphReadabilityRequired} from '../../test/browser/release-features.mjs';

const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const stable=value=>JSON.stringify(value,(_,v)=>v && !Array.isArray(v) && typeof v==='object'?Object.fromEntries(Object.entries(v).sort(([a],[b])=>a.localeCompare(b))):v);
export const GATES=Object.freeze({
    core:{workflow:'.github/workflows/performance.yml',job:'measure',artifact:'core-performance',entries:['scripts/accept-performance.mjs','scripts/measure-performance.mjs','test/performance-policy.json']},
    browser:{workflow:'.github/workflows/browser-lifecycle.yml',job:'lifecycle',artifact:'browser-lifecycle',entries:['test/browser/model-lifecycle.mjs','scripts/build.mjs','scripts/install-browser.mjs']},
    contract:{workflow:'.github/workflows/release-contract.yml',job:'release-contract',artifact:'release-contract',entries:['scripts/accept-release-contract.mjs','scripts/publish-github-pages.mjs','scripts/package-release.mjs','scripts/verify-release.mjs','test/release.test.mjs','test/release-gates.test.mjs']},
    site:{workflow:'.github/workflows/production-smoke.yml',job:'site-upgrade',artifact:'versioned-site-browser',entries:['test/browser/versioned-site.mjs','test/browser/production-smoke.mjs','scripts/lib/versioned-site.mjs','scripts/install-browser.mjs']}
});
export function gitReader(directory=root){
    const cache=new Map();
    const git=args=>execFileSync('git',args,{cwd:directory,encoding:'utf8',windowsHide:true,maxBuffer:16*1024**2}).trim();
    const bytes=(commit,name)=>{const key=`${commit}:${name}`;if(!cache.has(key))cache.set(key,execFileSync('git',['show',key],{cwd:directory,windowsHide:true,maxBuffer:16*1024**2}));return cache.get(key);};
    return {git,bytes,tree:commit=>new Map(git(['ls-tree','-rz',commit]).split('\0').filter(Boolean).map(row=>{const m=/^(\d+) blob ([a-f0-9]{40})\t([\s\S]+)$/.exec(row);if(!m)throw Error('Unsupported source tree entry.');return [m[3],{mode:m[1],sha:m[2]}];}))};
}
// Compare code that the gate actually executes, including relative imports and
// non-module metadata. Version labels alone do not invalidate unchanged tests.
export function sourceScope(kind,commit,reader){
    const spec=GATES[kind];if(!spec)throw Error('Unknown release gate.');
    const tree=reader.tree(commit),names=new Set([spec.workflow,'package.json','package-lock.json']);
    const queue=[...spec.entries];
    // Contract tests deliberately generate JS import strings as fixtures. Scope
    // all build/test sources instead of treating those strings as real imports.
    if(kind==='contract'){
        for(const name of tree.keys())if(/^(src|vendor|scripts|test)\//.test(name)||/^\.github\/workflows\//.test(name))names.add(name);
        names.add('docs/results/browser-lifecycle-2026-10-27.json');
        names.add('docs/results/site-browser-2026-10-27.json');
        names.add('.github/workflows/verified-pages.yml');
    }
    // Browser/packaging copy or execute web files; Node core only executes its module closure.
    for(const name of tree.keys())if((kind!=='core' && /^(src|vendor)\//.test(name)) || /^vendor\/.*\.json$/.test(name))queue.push(name);
    while(queue.length){
        const name=queue.pop();if(names.has(name))continue;names.add(name);
        if(!tree.has(name))throw Error(`Missing gate dependency ${name}.`);
        if(kind==='contract'||!/\.[cm]?js$/.test(name))continue;
        const text=reader.bytes(commit,name).toString('utf8');
        const imports=[...text.matchAll(/^\s*(?:import\s+(?:[\w*$ {},\r\n]+?\s+from\s*)?|export\s+[\w*$ {},\r\n]+?\s+from\s*)['"](\.[^'"\r\n]+)['"]/gm),...text.matchAll(/\bimport\s*\(\s*['"](\.[^'"\r\n]+)['"]\s*\)/g)];
        for(const match of imports){
            const dependency=path.posix.normalize(path.posix.join(path.posix.dirname(name),match[1].split('?')[0]));
            if(dependency.startsWith('../')||!tree.has(dependency))throw Error(`Unresolved gate import ${name}: ${dependency}.`);queue.push(dependency);
        }
    }
    const files=[...names].sort().map(name=>{
        const entry=tree.get(name);if(!entry||entry.mode!=='100644')throw Error(`Missing/non-regular gate source ${name}.`);
        if(name==='package.json'||name==='package-lock.json'){
            const data=JSON.parse(reader.bytes(commit,name));delete data.version;if(name==='package-lock.json'&&data.packages?.[''])delete data.packages[''].version;
            return {path:name,sha256:hash(stable(data))};
        }
        return {path:name,gitBlob:entry.sha};
    });
    return {kind,commit,fingerprint:hash(stable(files)),files};
}
function assertArtifact(artifact,name,kind){
    if(artifact?.name!==name||artifact.expired!==false||!Number.isSafeInteger(artifact.id)||artifact.id<1||
        !Number.isSafeInteger(artifact.size_in_bytes)||artifact.size_in_bytes<=0||artifact.size_in_bytes>4*1024**2||
        !/^sha256:[a-f0-9]{64}$/.test(artifact.digest||''))throw Error(`${kind}: missing, stale or invalid artifact.`);
}

export function assertRun({run,jobs,artifact},kind,repository){
    const spec=GATES[kind];
    if(!spec || run?.status!=='completed'||run.conclusion!=='success'||run.event!=='workflow_dispatch'||run.head_branch!=='main'||run.head_repository?.full_name!==repository||run.path!==spec.workflow||!/^[a-f0-9]{40}$/.test(run.head_sha)||!Number.isSafeInteger(run.run_attempt)||run.run_attempt<1)throw Error(`${kind}: untrusted, incomplete or unsuccessful workflow.`);
    const matches=jobs.filter(job=>job.name===spec.job);if(matches.length!==1||matches[0].status!=='completed'||matches[0].conclusion!=='success')throw Error(`${kind}: required job did not succeed.`);
    assertArtifact(artifact,`${spec.artifact}-${run.head_sha}-${run.run_attempt}`,kind);
}
export function assertReport(report,kind,run,tree,policy){
    if(report?.releaseEvidenceEligible===false||report?.purpose==='readonly-native-memory-attribution')throw Error(`${kind}: diagnostic reports are not release evidence.`);
    if(report?.status!=='passed')throw Error(`${kind}: failed report.`);
    if(kind==='core'){
        if(report.format!=='model-lens-performance-run'||report.version!==1||report.source?.commit!==run.head_sha||report.source.tree!==tree||report.source.dirty!==false||report.sourceUnchanged!==true||report.referenceEnvironment!==true||stable(report.policy)!==stable(policy)||evaluatePerformanceRun(policy,report.samples).status!=='passed')throw Error('core: invalid source, policy or measurements.');
    }else if(kind==='browser'){
        const lifecyclePolicy=report.policy?.version===3?MODEL_COMPOSITION_LIFECYCLE_POLICY:report.policy?.version===2?MODEL_EDIT_LIFECYCLE_POLICY:LIFECYCLE_POLICY,editing=lifecyclePolicy.version>=2,composition=lifecyclePolicy.version===3;
        if(report.environment?.sourceCommit!==run.head_sha||report.environment.sourceTree!==tree||report.environment.sourceDirty!==false||report.browserClosed!==true||!Array.isArray(report.errors)||report.errors.length||stable(report.policy)!==stable(lifecyclePolicy)||evaluateLifecycle(report).status!=='passed')throw Error('browser: invalid source or lifecycle measurements.');
        const workers=report.audit?.workers?.filter(w=>/\/model-worker\.js(?:\?|$)/.test(w.url))||[];
        if(workers.length!==(composition?40:editing?24:16)||workers.some(w=>w.terminated!==true||w.error||!w.audit?.calls||w.audit.violations?.length!==0||w.audit.bytes!==w.stats?.bytesRead+(w.verificationReadBytes||0))||!Array.isArray(report.audit?.urls)||!report.audit.urls.length||report.audit.urls.some(u=>u.revoked!==true))throw Error('browser: retained resources or missing read audit.');
        if(!editing&&workers.some(w=>w.verificationPasses!==undefined||w.verificationReadBytes!==undefined))throw Error('browser: edit verification cannot use the legacy lifecycle policy.');
        if(editing&&(workers.filter(w=>w.verificationPasses===1).length!==(composition?16:8)||workers.some(w=>w.verificationPasses!==undefined&&(w.verificationPasses!==1||!Number.isSafeInteger(w.verificationReadBytes)||w.verificationReadBytes<=0||!Number.isSafeInteger(w.verificationFileBytes)||w.verificationFileBytes<=1024**3))))throw Error('browser: missing actual candidate read audit.');
        if(editing&&workers.some(w=>w.verificationReadBytes!==undefined&&w.verificationPasses!==1))throw Error('browser: unattributed candidate reads.');
        for(const audit of [report.audit.audit,...workers.map(w=>w.audit)])if(!audit||!Array.isArray(audit.violations)||audit.violations.length||!Number.isFinite(audit.bytes)||audit.bytes<=0||audit.bytes>LIFECYCLE_POLICY.realmReadBytes||!Number.isFinite(audit.maxRead)||audit.maxRead<=0||audit.maxRead>LIFECYCLE_POLICY.maxReadBytes)throw Error('browser: invalid or excessive native reads.');
        if(report.fixture?.sha256!=='7ea3c8b317c42a3464b74ef8d9a80b27b42f912c1592b5c60daab670ffc66586'||report.fixture.operators!==21005||report.fixture.bytes!==1349965216||!Number.isFinite(report.fixture.allocatedBytes)||report.fixture.allocatedBytes<report.fixture.bytes*.99)throw Error('browser: missing physical fixture evidence.');
        if(composition){
            const closures=report.workerClosures||[],nativeModels=closures.filter(w=>/\/model-worker\.js(?:\?|$)/.test(w.url)),nativeIdentity=closures.filter(w=>/\/edit-recovery-worker\.js(?:\?|$)/.test(w.url)),identity=report.audit.workers.filter(w=>w.recoveryAudit);
            if(report.sourceUnchanged!==true||report.processCleanup?.allReaped!==true||report.processCleanup.remaining?.length!==0||!report.processCleanup.identities?.length||nativeModels.length!==40||nativeIdentity.length!==16||[...nativeModels,...nativeIdentity].some(w=>w.closed!==true)||identity.length!==16||identity.some(w=>!w.terminated||w.recoveryAudit.complete!==true||w.recoveryAudit.bytes!==report.fixture.bytes||w.recoveryAudit.fingerprint!==report.fixture.editFingerprint||!Number.isFinite(w.recoveryAudit.maxRead)||w.recoveryAudit.maxRead<=0||w.recoveryAudit.maxRead>LIFECYCLE_POLICY.maxReadBytes||w.recoveryAudit.violations?.length!==0))throw Error('browser: missing composition native closure or source identity.');
        }
    }else if(kind==='site'){
        if(report.source?.commit!==run.head_sha||report.source.tree!==tree||evaluateSiteBrowser(report).status!=='passed')throw Error('site: incomplete browser upgrade/rollback evidence or wrong source.');
    }else if(kind==='contract'){
        if(report.format!=='model-lens-release-contract'||report.version!==1||report.source?.commit!==run.head_sha||report.source.tree!==tree||report.source.dirty!==false||report.sourceUnchanged!==true||stable(report.tests)!==stable(RELEASE_CONTRACT_TESTS)||report.exitCode!==0||!Number.isInteger(report.counts?.tests)||report.counts.tests<1||report.counts.fail!==0||report.counts.skipped!==0||report.counts.cancelled!==0)throw Error('contract: incomplete or failed release tests.');
    }else throw Error('Unknown gate report.');
}
const MODEL_CHOOSER_CHECK='native model chooser and native pattern JSON import/export';
const TFLITE_REOPEN_CHECK='actual TFLite submodel download, native reopen, original pattern and worker cleanup';
const DESKTOP_OPERATION_CHECKS=[
    'per-OP static validation, multi-output SPLIT export/reopen, dynamic reasons, invalid SLICE rejection and 32px/21k-OP paged report without automatic interpreter',
    'real WHILE kernel: responsive UI and native cancellation, actual30s timeout, closed Workers and finite CPU/IO recovery',
    'eight manual runtime IO lifecycle cycles, 24 CPU runs, native download/reopen/close, natural URL release and bounded observed process RSS'
];

export function assertSiteOperations(report,site,sourceFiles){
    const require=(value,message)=>{if(!value)throw Error('Site operation evidence: '+message);};
    const release=site.candidate,build=release.buildId,namespace=`versions/${build}/`;
    const snapshot=site.snapshots.find(row=>row.currentBuild===build);
    require(report?.format==='model-lens-production-smoke'&&report.version===1&&report.status==='passed'&&!report.error&&
        report.target==='isolated-versioned-snapshot'&&Array.isArray(report.errors)&&report.errors.length===0,'incomplete or failed smoke report.');
    require(report.driverSourceCommit===release.source.commit&&stable(report.siteRelease)===stable(release)&&
        report.expectedBuild===build&&report.siteId===snapshot?.siteId&&report.coreBasePath===namespace,'wrong source, build or snapshot.');
    const paths=new Set(sourceFiles.map(file=>file.path)),mul=paths.has('src/tflite-broadcast-checks.js');
    const add=mul||paths.has('src/tflite-add-checks.js'),desktop=graphReadabilityRequired(release.version);
    const checks=report.checks,required=[MODEL_CHOOSER_CHECK,TFLITE_REOPEN_CHECK,...(desktop?DESKTOP_OPERATION_CHECKS:[])];
    require(Array.isArray(checks)&&checks.length>=(desktop?38:required.length)+Number(add)+Number(mul)&&checks.length<=256&&
        checks.every(value=>typeof value==='string'&&value.length>0&&value.length<=512)&&new Set(checks).size===checks.length&&
        required.every(value=>checks.includes(value)),'missing or duplicate browser scenarios.');
    for(const [operator,enabled,prefix]of [
        ['add',add,'ADD invalid input broadcast'],
        ['mul',mul,'MUL blocks incompatible broadcast']
    ]){
        if(enabled)require(report[operator+'ValidationRequired']===true&&report[operator+'Validation']?.status==='passed'&&
            checks.some(value=>value.startsWith(prefix)),`missing ${operator.toUpperCase()} validation.`);
    }
    const workers=report.workers,cleanup=report.processCleanup;
    require(Array.isArray(workers)&&workers.length>0&&workers.length<=1024&&workers.every(worker=>worker?.closed===true&&typeof worker.url==='string')&&
        cleanup?.allReaped===true&&Array.isArray(cleanup.remaining)&&cleanup.remaining.length===0&&
        Array.isArray(cleanup.identities)&&cleanup.identities.length>0,'retained browser process or Worker.');
    const modelWorkers=workers.filter(worker=>/\/model-worker\.js(?:\?|$)/.test(worker.url));
    require(modelWorkers.length>0&&modelWorkers.every(worker=>
        worker.url.endsWith(`/${namespace}src/model-worker.js?v=${build}`)),'wrong model Worker namespace.');
    return {checks:checks.length,buildId:build,siteId:snapshot.siteId};
}

export function readArtifact(bytes,expectedDigest,{operations=false}={}){
    if(!Buffer.isBuffer(bytes)||bytes.length>4*1024**2||`sha256:${hash(bytes)}`!==expectedDigest)throw Error('Artifact digest mismatch.');
    const python=process.env.PYTHON_BIN||(process.platform==='win32'?'python':'python3');
    // No extraction or execution. Check the complete bounded archive before
    // reading the JSON entry from either supported archive format.
    const script="import sys,io,zipfile\nz=zipfile.ZipFile(io.BytesIO(sys.stdin.buffer.read()))\na=z.infolist()\nif sys.argv[1]=='operations':\n assert sorted(f.filename for f in a)==['production-smoke.json','production-smoke.png']\n name='production-smoke.json'\nelse:\n assert len(a)==1\n name=a[0].filename\n assert '/' not in name and '\\\\' not in name and name.endswith('.json')\nassert all(not f.is_dir() and 0<f.file_size<=4*1024*1024 for f in a)\nassert z.testzip() is None\nsys.stdout.buffer.write(z.read(name))";
    let raw;
    try{raw=execFileSync(python,['-I','-c',script,operations?'operations':'gate'],{input:bytes,maxBuffer:4*1024**2,timeout:10000,windowsHide:true,stdio:['pipe','pipe','pipe']});}
    catch{throw Error('Invalid release gate archive: entry count, path, inflated size or CRC.');}
    return {report:JSON.parse(raw),sha256:hash(raw)};
}

export function githubClient(){
    const gh=process.env.GH_BIN||'gh';
    const call=(route,binary=false)=>{
        if(!/^repos\/[\w.-]+\/[\w.-]+\//.test(route))throw Error('Only repository API routes are allowed.');
        return execFileSync(gh,['api',route],{encoding:binary?undefined:'utf8',windowsHide:true,timeout:30000,maxBuffer:binary?4*1024**2:8*1024**2});
    };
    return {json:async route=>JSON.parse(call(route)),bytes:async route=>call(route,true)};
}
export async function verifyReleaseGates({directory='dist',evidence,api=githubClient(),reader=gitReader()}={}){
    const manifest=await verifyArtifact(directory,{publicOnly:true,requireClean:true});
    if(!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/.test(manifest.release.version||''))throw Error('Release needs a valid version label.');
    const commit=manifest.release.source.commit;
    const source=gitSource();if(source.dirty||source.commit!==commit||source.tree!==manifest.release.source.tree)throw Error('Gate verification requires the exact clean candidate checkout.');
    // A self-consistent manifest is not proof that its files came from that Git
    // commit. Rebuild in a fresh public directory and compare every expected hash.
    await mkdir(path.join(root,'build/qa'),{recursive:true});const fresh=await mkdtemp(path.join(root,'build/qa/gate-rebuild-'));
    const rebuilt=await buildSite({output:path.join(fresh,'site')}),expected=await verifyArtifact(rebuilt.directory,{publicOnly:true,requireClean:true});
    if(stable(expected)!==stable(manifest))throw Error('Candidate artifact differs from a fresh build of its declared source.');
    evidence ||= JSON.parse(await readFile(path.join(root,'release-evidence.json'),'utf8'));
    const repository=evidence.repository;
    if(evidence.version!==1||!/^\w[\w.-]*\/[\w.-]+$/.test(repository||'')||Object.keys(GATES).some(kind=>!Number.isSafeInteger(evidence.runs?.[kind])||evidence.runs[kind]<1))throw Error('Missing required release evidence run IDs.');
    const remote=reader.git(['remote','get-url','origin']);if(![ `https://github.com/${repository}.git`,`https://github.com/${repository}`].includes(remote))throw Error('Evidence repository differs from origin.');
    const remoteCommit=await api.json(`repos/${repository}/git/commits/${commit}`);if(remoteCommit.tree?.sha!==manifest.release.source.tree)throw Error('Build source is not the repository commit.');
    const policy=JSON.parse(reader.bytes(commit,'test/performance-policy.json'));
    const receipts=[];
    for(const kind of Object.keys(GATES)){
        const runId=evidence.runs[kind],base=`repos/${repository}/actions/runs/${runId}`;
        const [run,jobsResponse,artifactsResponse]=await Promise.all([api.json(base),api.json(base+'/jobs?per_page=100'),api.json(base+'/artifacts?per_page=100')]);
        if(run.id!==runId)throw Error('Workflow ID mismatch.');
        if(jobsResponse.total_count!==jobsResponse.jobs?.length||artifactsResponse.total_count!==artifactsResponse.artifacts?.length)throw Error('Paginated gate evidence requires explicit review.');
        const artifacts=artifactsResponse.artifacts.filter(a=>a.name===`${GATES[kind].artifact}-${run.head_sha}-${run.run_attempt}`);if(artifacts.length!==1)throw Error(`${kind}: missing or ambiguous artifact.`);
        const artifact=artifacts[0];assertRun({run,jobs:jobsResponse.jobs,artifact},kind,repository);
        const targetScope=sourceScope(kind,commit,reader),testedScope=sourceScope(kind,run.head_sha,reader);
        if(targetScope.fingerprint!==testedScope.fingerprint){const previous=new Map(testedScope.files.map(f=>[f.path,stable(f)]));const changes=targetScope.files.filter(f=>previous.get(f.path)!==stable(f)).map(f=>f.path);throw Error(`${kind}: tested source differs; run this gate for the candidate. Changed: ${changes.slice(0,10).join(', ')}`);}
        const downloaded=readArtifact(await api.bytes(`repos/${repository}/actions/artifacts/${artifact.id}/zip`),artifact.digest);
        assertReport(downloaded.report,kind,run,reader.git(['rev-parse',`${run.head_sha}^{tree}`]),policy);
        const receipt={kind,runId,url:run.html_url,testedCommit:run.head_sha,artifactId:artifact.id,artifactDigest:artifact.digest,
            reportSHA256:downloaded.sha256,scopeFingerprint:targetScope.fingerprint,scopeFiles:targetScope.files,reused:run.head_sha!==commit};
        if(kind==='site'){
            const name=`versioned-delivery-smoke-${run.head_sha}-${run.run_attempt}`;
            const matches=artifactsResponse.artifacts.filter(item=>item.name===name);
            if(matches.length!==1)throw Error('Site operation evidence: missing or ambiguous artifact.');
            const [operationArtifact]=matches;
            assertArtifact(operationArtifact,name,'Site operation evidence');
            const raw=await api.bytes(`repos/${repository}/actions/artifacts/${operationArtifact.id}/zip`);
            const operations=readArtifact(raw,operationArtifact.digest,{operations:true});
            const summary=assertSiteOperations(operations.report,downloaded.report,testedScope.files);
            receipt.operationEvidence={artifactId:operationArtifact.id,artifactDigest:operationArtifact.digest,
                reportSHA256:operations.sha256,...summary};
        }
        receipts.push(receipt);
    }
    const endSource=gitSource();if(endSource.dirty||endSource.commit!==commit||endSource.tree!==source.tree)throw Error('Source changed during release verification.');
    return {preparedDirectory:rebuilt.directory,format:'model-lens-release-gates',version:1,status:'passed',verifiedAt:new Date().toISOString(),repository,release:manifest.release,reproducibleManifestSHA256:hash(stable(expected)),gates:receipts};
}
