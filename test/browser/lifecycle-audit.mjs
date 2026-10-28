// Serialized into the page and actual module Worker. Keep only numeric metadata;
// retaining an observed File, Blob, message or Worker would invalidate the test.
export function installLifecycleAudit(worker=false) {
    const audit={bytes:0,calls:0,maxRead:0,violations:[]};
    function record(blob,method){
        audit.bytes+=blob.size;audit.calls++;audit.maxRead=Math.max(audit.maxRead,blob.size);
        if(blob.size>1024**2 || audit.bytes>16*1024**2){audit.violations.push(method);if(worker)self.postMessage({__lifecycleAudit:audit});throw Error('Lifecycle bounded-read guard exceeded.');}
        if(worker)self.postMessage({__lifecycleAudit:audit});
    }
    for(const name of ['arrayBuffer','text','stream','bytes']){
        const native=Blob.prototype[name];if(native)Blob.prototype[name]=function(...args){record(this,`Blob.${name}`);return native.apply(this,args);};
    }
    for(const type of ['FileReader','FileReaderSync']){
        if(!globalThis[type])continue;
        for(const name of ['readAsArrayBuffer','readAsText','readAsDataURL','readAsBinaryString']){
            const native=globalThis[type].prototype[name];if(native)globalThis[type].prototype[name]=function(blob,...args){record(blob,`${type}.${name}`);return native.call(this,blob,...args);};
        }
    }
    if(worker)return;
    const state=globalThis.__lifecycle={audit,workers:[],urls:[]},NativeWorker=Worker;
    globalThis.Worker=class extends NativeWorker {
        constructor(...args){
            super(...args);const entry={url:String(args[0]),terminated:false};state.workers.push(entry);this.__auditEntry=entry;
            this.addEventListener('message',({data})=>{
                if(data.__lifecycleAudit)entry.audit=data.__lifecycleAudit;
                if(data.__recoveryAudit)entry.recoveryAudit=data.__recoveryAudit;
                if(data.data?.stats)entry.stats={bytesRead:data.data.stats.bytesRead,fileBytes:data.data.stats.fileBytes};
                if(data.data?.roundTripStats){const s=data.data.roundTripStats;entry.verificationPasses=(entry.verificationPasses||0)+1;entry.verificationReadBytes=(entry.verificationReadBytes||0)+s.bytesRead;entry.verificationFileBytes=s.fileBytes;}
            });
            this.addEventListener('error',event=>{entry.error=event.message;});
        }
        terminate(){this.__auditEntry.terminated=true;return super.terminate();}
    };
    const create=URL.createObjectURL,revoke=URL.revokeObjectURL;
    URL.createObjectURL=function(blob){const url=create.call(this,blob);state.urls.push({url,bytes:blob.size,revoked:false});return url;};
    URL.revokeObjectURL=function(url){for(const item of state.urls)if(item.url===url)item.revoked=true;return revoke.call(this,url);};
}

// A separate full-file identity pass is intentional for crash recovery. Keep
// the parser/main realm's existing 16 MiB total guard untouched. Only this
// dedicated worker may read exactly one known fixture, in <=1 MiB calls.
export function installRecoveryReadAudit(expectedBytes){
    const audit={bytes:0,calls:0,maxRead:0,violations:[],complete:false};let started=false;
    const send=self.postMessage.bind(self),fail=message=>{audit.violations.push(message);send({__recoveryAudit:audit});throw Error(message);};
    self.addEventListener('message',event=>{if(event.data?.file){if(started||!(event.data.file instanceof File)||event.data.file.size!==expectedBytes)fail('Unexpected recovery source');started=true;}});
    const record=blob=>{audit.bytes+=blob.size;audit.calls++;audit.maxRead=Math.max(audit.maxRead,blob.size);if(!started||blob.size>1024**2||audit.bytes>expectedBytes)fail('Recovery bounded-read guard exceeded');send({__recoveryAudit:audit});};
    for(const name of ['arrayBuffer','text','stream','bytes']){const native=Blob.prototype[name];if(native)Blob.prototype[name]=function(...args){record(this);return native.apply(this,args);};}
    for(const type of ['FileReader','FileReaderSync'])if(globalThis[type])for(const name of ['readAsArrayBuffer','readAsText','readAsDataURL','readAsBinaryString']){const native=globalThis[type].prototype[name];if(native)globalThis[type].prototype[name]=function(blob,...args){record(blob);return native.call(this,blob,...args);};}
    self.postMessage=(data,...args)=>{if(data.fingerprint){if(audit.bytes!==expectedBytes||data.bytes!==expectedBytes||!Number.isFinite(data.elapsedMs)||data.elapsedMs<=0)fail('Incomplete recovery fingerprint');audit.complete=true;audit.fingerprint=data.fingerprint;audit.elapsedMs=data.elapsedMs;send({__recoveryAudit:audit});}return send(data,...args);};
}
