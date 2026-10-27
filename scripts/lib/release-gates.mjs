import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import path from 'node:path';
import {readFile,mkdir,mkdtemp} from 'node:fs/promises';
import {root,verifyArtifact,gitSource} from './release-artifact.mjs';
import {buildSite} from '../build.mjs';
import {RELEASE_CONTRACT_TESTS} from './release-test-plan.mjs';
import {evaluatePerformanceRun} from './performance-policy.mjs';
import {evaluateLifecycle,LIFECYCLE_POLICY,MODEL_EDIT_LIFECYCLE_POLICY} from '../../test/browser/lifecycle-policy.mjs';
import {evaluateSiteBrowser} from './site-browser-policy.mjs';

const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const stable=value=>JSON.stringify(value,(_,v)=>v && !Array.isArray(v) && typeof v==='object'?Object.fromEntries(Object.entries(v).sort(([a],[b])=>a.localeCompare(b))):v);
export const GATES=Object.freeze({
    core:{workflow:'.github/workflows/performance.yml',job:'measure',artifact:'core-performance',entries:['scripts/accept-performance.mjs','scripts/measure-performance.mjs','test/performance-policy.json']},
    browser:{workflow:'.github/workflows/browser-lifecycle.yml',job:'lifecycle',artifact:'browser-lifecycle',entries:['test/browser/model-lifecycle.mjs','scripts/build.mjs']},
    contract:{workflow:'.github/workflows/release-contract.yml',job:'release-contract',artifact:'release-contract',entries:['scripts/accept-release-contract.mjs','scripts/publish-github-pages.mjs','scripts/package-release.mjs','scripts/verify-release.mjs','test/release.test.mjs','test/release-gates.test.mjs']},
    site:{workflow:'.github/workflows/production-smoke.yml',job:'site-upgrade',artifact:'versioned-site-browser',entries:['test/browser/versioned-site.mjs','test/browser/production-smoke.mjs','scripts/lib/versioned-site.mjs']}
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
export function assertRun({run,jobs,artifact},kind,repository){
    const spec=GATES[kind];
    if(!spec || run?.status!=='completed'||run.conclusion!=='success'||run.event!=='workflow_dispatch'||run.head_branch!=='main'||run.head_repository?.full_name!==repository||run.path!==spec.workflow||!/^[a-f0-9]{40}$/.test(run.head_sha)||!Number.isSafeInteger(run.run_attempt)||run.run_attempt<1)throw Error(`${kind}: untrusted, incomplete or unsuccessful workflow.`);
    const matches=jobs.filter(job=>job.name===spec.job);if(matches.length!==1||matches[0].status!=='completed'||matches[0].conclusion!=='success')throw Error(`${kind}: required job did not succeed.`);
    if(artifact?.name!==`${spec.artifact}-${run.head_sha}-${run.run_attempt}`||artifact.expired!==false||!Number.isSafeInteger(artifact.id)||!Number.isSafeInteger(artifact.size_in_bytes)||artifact.size_in_bytes<=0||artifact.size_in_bytes>4*1024**2||!/^sha256:[a-f0-9]{64}$/.test(artifact.digest||''))throw Error(`${kind}: missing, stale or invalid artifact.`);
}
export function assertReport(report,kind,run,tree,policy){
    if(report?.status!=='passed')throw Error(`${kind}: failed report.`);
    if(kind==='core'){
        if(report.format!=='model-lens-performance-run'||report.version!==1||report.source?.commit!==run.head_sha||report.source.tree!==tree||report.source.dirty!==false||report.sourceUnchanged!==true||report.referenceEnvironment!==true||stable(report.policy)!==stable(policy)||evaluatePerformanceRun(policy,report.samples).status!=='passed')throw Error('core: invalid source, policy or measurements.');
    }else if(kind==='browser'){
        const lifecyclePolicy=report.policy?.version===2?MODEL_EDIT_LIFECYCLE_POLICY:LIFECYCLE_POLICY,editing=lifecyclePolicy.version===2;
        if(report.environment?.sourceCommit!==run.head_sha||report.environment.sourceTree!==tree||report.environment.sourceDirty!==false||report.browserClosed!==true||!Array.isArray(report.errors)||report.errors.length||stable(report.policy)!==stable(lifecyclePolicy)||evaluateLifecycle(report).status!=='passed')throw Error('browser: invalid source or lifecycle measurements.');
        const workers=report.audit?.workers?.filter(w=>/\/model-worker\.js(?:\?|$)/.test(w.url))||[];
        if(workers.length!==(editing?24:16)||workers.some(w=>w.terminated!==true||w.error||!w.audit?.calls||w.audit.violations?.length!==0||w.audit.bytes!==w.stats?.bytesRead+(w.verificationReadBytes||0))||!Array.isArray(report.audit?.urls)||!report.audit.urls.length||report.audit.urls.some(u=>u.revoked!==true))throw Error('browser: retained resources or missing read audit.');
        if(!editing&&workers.some(w=>w.verificationPasses!==undefined||w.verificationReadBytes!==undefined))throw Error('browser: edit verification cannot use the legacy lifecycle policy.');
        if(editing&&(workers.filter(w=>w.verificationPasses===1).length!==8||workers.some(w=>w.verificationPasses!==undefined&&(w.verificationPasses!==1||!Number.isSafeInteger(w.verificationReadBytes)||w.verificationReadBytes<=0||!Number.isSafeInteger(w.verificationFileBytes)||w.verificationFileBytes<=1024**3))))throw Error('browser: missing actual candidate read audit.');
        if(editing&&workers.some(w=>w.verificationReadBytes!==undefined&&w.verificationPasses!==1))throw Error('browser: unattributed candidate reads.');
        for(const audit of [report.audit.audit,...workers.map(w=>w.audit)])if(!audit||!Array.isArray(audit.violations)||audit.violations.length||!Number.isFinite(audit.bytes)||audit.bytes<=0||audit.bytes>LIFECYCLE_POLICY.realmReadBytes||!Number.isFinite(audit.maxRead)||audit.maxRead<=0||audit.maxRead>LIFECYCLE_POLICY.maxReadBytes)throw Error('browser: invalid or excessive native reads.');
        if(report.fixture?.sha256!=='7ea3c8b317c42a3464b74ef8d9a80b27b42f912c1592b5c60daab670ffc66586'||report.fixture.operators!==21005||report.fixture.bytes!==1349965216||!Number.isFinite(report.fixture.allocatedBytes)||report.fixture.allocatedBytes<report.fixture.bytes*.99)throw Error('browser: missing physical fixture evidence.');
    }else if(kind==='site'){
        if(report.source?.commit!==run.head_sha||report.source.tree!==tree||evaluateSiteBrowser(report).status!=='passed')throw Error('site: incomplete browser upgrade/rollback evidence or wrong source.');
    }else if(kind==='contract'){
        if(report.format!=='model-lens-release-contract'||report.version!==1||report.source?.commit!==run.head_sha||report.source.tree!==tree||report.source.dirty!==false||report.sourceUnchanged!==true||stable(report.tests)!==stable(RELEASE_CONTRACT_TESTS)||report.exitCode!==0||!Number.isInteger(report.counts?.tests)||report.counts.tests<1||report.counts.fail!==0||report.counts.skipped!==0||report.counts.cancelled!==0)throw Error('contract: incomplete or failed release tests.');
    }else throw Error('Unknown gate report.');
}
export function readArtifact(bytes,expectedDigest){
    if(!Buffer.isBuffer(bytes)||bytes.length>4*1024**2||`sha256:${hash(bytes)}`!==expectedDigest)throw Error('Artifact digest mismatch.');
    const python=process.env.PYTHON_BIN||(process.platform==='win32'?'python':'python3');
    // No extraction and no execution of archive contents. Reject duplicates,
    // traversal, directories, extra files and oversized inflated data before read.
    const script="import sys,io,zipfile\nz=zipfile.ZipFile(io.BytesIO(sys.stdin.buffer.read()))\na=z.infolist()\nassert len(a)==1\nf=a[0]\nassert '/' not in f.filename and '\\\\' not in f.filename and f.filename.endswith('.json') and not f.is_dir() and 0<f.file_size<=4*1024*1024\nsys.stdout.buffer.write(z.read(f))";
    let raw;
    try{raw=execFileSync(python,['-I','-c',script],{input:bytes,maxBuffer:4*1024**2,timeout:10000,windowsHide:true,stdio:['pipe','pipe','pipe']});}
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
        receipts.push({kind,runId,url:run.html_url,testedCommit:run.head_sha,artifactId:artifact.id,artifactDigest:artifact.digest,reportSHA256:downloaded.sha256,scopeFingerprint:targetScope.fingerprint,scopeFiles:targetScope.files,reused:run.head_sha!==commit});
    }
    const endSource=gitSource();if(endSource.dirty||endSource.commit!==commit||endSource.tree!==source.tree)throw Error('Source changed during release verification.');
    return {preparedDirectory:rebuilt.directory,format:'model-lens-release-gates',version:1,status:'passed',verifiedAt:new Date().toISOString(),repository,release:manifest.release,reproducibleManifestSHA256:hash(stable(expected)),gates:receipts};
}
