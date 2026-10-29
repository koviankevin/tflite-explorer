// Standalone, data-free native control. No app APIs, model data, constructor
// wrapper, GC trigger or inferred close state. Only buttons create/terminate.
export function workerStartupDocument(){
    return `<!doctype html><button id="start">Start</button><button id="stop">Stop</button><select id="kind"><option>classic</option><option>module</option></select><select id="timing"><option>immediate</option><option>ready</option></select><pre id="result" data-state="idle"></pre><script>
const result=document.getElementById('result'),rows=[];let active=null;
const publish=state=>{result.textContent=JSON.stringify(rows);result.dataset.state=state;};
function stop(){const task=active;if(!task)return;active=null;task.row.terminateStartedAt=Date.now();task.worker.terminate();task.row.terminateReturnedAt=Date.now();URL.revokeObjectURL(task.row.url);task.row.revoked=true;publish('terminated');}
document.getElementById('start').onclick=()=>{
 if(active)throw Error('Previous control still active');
 const kind=document.getElementById('kind').value,timing=document.getElementById('timing').value;
 const url=URL.createObjectURL(new Blob(["postMessage('ready');onmessage=()=>postMessage('echo');"],{type:'text/javascript'}));
 const row={id:rows.length+1,kind,timing,url,createdAt:Date.now(),readyAt:null,terminateStartedAt:null,terminateReturnedAt:null,revoked:false,error:false};rows.push(row);
 const worker=new Worker(url,{type:kind});active={worker,row};
 worker.onmessage=event=>{if(event.data==='ready'){row.readyAt=Date.now();publish('ready');}};
 worker.onerror=event=>{event.preventDefault();row.error=true;publish('error');};
 if(timing==='immediate')stop();else publish('starting');
};
document.getElementById('stop').onclick=stop;publish('idle');
</script>`;
}

export async function workerStartupControl(context,{repetitions=8}={}){
    const page=await context.newPage(),handles=new Map(),report={version:1,scope:'Standalone native classic/module Workers; immediate vs ready cancellation. Diagnostic only; unknown close stays unknown.',repetitions,rows:[],native:[],probes:[],errors:[],pageClosed:false};
    const created=worker=>{const row={url:worker.url(),createdAt:Date.now(),closed:false,closedAt:null};report.native.push(row);handles.set(worker,row);worker.once('close',()=>{row.closed=true;row.closedAt=Date.now();handles.delete(worker);});};
    page.on('worker',created);page.on('pageerror',error=>report.errors.push(String(error.message).slice(0,256)));
    try{
        await page.setContent(workerStartupDocument());
        for(const kind of ['classic','module'])for(const timing of ['immediate','ready']){
            await page.locator('#kind').selectOption(kind);await page.locator('#timing').selectOption(timing);
            for(let i=0;i<repetitions;i++){
                await page.locator('#start').click();
                if(timing==='ready'){await page.locator('#result[data-state="ready"]').waitFor({timeout:5000});await page.locator('#stop').click();}
                await page.locator('#result[data-state="terminated"]').waitFor({timeout:5000});
            }
        }
        report.rows=JSON.parse(await page.locator('#result').textContent());
        const end=Date.now()+2000;while(handles.size&&Date.now()<end)await new Promise(resolve=>setTimeout(resolve,25));
        const present=new Set(page.workers());report.beforePageClose={at:Date.now(),pending:[...handles].map(([worker,row])=>({url:row.url,present:present.has(worker)}))};
        for(const [worker,row]of [...handles].slice(0,4)){
            const startedAt=Date.now();let timer;
            try{const native=worker.evaluate(()=>1).then(value=>({status:'returned',value}),error=>({status:'rejected',error:String(error.message).slice(0,256)}));const outcome=await Promise.race([native,new Promise(resolve=>{timer=setTimeout(()=>resolve({status:'timeout'}),750);})]);report.probes.push({url:row.url,startedAt,elapsedMs:Date.now()-startedAt,...outcome});}finally{clearTimeout(timer);}
        }
    }catch(error){report.error=String(error.stack||error);throw Object.assign(error,{workerStartupControl:report});}
    finally{await page.close();report.pageClosed=page.isClosed();report.afterPageClose={at:Date.now(),pending:[...handles.values()].map(row=>row.url)};page.off('worker',created);handles.clear();}
    return report;
}
