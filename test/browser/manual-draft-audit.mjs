// CI-only instrumentation for the existing full-file draft identity algorithm.
// Its facade is injected only at editFileFingerprint's argument boundary. Parser
// FileReader/Blob APIs keep the separate, unchanged 16 MiB realm read guard.
export function installManualDraftReadAudit(expectedBytes){
    const native=Blob.prototype.arrayBuffer,send=self.postMessage.bind(self);let serial=0;
    self.__auditManualDraftFile=file=>{
        const audit={pass:++serial,sourceBytes:file.size,bytes:0,calls:0,maxRead:0,nextOffset:0,coverageComplete:false,violations:[]};
        const emit=()=>send({__manualDraftAudit:audit});
        const fail=reason=>{audit.violations.push(reason);emit();throw Error(reason);};
        if(!(file instanceof File)||file.size!==expectedBytes)fail('Unexpected manual draft identity source');
        emit();const started=performance.now();
        return {size:file.size,slice(start,end){
            if(!Number.isSafeInteger(start)||!Number.isSafeInteger(end)||start!==audit.nextOffset||end<=start||end>file.size||end-start>1024**2)fail('Manual draft identity read exceeds ordered bounded coverage');
            let used=false;
            return {async arrayBuffer(){
                if(used)fail('Repeated manual draft identity read');used=true;
                const buffer=await native.call(file.slice(start,end));
                if(buffer.byteLength!==end-start)fail('Short manual draft identity read');
                audit.bytes+=buffer.byteLength;audit.calls++;audit.maxRead=Math.max(audit.maxRead,buffer.byteLength);audit.nextOffset=end;
                audit.coverageComplete=end===file.size;audit.elapsedMs=performance.now()-started;
                emit();
                return buffer;
            }};
        }};
    };
}

// Only numeric/string observation data are retained. No File, Blob, message,
// Worker, DOM node or remote object is stored in the report.
export function installManualDraftPageAudit(){
    const state=globalThis.__manualDraft={workers:[],phase:null,phases:[]},NativeWorker=Worker;
    globalThis.Worker=class extends NativeWorker{
        constructor(...args){
            super(...args);const entry={url:String(args[0]),passes:[]};state.workers.push(entry);
            this.addEventListener('message',({data})=>{
                if(data.__manualDraftAudit){const a=data.__manualDraftAudit,i=entry.passes.findIndex(p=>p.pass===a.pass);if(i<0)entry.passes.push(a);else entry.passes[i]=a;}
                if(data.editDraft&&data.stage)entry.progress=String(data.stage);
            });
            this.addEventListener('error',event=>{entry.error=event.message;});
        }
    };
    // Native close is also recorded by Node's Worker event; terminate() calls
    // are retained in the independent lifecycle audit rather than inferred here.
    let previous=performance.now();
    setInterval(()=>{const now=performance.now(),p=state.phase;if(p){p.ticks++;p.maxGapMs=Math.max(p.maxGapMs,now-previous);p.lastAt=now;}previous=now;},50);
    if(typeof PerformanceObserver==='function')new PerformanceObserver(list=>{const p=state.phase;if(p)for(const e of list.getEntries()){p.longTasks++;p.maxLongTaskMs=Math.max(p.maxLongTaskMs,e.duration);}}).observe({type:'longtask',buffered:false});
}
