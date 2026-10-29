// Diagnostic-only browser observer. Never retain a File, Blob, message payload
// or model value; delegate to the original constructor and terminate method.
export function installIdentityWorkerAudit(){
    const Native=globalThis.Worker,rows=[],prefix='[lens-identity-worker-v1]',documentId=String(performance.timeOrigin);let serial=0,overflow=false;
    const publish=()=>{try{document.documentElement?.setAttribute('data-lens-identity-workers',JSON.stringify({version:1,documentId,overflow,rows}));}catch{}};
    const emit=(type,row)=>{publish();try{console.debug(prefix+JSON.stringify({type,at:Date.now(),documentId,...(row?{row:{...row}}:{})}));}catch{}};
    globalThis.Worker=new Proxy(Native,{construct(target,args,newTarget){
        const worker=Reflect.construct(target,args,newTarget);let url;try{url=new URL(String(args[0]),document.baseURI||location.href);}catch{return worker;}
        if(!url.pathname.endsWith('/edit-recovery-worker.js'))return worker;
        if(rows.length>=512){overflow=true;publish();return worker;}
        const row={id:++serial,script:'edit-recovery-worker.js',build:url.searchParams.get('v'),createdAt:Date.now(),messages:0,fingerprintReply:false,errorReply:false,errorEvents:0,terminateCalls:0,terminateStartedAt:null,terminateReturnedAt:null,terminateThrew:false};rows.push(row);
        const message=event=>{row.messages++;if(typeof event.data?.fingerprint==='string'){row.fingerprintReply=true;emit('fingerprint-reply',row);}else if(event.data?.error){row.errorReply=true;emit('error-reply',row);}else publish();},error=()=>{row.errorEvents++;emit('error-event',row);};
        worker.addEventListener('message',message);worker.addEventListener('error',error);const terminate=worker.terminate;
        Object.defineProperty(worker,'terminate',{configurable:true,writable:true,value:function(...parameters){
            row.terminateCalls++;row.terminateStartedAt=Date.now();this.removeEventListener('message',message);this.removeEventListener('error',error);
            try{const result=Reflect.apply(terminate,this,parameters);row.terminateReturnedAt=Date.now();emit('terminate-returned',row);return result;}
            catch(reason){row.terminateThrew=true;emit('terminate-threw',row);throw reason;}
        }});
        emit('created',row);return worker;
    }});
    document.addEventListener('DOMContentLoaded',publish,{once:true});emit('installed');
}

export function identityWorkerDiagnostics({page,read,getPhase=()=>''}){
    const report={version:1,scope:'Diagnostic metadata only; instrumentation can perturb timing. A missing close event is never relabelled closed.',consoleEvents:[],snapshots:[],probes:[],navigations:[],overflow:false},handles=new Map(),prefix='[lens-identity-worker-v1]';let disposed=false;
    const consoleEvent=message=>{const text=message.text();if(!text.startsWith(prefix))return;if(report.consoleEvents.length>=4096){report.overflow=true;return;}try{const value=JSON.parse(text.slice(prefix.length));report.consoleEvents.push({phase:getPhase(),observedAt:Date.now(),...value});}catch{report.consoleParseError=true;}};
    const navigation=frame=>{if(frame!==page.mainFrame()||report.navigations.length>=256)return;let url;try{url=new URL(frame.url());}catch{return;}report.navigations.push({phase:getPhase(),at:Date.now(),protocol:url.protocol,path:url.pathname});};
    page.on('console',consoleEvent);page.on('framenavigated',navigation);
    return {report,track(worker,row,index){
        row.creationEventAt=Date.now();row.creationPhase=getPhase();row.observationIndex=index;handles.set(worker,row);
        worker.once('close',()=>{row.closeEventAt=Date.now();row.closeEventPhase=getPhase();handles.delete(worker);});
    },async snapshot(label,{probe=false}={}){
        if(disposed)return;const at=Date.now(),present=new Set(page.workers()),pending=[...handles].map(([worker,row])=>({index:row.observationIndex,url:row.url,creationEventAt:row.creationEventAt,creationPhase:row.creationPhase,presentInNativeWorkerList:present.has(worker)}));
        const snapshot={label,at,phase:getPhase(),pending,identityDOM:null};try{const text=page.isClosed()?null:await read(()=>document.documentElement?.getAttribute('data-lens-identity-workers'));if(text)snapshot.identityDOM=JSON.parse(text);}catch(error){snapshot.domObservationError=String(error.message).slice(0,256);}report.snapshots.push(snapshot);
        if(probe){for(const [worker,row]of [...handles].filter(([_,r])=>r.url.includes('/edit-recovery-worker.js?')&&at-r.creationEventAt>=5000).slice(0,4)){
            const before={pageOpen:!page.isClosed(),browserConnected:page.context().browser().isConnected()},started=Date.now();let timer;
            // No app API or model state: only ask whether this native execution
            // context can return a constant. Never terminate/close it to pass.
            const observation=worker.evaluate(()=>1).then(value=>({status:'returned',value}),error=>({status:'rejected',error:String(error.message).slice(0,512)}));
            try{const result=await Promise.race([observation,new Promise(resolve=>{timer=setTimeout(()=>resolve({status:'timeout'}),1500);})]);report.probes.push({index:row.observationIndex,label,phase:getPhase(),startedAt:started,elapsedMs:Date.now()-started,before,after:{pageOpen:!page.isClosed(),browserConnected:page.context().browser().isConnected()},...result});}finally{clearTimeout(timer);}
        }}return snapshot;
    },dispose(){disposed=true;page.off('console',consoleEvent);page.off('framenavigated',navigation);handles.clear();}};
}
