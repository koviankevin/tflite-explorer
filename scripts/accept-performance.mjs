// Lightweight Node regression gate. No browser automation or giant disk files.
import {readFile,writeFile,mkdir,open} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {spawn,execFileSync} from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {validatePerformancePolicy,evaluatePerformanceRun} from './lib/performance-policy.mjs';
import {resources} from './large-mlir-resources.mjs';
const root=fileURLToPath(new URL('..',import.meta.url)),argv=process.argv.slice(2);
if(argv.length && (argv.length!==2 || argv[0]!=='--out'))throw Error('Usage: node scripts/accept-performance.mjs [--out new/report.json]');
const output=path.resolve(argv[1] || path.join(root,'test-results/performance.json'));
await mkdir(path.dirname(output),{recursive:true});const initial=await open(output,'wx');await initial.close();
const git=(...args)=>execFileSync('git',args,{cwd:root,encoding:'utf8',windowsHide:true}).trim();
const canonical=(name,data)=>/\.(?:js|mjs|json|html|css|yml)$/.test(name)?Buffer.from(data.toString().replaceAll('\r\n','\n')):data;
const fingerprint=async()=>{
    const names=[...new Set(git('ls-files','-z','--cached','--others','--exclude-standard','--','src','vendor','test/fixture.mjs','test/performance-fixtures.mjs','test/performance-policy.json','scripts/accept-performance.mjs','scripts/measure-performance.mjs','scripts/lib/performance-policy.mjs','scripts/large-mlir-resources.mjs','package.json','package-lock.json','.github/workflows/performance.yml').split('\0').filter(Boolean))].sort(),files=[];
    for(const name of names){const data=canonical(name,await readFile(path.join(root,name)));files.push({path:name,sha256:createHash('sha256').update(data).digest('hex')});}
    return {commit:git('rev-parse','HEAD'),tree:git('rev-parse','HEAD^{tree}'),dirty:!!git('status','--porcelain'),fingerprint:createHash('sha256').update(JSON.stringify(files)).digest('hex'),files};
};
const report={format:'model-lens-performance-run',version:1,status:'running',startedAt:new Date().toISOString(),
    scope:'Node synthetic core processing; no browser/worker memory, real model, physical >1GiB I/O or native compiler acceptance',
    policySHA256:null,policy:null,
    environment:{platform:process.platform,arch:process.arch,node:process.version,cpus:os.cpus().length,cpuModel:os.cpus()[0]?.model || null,osRelease:os.release(),runnerImage:process.env.ImageOS || null,imageVersion:process.env.ImageVersion || null,githubRunId:process.env.GITHUB_RUN_ID || null,githubRunAttempt:process.env.GITHUB_RUN_ATTEMPT || null},samples:[],limitations:[
        'Absolute ceilings catch coarse regressions; hosted runners vary in CPU and disk, so these are not a fixed hardware latency SLA.',
        'TFLite uses a deterministic virtual zero-weight range source with guarded reads, not a physical File or cold disk measurement.',
        'MLIR uses 20,010 structural operations and no giant dense weights; the separate physical 2.5GiB acceptance remains required.',
        'Each sample starts a fresh Node process. maxRSS is its OS high-water process RSS including fixture generation, not browser/worker RSS.',
        'Cancellation passes only when the task cooperatively aborts or completes within 50ms before a pending timer; no forced GC or retries.'
    ]};
const save=()=>writeFile(output,JSON.stringify(report,null,2)+'\n');
try {
    const policyBytes=await readFile(new URL('../test/performance-policy.json',import.meta.url)),policy=validatePerformancePolicy(JSON.parse(policyBytes));
    report.policy=policy;report.policySHA256=createHash('sha256').update(canonical('policy.json',policyBytes)).digest('hex');
    report.source=await fingerprint();report.preflight=await resources(path.dirname(output));
    report.referenceEnvironment=process.platform===policy.reference.platform && process.arch===policy.reference.arch && process.versions.node===policy.reference.nodeVersion && process.env.ImageOS===policy.reference.runnerImage;
    if(report.preflight.memoryBytes<2*1024**3){report.status='resource_insufficient';process.exitCode=2;}
    else {
        for(const c of policy.cases)for(let iteration=1;iteration<=policy.samplesPerCase;iteration++) {
            const sample={caseId:c.id,iteration,status:'failed'},started=performance.now();report.samples.push(sample);await save();
            const child=spawn(process.execPath,['--max-old-space-size=768',path.join(root,'scripts/measure-performance.mjs'),c.id],{cwd:root,stdio:['ignore','pipe','pipe'],windowsHide:true});
            let stdout='',stderr='',timedOut=false,outputExceeded=false;
            const timer=setTimeout(()=>{timedOut=true;child.kill();},policy.childTimeoutMs);
            child.stdout.on('data',chunk=>{if(stdout.length+chunk.length>1024*1024){outputExceeded=true;child.kill();}else stdout+=chunk;});
            child.stderr.on('data',chunk=>{stderr=(stderr+chunk).slice(-8192);});
            const result=await new Promise(resolve=>{child.on('error',error=>resolve({error:error.message}));child.on('close',(code,signal)=>resolve({code,signal}));});clearTimeout(timer);
            if(result.code===0 && !timedOut && !outputExceeded)try{Object.assign(sample,JSON.parse(stdout),{iteration});}catch{sample.failure='invalid-child-report';}
            else sample.failure=timedOut?'timeout':outputExceeded?'child-output-limit':result.error || `child-exit-${result.code}-${result.signal || 'none'}`;
            Object.assign(sample,{elapsedMs:performance.now()-started,stderr});await save();
            console.log(JSON.stringify({caseId:c.id,iteration,status:sample.status,maxRSSBytes:sample.metrics?.maxRSSBytes,failure:sample.failure}));
        }
        const endSource=await fingerprint();report.sourceUnchanged=endSource.commit===report.source.commit && endSource.fingerprint===report.source.fingerprint;
        report.gate=evaluatePerformanceRun(policy,report.samples);
        if(process.env.GITHUB_ACTIONS==='true' && !report.referenceEnvironment)report.gate.issues.push({sample:'environment',issues:['non-reference-runner']});
        if(!report.sourceUnchanged)report.gate.issues.push({sample:'source',issues:['source-changed-during-measurement']});
        report.status=report.gate.issues.length?'failed':'passed';if(report.status!=='passed')process.exitCode=1;
    }
}catch(error){report.status='failed';report.failure=error.message;process.exitCode=1;}
finally {
    report.finishedAt=new Date().toISOString();await save();
    if(process.env.GITHUB_STEP_SUMMARY)await writeFile(process.env.GITHUB_STEP_SUMMARY,`## Core performance gate\n\nStatus: **${report.status}**\n\nSource: \`${report.source?.commit || 'unavailable'}\`\n\nReference runner class: ${report.referenceEnvironment}\n\nThis covers Node core processing only; see the artifact for measurements and limits.\n`);
    console.log(JSON.stringify({status:report.status,report:output,issues:report.gate?.issues}));
}
