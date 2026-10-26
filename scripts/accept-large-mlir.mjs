// Fixed-size optional acceptance. No size override or automatic smaller fallback.
import {mkdir,readFile,writeFile,stat,appendFile} from 'node:fs/promises';
import {createReadStream} from 'node:fs';
import {createHash} from 'node:crypto';
import {spawn,execFileSync} from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import assert from 'node:assert/strict';
import {HEX_MIB,SOURCE_BYTES,SOURCE_SHA256,PAYLOAD_SHA256,requirements,resources,resourceShortfalls,classifyFailure} from './large-mlir-resources.mjs';

const root=fileURLToPath(new URL('..',import.meta.url));
const directory=path.resolve(process.argv[2] || 'test-results/large-mlir');
// Never overwrite an earlier run or trust its files as evidence for this run.
await mkdir(path.dirname(directory),{recursive:true});
await mkdir(directory,{recursive:false});
const json=async name=>JSON.parse(await readFile(path.join(directory,name),'utf8'));
const git=(...args)=>execFileSync('git',args,{cwd:root,encoding:'utf8'}).trim();
const report={schemaVersion:1,status:'running',startedAt:new Date().toISOString(),
    scope:'Node.js physical synthetic MLIR; no browser, native compiler or company-model acceptance',
    sourceCommit:git('rev-parse','HEAD'),workingTreeDirty:!!git('status','--porcelain'),
    requested:{hexMiB:HEX_MIB,sourceBytes:SOURCE_BYTES},requirements,
    environment:{node:process.version,platform:process.platform,arch:process.arch,release:os.release(),
        cpus:os.cpus().length,osRelease:await readFile('/etc/os-release','utf8').catch(()=>null),
        runner:process.env.RUNNER_NAME??null,image:process.env.ImageOS??null,imageVersion:process.env.ImageVersion??null,
        repository:process.env.GITHUB_REPOSITORY??null,ref:process.env.GITHUB_REF??null,
        workflowCommit:process.env.GITHUB_SHA??null,runId:process.env.GITHUB_RUN_ID??null,runAttempt:process.env.GITHUB_RUN_ATTEMPT??null},stages:[]};
const save=()=>writeFile(path.join(directory,'acceptance-report.json'),JSON.stringify(report,null,2)+'\n');
const hashFile=async file=>{
    const hash=createHash('sha256');for await(const chunk of createReadStream(file))hash.update(chunk);
    return hash.digest('hex');
};
let stage='preflight';
try {
    report.preflight=await resources(directory);await save();
    const shortfalls=resourceShortfalls(report.preflight);
    if(shortfalls.length) {
        report.status='resource_insufficient';report.shortfalls=shortfalls;process.exitCode=2;
    } else {
        for(const script of ['large-mlir-fixture.mjs','verify-large-mlir.mjs']) {
            stage=script;const before=await resources(directory),started=performance.now();
            const entry={name:script,startedAt:new Date().toISOString(),before};report.stages.push(entry);await save();
            const args=[path.join(root,'scripts',script),directory,...(script==='large-mlir-fixture.mjs'?[String(HEX_MIB)]:[])];
            const child=spawn(process.execPath,args,{cwd:root,stdio:['ignore','pipe','pipe']});
            let stderr='';child.stdout.on('data',chunk=>process.stdout.write(chunk));
            child.stderr.on('data',chunk=>{process.stderr.write(chunk);stderr=(stderr+chunk).slice(-16384);});
            const result=await new Promise((resolve,reject)=>{
                child.on('error',reject);child.on('close',(code,signal)=>resolve({code,signal}));
            });
            Object.assign(entry,result,{elapsedMs:performance.now()-started,after:await resources(directory),stderr});
            if(result.code!==0) {
                report.status=classifyFailure({stderr,signal:result.signal,
                    oomBefore:before.oomKills,oomAfter:entry.after.oomKills});
                throw new Error(`${script} exited ${result.code}, signal ${result.signal}`);
            }
            // Each actual child reports its OS high-water RSS, rather than the
            // small orchestrator's usage. maxRSS is in bytes in these reports.
            const childReport=await json(script==='large-mlir-fixture.mjs'?'fixture.json':'node-report.json');
            entry.measurement={maxRSS:childReport.maxRSS,totalMs:childReport.totalMs};
            if(script==='large-mlir-fixture.mjs') {
                const fixture=await json('fixture.json');
                assert.equal(fixture.bytes,SOURCE_BYTES);assert.equal((await stat(fixture.file)).size,SOURCE_BYTES);
                assert.equal(fixture.payloadBytes,HEX_MIB*1024**2+4);
                assert.equal(fixture.sha256,SOURCE_SHA256);assert.equal(fixture.payloadSha256,PAYLOAD_SHA256);
            }
            await save();
        }
        stage='audit';
        report.fixture=await json('fixture.json');report.verification=await json('node-report.json');
        const v=report.verification;
        assert.equal(v.sourceBytes,SOURCE_BYTES);assert.equal(v.stats.fileBytes,SOURCE_BYTES);
        assert.equal(v.stats.bytesRead,SOURCE_BYTES);assert.equal(v.stats.deferredPayloads,1);
        assert.equal(v.stats.deferredBytes,HEX_MIB*1024**2+4);
        assert.ok(v.stats.structureBytes<1024**2);assert.ok(v.outputBytes>=SOURCE_BYTES);
        assert.equal((await stat(v.output)).size,v.outputBytes);
        assert.equal(v.patternMatches,1);assert.equal(v.reopenedPatternMatches,1);assert.equal(v.ssaDominance,true);
        assert.equal(v.payloadSha256,PAYLOAD_SHA256);assert.equal(v.originalPayloadSha256,PAYLOAD_SHA256);
        report.files={source:{bytes:SOURCE_BYTES,sha256:await hashFile(report.fixture.file)},
            output:{bytes:v.outputBytes,sha256:await hashFile(v.output)}};
        assert.equal(report.files.source.sha256,SOURCE_SHA256);
        report.status='passed';
    }
} catch(error) {
    if(report.status==='running')report.status=classifyFailure({stderr:error.stack});
    report.failure={stage,message:error.message,stack:error.stack};process.exitCode=report.status==='resource_exhausted'?2:1;
} finally {
    report.finishedAt=new Date().toISOString();report.finalResources=await resources(directory);await save();
    if(process.env.GITHUB_STEP_SUMMARY)await appendFile(process.env.GITHUB_STEP_SUMMARY,
        `## Optional 2.5 GiB MLIR Node acceptance\n\nStatus: **${report.status}**\n\nSource: \`${report.sourceCommit}\`\n\n`+
        'See the JSON artifact for file hashes, resource measurements and any failure. This does not establish browser, company MLIR or full LLVM verifier acceptance.\n');
    console.log(JSON.stringify({status:report.status,report:path.join(directory,'acceptance-report.json')}));
}
