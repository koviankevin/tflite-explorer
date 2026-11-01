// Read-only V8 logging for the opt-in experiment, never an application setting.
import path from 'node:path';
export const POOL_LOG_LIMIT=4*1024**2;
export const POOL_TRACE_FLAG='--js-flags=--trace-gc-nvp';
const need=(condition,code)=>{if(!condition)throw Error(code);};
const numeric=value=>Number.isSafeInteger(value)&&value>=0&&value<=2**50;

export function poolTraceSettings(reportPath,environment){
    need(path.isAbsolute(reportPath)&&environment.DEBUG==='pw:browser'&&environment.DEBUG_FILE===reportPath+'.browser-private.log','pool-log-environment');
    return {privateLogPath:environment.DEBUG_FILE,args:[POOL_TRACE_FLAG]};
}

// Playwright's pinned DEBUG_FILE sink contains PID/address-bearing lines. They
// stay private; only numeric events belonging to the guarded renderer survive.
export function decodeRendererPoolLog(text,{rootPid,rendererPid,rendererLabel,startedAtMs,throughAtMs}){
    need(typeof text==='string'&&Buffer.byteLength(text)<=POOL_LOG_LIMIT,'pool-log-budget');
    need([rootPid,rendererPid,rendererLabel,startedAtMs,throughAtMs].every(numeric)&&rootPid>1&&rendererPid>1&&throughAtMs>=startedAtMs,'pool-log-scope');
    const events=[];let foreignPoolLines=0,scopedPoolLines=0;
    for(const line of text.split('\n')){
        need(Buffer.byteLength(line)<=32768,'pool-log-line-budget');
        if(!line.includes('Memory pool: Removed pages:'))continue;
        const prefix=line.match(/^(\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z)\s+pw:browser\s+\[pid=(\d+)\]\[(?:out|err)\]\s+(.*)$/);
        need(prefix,'pool-log-format');
        const wallTime=Date.parse(prefix[1]);need(numeric(wallTime),'pool-log-clock');
        if(Number(prefix[2])!==rootPid||wallTime<startedAtMs||wallTime>throughAtMs){foreignPoolLines++;continue;}
        const row=prefix[3].match(/^\[(\d+):0x[a-fA-F0-9]+\]\s+(\d+(?:\.\d+)?)\s*ms:\s+Memory pool: Removed pages: (\d+), removed large pages: (\d+)\s*$/);
        need(row,'pool-log-format');
        if(Number(row[1])!==rendererPid){foreignPoolLines++;continue;}
        const normalPageBytes=Number(row[3]),largePageBytes=Number(row[4]),v8ElapsedUs=Math.round(Number(row[2])*1000);
        need([normalPageBytes,largePageBytes,v8ElapsedUs].every(numeric),'pool-log-number');
        need(events.length<128,'pool-log-event-budget');scopedPoolLines++;
        events.push({label:rendererLabel,elapsedMs:wallTime-startedAtMs,v8ElapsedUs,normalPageBytes,largePageBytes});
    }
    return {events,privateLogBytes:Buffer.byteLength(text),scopedPoolLines,foreignPoolLines};
}

export function correlateRendererPoolSteps(samples,summary,events){
    need(Array.isArray(samples)&&Array.isArray(summary?.changes)&&Array.isArray(events),'pool-log-correlation');
    return summary.changes.map(change=>{
        const before=samples[change.from],after=samples[change.to];
        need(before&&after&&after.elapsedMs>=before.elapsedMs,'pool-log-correlation');
        const matches=events.map((event,index)=>({event,index})).filter(({event})=>event.label===summary.rendererLabel&&event.elapsedMs>=before.elapsedMs-1500&&event.elapsedMs<=after.elapsedMs+1500);
        const normalPageBytes=matches.reduce((n,{event})=>n+event.normalPageBytes,0),largePageBytes=matches.reduce((n,{event})=>n+event.largePageBytes,0);
        need(numeric(normalPageBytes)&&numeric(largePageBytes),'pool-log-number');
        return {from:change.from,to:change.to,poolEventIndexes:matches.map(({index})=>index),normalPageBytes,largePageBytes,poolReleaseCoincidesWithStep:normalPageBytes>=100*1024**2};
    });
}
