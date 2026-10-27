import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {execFileSync,spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import path from 'node:path';
import {root,gitSource} from './lib/release-artifact.mjs';
const args=process.argv.slice(2);if(args.length!==2||args[0]!=='--out')throw Error('Usage: node scripts/accept-release-contract.mjs --out new/report.json');
const output=path.resolve(args[1]);await mkdir(path.dirname(output),{recursive:true});await writeFile(output,'',{flag:'wx'});
const report={format:'model-lens-release-contract',version:1,status:'failed',startedAt:new Date().toISOString(),source:gitSource(),tests:['test/release.test.mjs','test/release-gates.test.mjs'],node:process.version};
try{
    if(report.source.dirty)throw Error('Release contract needs committed clean source.');
    const result=spawnSync(process.execPath,['--test','--test-reporter=tap',...report.tests],{cwd:root,encoding:'utf8',timeout:180000,maxBuffer:4*1024**2,windowsHide:true});
    process.stdout.write(result.stdout||'');process.stderr.write(result.stderr||'');report.exitCode=result.status;report.stdoutSHA256=createHash('sha256').update(result.stdout||'').digest('hex');
    report.counts=Object.fromEntries(['tests','pass','fail','skipped','cancelled'].map(key=>[key,Number((result.stdout||'').match(new RegExp(`^# ${key} (\\d+)$`,'m'))?.[1]??NaN)]));
    const after=gitSource();report.sourceUnchanged=after.commit===report.source.commit&&after.tree===report.source.tree&&!after.dirty;
    if(result.error||result.status!==0||!report.sourceUnchanged||!Number.isInteger(report.counts.tests)||report.counts.tests<1||report.counts.fail!==0||report.counts.skipped!==0||report.counts.cancelled!==0)throw Error(result.error?.message||'Required release contract tests failed or were skipped.');
    report.status='passed';
}catch(error){report.error=error.message;process.exitCode=1;}
finally{report.finishedAt=new Date().toISOString();await writeFile(output,JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify({status:report.status,report:output}));}
