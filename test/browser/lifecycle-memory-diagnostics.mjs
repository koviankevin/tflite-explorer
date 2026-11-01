import {createProcessMemoryProbe,summarizeMemoryProfile} from './process-memory-profile.mjs';

// Readonly supplementary observations, anchored to the original RSS samples.
// This helper never changes acceptance values, requests GC or reads model data.
export function createLifecycleMemoryDiagnostics({now,cdp,browserCDP,probe}={}){
    if(typeof now!=='function'||typeof cdp?.send!=='function'||typeof browserCDP?.send!=='function')throw Error('Missing readonly diagnostic clients/clock.');
    probe??=createProcessMemoryProbe({now});
    const profile={format:'model-lens-proc-memory',version:1,samples:[],details:[],releaseEvidenceEligible:false,forcedGC:false,scope:'Supplementary per-process native categories and readonly CDP heap/DOM observations. Original summed RSS samples and policy remain authoritative; no subtraction or inferred ownership.'};
    const slots=new Set();let lastPhase=null,lastElapsed=-Infinity,processRecords=0,detailReservations=0;
    const number=(value)=>Number.isFinite(value)&&value>=0?value:null;
    return {profile,async capture(index,identities,anchor,metrics){
        if(!Number.isInteger(index)||index<0||index>=4000||slots.has(index)||!Array.isArray(identities)||identities.length!==anchor?.processes||!Array.isArray(metrics))throw Error('Invalid or repeated anchored memory sample.');
        if(processRecords+identities.length>24000)throw Error('Native memory record budget exceeded.');
        slots.add(index);processRecords+=identities.length;
        // Indexed assignment preserves original sample order even if the normal
        // interval sampler overlaps an explicit settle/baseline observation.
        profile.samples[index]=await probe.capture(identities,anchor);
        if(anchor.phase!==lastPhase||anchor.elapsedMs-lastElapsed>=10000){
            if(detailReservations++>=512)throw Error('Readonly CDP detail budget exceeded.');
            lastPhase=anchor.phase;lastElapsed=anchor.elapsedMs;
            const observedStartMs=now();
            const [{processInfo},heap,dom]=await Promise.all([browserCDP.send('SystemInfo.getProcessInfo'),cdp.send('Runtime.getHeapUsage'),cdp.send('Memory.getDOMCounters')]);
            const observedEndMs=now(),types=new Map(processInfo.map(p=>[p.id,p.type]));
            if(observedStartMs<anchor.elapsedMs||observedEndMs<observedStartMs)throw Error('Unanchored readonly CDP observation.');
            const metric=name=>number(metrics.find(m=>m.name===name)?.value);
            profile.details.push({sampleIndex:index,phase:anchor.phase,elapsedMs:anchor.elapsedMs,gateRssBytes:anchor.rssBytes,observedStartMs,observedEndMs,
                processes:profile.samples[index].processes.map(({pid,startTicks,observation})=>({pid,startTicks,observation,type:observation==='present'&&/^[a-zA-Z0-9_-]{1,64}$/.test(types.get(pid)||'')?types.get(pid):'unknown'})),
                performanceHeap:{usedBytes:metric('JSHeapUsedSize'),totalBytes:metric('JSHeapTotalSize')},
                runtimeHeap:Object.fromEntries(['usedSize','totalSize','embedderHeapUsedSize','backingStorageSize'].map(k=>[k,number(heap[k])])),
                dom:Object.fromEntries(['documents','nodes','jsEventListeners'].map(k=>[k,number(dom[k])]))});
        }
    },finish(samples){
        if(slots.size!==samples.length)throw Error('Missing supplementary memory observations.');
        profile.summary=summarizeMemoryProfile(profile,samples);profile.details.sort((a,b)=>a.sampleIndex-b.sampleIndex);return profile;
    }};
}
