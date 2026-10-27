// Keep one isolated CI browser alive across workflow checkpoint/upload steps.
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {openSync,closeSync} from 'node:fs';
import {mkdir,readFile,writeFile,realpath} from 'node:fs/promises';
import path from 'node:path';
import {root} from '../../scripts/lib/release-artifact.mjs';
assert.equal(process.env.GITHUB_ACTIONS,'true');assert.equal(process.platform,'linux');assert.equal(process.env.GITHUB_REPOSITORY,'koviankevin/tflite-explorer');assert.equal(process.env.GITHUB_REF,'refs/heads/main');assert.equal(process.env.GITHUB_WORKFLOW,'Production version transition');
assert.match(process.env.GITHUB_SHA||'',/^[a-f0-9]{40}$/);assert.match(process.env.GITHUB_RUN_ID||'',/^\d+$/);assert.match(process.env.GITHUB_RUN_ATTEMPT||'',/^\d+$/);
const directory=path.join(await realpath(process.env.RUNNER_TEMP),'production-transition'),sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const identity={source:process.env.GITHUB_SHA,runId:process.env.GITHUB_RUN_ID,attempt:process.env.GITHUB_RUN_ATTEMPT};
const read=name=>readFile(path.join(directory,name),'utf8').then(JSON.parse);
async function birth(pid){try{const stat=await readFile(`/proc/${pid}/stat`,'utf8');return stat.slice(stat.lastIndexOf(')')+2).trim().split(/\s+/)[19];}catch(error){if(error.code==='ENOENT')return null;throw error;}}
const [command,phase,...extra]=process.argv.slice(2);assert.equal(extra.length,0);assert.ok(['start','wait','stop'].includes(command));
if(command==='start'){
    assert.equal(phase,undefined);assert.match(process.env.EXPECTED_BUILD||'',/^[a-f0-9]{16}$/);assert.match(process.env.EXPECTED_SITE_ID||'',/^[a-f0-9]{64}$/);
    await mkdir(directory);const fd=openSync(path.join(directory,'observer.log'),'wx');let child;
    try{child=spawn(process.execPath,['test/browser/production-transition.mjs'],{cwd:root,stdio:['ignore',fd,fd],env:process.env});await once(child,'spawn');child.unref();}finally{closeSync(fd);}
    const started=await birth(child.pid);assert.match(started||'',/^\d+$/);await writeFile(path.join(directory,'process.json'),JSON.stringify({...identity,pid:child.pid,birth:started,startedAt:Date.now()})+'\n',{flag:'wx'});console.log('Started public-only CI observer.');
}else{
    let record;try{record=await read('process.json');}catch(error){if(command==='stop'&&error.code==='ENOENT')process.exit(0);throw error;}
    for(const [key,value] of Object.entries(identity))assert.equal(record[key],value);assert.ok(Number.isSafeInteger(record.pid)&&record.pid>0);assert.match(record.birth,/^\d+$/);
    const alive=async()=>await birth(record.pid)===record.birth;
    if(command==='wait'){
        assert.ok(['initial-ready','candidate-ready','rollback-verified','complete'].includes(phase));const deadline=record.startedAt+(phase==='initial-ready'?120000:61*60*1000);
        while(true){
            let state;try{state=await read('state.json');}catch(error){if(error.code!=='ENOENT')throw error;}
            if(state){for(const [key,value] of Object.entries(identity))assert.equal(state[key],value);if(state.status==='failed')throw Error(state.error||'Observer failed.');if(state.reached.includes(phase)){if(phase==='complete')assert.equal(state.status,'passed');else assert.equal(await alive(),true,'Observer exited after checkpoint.');console.log('Confirmed '+phase);break;}}
            assert.equal(await alive(),true,'Observer process stopped before checkpoint.');if(Date.now()>deadline)throw Error('Transition checkpoint timeout: '+phase);await sleep(1000);
        }
    }else{
        assert.equal(phase,undefined);if(await alive()){const state=await read('state.json').catch(()=>null);if(!['passed','failed'].includes(state?.status))process.kill(record.pid,'SIGTERM');const end=Date.now()+15000;while(await alive()&&Date.now()<end)await sleep(200);if(await alive())process.kill(record.pid,'SIGKILL');}console.log('Observer cleanup complete.');
    }
}
