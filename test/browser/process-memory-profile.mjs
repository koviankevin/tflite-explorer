import {readFile} from 'node:fs/promises';
import {parseProcProcess} from './owned-processes.mjs';

// Supplementary Linux /proc/status observations. Never substitute these values
// for the original owned-process RSS acceptance sample, or infer a JS heap.
export function parseProcessMemory(status){
    const bytes=field=>{
        const lines=status.split('\n').filter(line=>line.startsWith(field+':'));
        if(!lines.length)return null;
        const match=lines.length===1&&new RegExp('^'+field+':\\s+(\\d+)\\s+kB\\s*$').exec(lines[0]),value=match?Number(match[1])*1024:NaN;
        if(!Number.isSafeInteger(value)||value<0)throw Error('Malformed process memory field '+field+'.');return value;
    };
    const name=status.match(/^Name:\s*([^\r\n]*)/m)?.[1]?.trim();
    return {name:name&&/^[a-zA-Z0-9_.() -]{1,64}$/.test(name)?name:null,rssBytes:bytes('VmRSS'),anonymousBytes:bytes('RssAnon'),fileBytes:bytes('RssFile'),sharedBytes:bytes('RssShmem')};
}
const validIdentity=p=>p&&Number.isSafeInteger(p.pid)&&p.pid>1&&p.pid!==process.pid&&typeof p.startTicks==='string'&&/^\d+$/.test(p.startTicks);
const memoryFields=['rssBytes','anonymousBytes','fileBytes','sharedBytes'];
export function createProcessMemoryProbe({readText,now=()=>performance.now()}={}){
    if(!readText){if(process.platform!=='linux')throw Error('Process memory profiling is restricted to isolated Linux CI.');readText=file=>readFile(file,'utf8');}
    let captures=0;
    return {async capture(identities,anchor){
        if(!Array.isArray(identities)||!identities.length||identities.length>128||!identities.every(validIdentity)||new Set(identities.map(p=>p.pid)).size!==identities.length)throw Error('Missing bounded owned-process identities.');
        if(!anchor||!Number.isFinite(anchor.elapsedMs)||anchor.elapsedMs<0||!Number.isFinite(anchor.rssBytes)||anchor.rssBytes<=0||typeof anchor.phase!=='string'||!/^[a-z0-9-]{1,80}$/.test(anchor.phase))throw Error('Missing original RSS sample anchor.');
        if(++captures>4000)throw Error('Process memory observation budget exceeded.');
        const observedStartMs=now();
        const processes=await Promise.all(identities.map(async identity=>{
            const {pid,startTicks}=identity,base={pid,startTicks};
            try{
                const before=await readText(`/proc/${pid}/stat`);if(!before)return {...base,observation:'exited'};
                if(parseProcProcess(pid,'',before).startTicks!==startTicks)return {...base,observation:'reused'};
                const status=await readText(`/proc/${pid}/status`),after=await readText(`/proc/${pid}/stat`);
                if(!status||!after)return {...base,observation:'exited'};
                const current=parseProcProcess(pid,status,after);
                if(current.startTicks!==startTicks)return {...base,observation:'reused'};
                return {...base,observation:'present',parent:current.parent,state:current.state,...parseProcessMemory(status)};
            }catch(error){if(['ENOENT','ESRCH'].includes(error.code))return {...base,observation:'exited'};throw error;}
        }));
        const observedEndMs=now();if(!Number.isFinite(observedStartMs)||!Number.isFinite(observedEndMs)||observedStartMs<anchor.elapsedMs||observedEndMs<observedStartMs)throw Error('Invalid memory observation clock.');
        const totals=Object.fromEntries(memoryFields.map(field=>[field,processes.every(p=>p.observation==='present'&&p[field]!==null)?processes.reduce((n,p)=>n+p[field],0):null]));
        return {elapsedMs:anchor.elapsedMs,phase:anchor.phase,gateRssBytes:anchor.rssBytes,observedStartMs,observedEndMs,processes,totals,differenceFromGateRSSBytes:totals.rssBytes===null?null:totals.rssBytes-anchor.rssBytes};
    }};
}

export function summarizeMemoryProfile(profile,samples){
    if(profile?.format!=='model-lens-proc-memory'||profile.version!==1||!Array.isArray(profile.samples)||!Array.isArray(samples)||!samples.length||profile.samples.length!==samples.length)throw Error('Missing anchored process memory observations.');
    let complete=0,missing=0,reused=0;const phases=new Map();
    for(let i=0;i<samples.length;i++){
        const s=samples[i],m=profile.samples[i];
        if(!m||m.elapsedMs!==s.elapsedMs||m.phase!==s.phase||m.gateRssBytes!==s.rssBytes||!Number.isFinite(m.observedStartMs)||m.observedStartMs<m.elapsedMs||!Number.isFinite(m.observedEndMs)||m.observedEndMs<m.observedStartMs||!Array.isArray(m.processes)||!m.processes.length||m.processes.length!==s.processes||!m.processes.every(validIdentity)||new Set(m.processes.map(p=>p.pid)).size!==m.processes.length||m.processes.some(p=>!['present','exited','reused'].includes(p.observation)))throw Error('Process memory observation lost its original RSS anchor.');
        const totals={};for(const field of memoryFields){const values=m.processes.map(p=>p.observation==='present'?p[field]:null);if(!values.every(v=>v===null||Number.isSafeInteger(v)&&v>=0))throw Error('Invalid supplementary memory value.');totals[field]=values.includes(null)?null:values.reduce((n,v)=>n+v,0);if(totals[field]!==m.totals[field])throw Error('Process memory totals do not match observations.');}
        if(m.differenceFromGateRSSBytes!==(totals.rssBytes===null?null:totals.rssBytes-m.gateRssBytes))throw Error('Process memory drift was hidden.');
        if(Object.values(totals).every(v=>v!==null))complete++;missing+=m.processes.filter(p=>p.observation==='exited').length;reused+=m.processes.filter(p=>p.observation==='reused').length;
        const phase=m.phase.replace(/^cycle-\d+-/,''),old=phases.get(phase);if(!old||m.gateRssBytes>old.gateRssBytes)phases.set(phase,m);
    }
    return {observations:samples.length,completeObservations:complete,exitedObservations:missing,reusedPidObservations:reused,phasePeaks:[...phases].map(([phase,m])=>({...m,phase,sourcePhase:m.phase}))};
}
