import {execFileSync} from 'node:child_process';
import {appendFile} from 'node:fs/promises';
import {prValidationPlan} from './lib/pr-validation-plan.mjs';
const git=args=>execFileSync('git',args,{encoding:'utf8',windowsHide:true,maxBuffer:4*1024**2}).trim(),base=process.env.PR_BASE_SHA;
let plan={runtimeRequired:true,reason:'No fixed PR base; retain full Node/build check',runtimeFiles:[]};
if(/^[a-f0-9]{40}$/.test(base||'')){
    const files=git(['diff','--name-only','-z',base,'HEAD']).split('\0').filter(Boolean),load=(ref,file)=>{try{return JSON.parse(git(['show',`${ref}:${file}`]));}catch{return null;}};
    plan=prValidationPlan(files,{packageBefore:load(base,'package.json'),packageAfter:load('HEAD','package.json'),lockBefore:load(base,'package-lock.json'),lockAfter:load('HEAD','package-lock.json')});
}
if(process.env.GITHUB_OUTPUT)await appendFile(process.env.GITHUB_OUTPUT,`runtime=${plan.runtimeRequired}\n`);
if(process.env.GITHUB_STEP_SUMMARY)await appendFile(process.env.GITHUB_STEP_SUMMARY,`PR validation plan: **${plan.runtimeRequired?'required':'not required'}**\n\n${plan.reason}\n`);
console.log(JSON.stringify(plan));
