// No model/runtime APIs: compare ready/terminated empty Workers with Workers
// that read the same public WASM over HTTP or from a native File. RSS limits stay intact.
import assert from 'node:assert/strict';
import {randomBytes} from 'node:crypto';
import {gitSource} from '../../scripts/lib/release-artifact.mjs';
import {OwnedProcessTree,readProcessTable,findOwnedBrowserRoot,waitOwnedProcessExit} from './owned-processes.mjs';
import {createProcessMemoryProbe,summarizeMemoryProfile} from './process-memory-profile.mjs';
import {median,slope} from './lifecycle-policy.mjs';
import {readStaticFile} from '../../scripts/lib/live-site.mjs';
import {publicControlFile} from './public-control-file.mjs';

export function networkControlDocument(mode,assetURL,expectedBytes){
    assert.ok(['empty','fetch','file'].includes(mode));if(mode==='file')assert.ok(Number.isSafeInteger(expectedBytes)&&expectedBytes>0&&expectedBytes<=16*1024**2);const url=new URL(assetURL);assert.ok(['http:','https:'].includes(url.protocol));
    const code=mode==='file'?"onmessage=({data})=>data.arrayBuffer().then(b=>postMessage({bytes:b.byteLength}),error=>postMessage({error:String(error)}));":mode==='empty'?"postMessage({bytes:0});":`fetch(${JSON.stringify(url.href)}).then(r=>{if(!r.ok)throw Error('HTTP '+r.status);return r.arrayBuffer();}).then(b=>postMessage({bytes:b.byteLength}),error=>postMessage({error:String(error)}));`;
    return `<!doctype html>${mode==='file'?'<button id="choose">Choose public File</button><input id="asset" type="file" hidden><button id="clear">Clear File</button>':''}<button id="start">Start</button><button id="stop">Stop</button><pre id="result" data-phase="idle"></pre><script>
const out=document.getElementById('result'),rows=[];let active=null;
const publish=phase=>{out.textContent=JSON.stringify(rows);out.dataset.phase=phase;};
${mode==='file'?`const source=document.getElementById('asset');document.getElementById('choose').onclick=()=>source.click();document.getElementById('clear').onclick=()=>{if(active)throw Error('Worker still active');source.value='';};`:''}
document.getElementById('start').onclick=()=>{
 if(active||rows.length>=24)throw Error('Invalid control sequence');
 ${mode==='file'?`if(source.files.length!==1||source.files[0].size!==${expectedBytes})throw Error('Select verified public file first');`:''}
 const url=URL.createObjectURL(new Blob([${JSON.stringify(code)}],{type:'text/javascript'}));
 const row={id:rows.length+1,scriptURL:url,createdAt:Date.now(),readyAt:null,terminatedAt:null,revoked:false,bytes:null,error:null};rows.push(row);
 const worker=new Worker(url);active={worker,row};worker.onmessage=({data})=>{row.bytes=data.bytes??null;row.error=data.error??null;row.readyAt=Date.now();publish(row.error?'error':'ready');};worker.onerror=event=>{event.preventDefault();row.error=event.message;publish('error');};publish('starting');${mode==='file'?`worker.postMessage(source.files[0]);`:''}
};
document.getElementById('stop').onclick=()=>{if(!active)return;const {worker,row}=active;active=null;worker.onmessage=worker.onerror=null;worker.terminate();row.terminatedAt=Date.now();URL.revokeObjectURL(row.scriptURL);row.revoked=true;publish('terminated');};publish('idle');
</script>`;
}

export async function firefoxNetworkMemoryControl({browserType,base,assetURL,expectedBytes,expectedSHA256,mode}){
    assert.equal(process.platform,'linux');assert.equal(process.env.GITHUB_ACTIONS,'true');assert.ok(['empty','fetch','file'].includes(mode));assert.ok(assetURL.startsWith(base));assert.ok(expectedBytes>10*1024**2&&expectedBytes<16*1024**2);assert.match(expectedSHA256,/^[a-f0-9]{64}$/);
    const source=gitSource();assert.equal(source.dirty,false);const report={format:'model-lens-firefox-network-control',version:1,status:'failed',source,mode,asset:{url:assetURL,bytes:expectedBytes,sha256:expectedSHA256},cycles:[],samples:[],memoryProfile:{format:'model-lens-proc-memory',version:1,samples:[]},nativeWorkers:[],requests:[],errors:[],browserClosed:false,fileInputEmpty:mode==='file'?false:null,modelsLoaded:0,runtimeInvocations:0,forcedGC:false,startedAt:new Date().toISOString()};
    let assetFile,browser,context,page,tree,timer,pending=Promise.resolve(),sampling=false,clock,phase='setup';const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms)),probe=createProcessMemoryProbe({now:()=>Date.now()-clock});
    async function sample(label=phase){const table=await readProcessTable(),value=tree.sample(table),row={phase:label,elapsedMs:Date.now()-clock,...value},slot=report.samples.length;assert.ok(slot<512);report.samples.push(row);report.memoryProfile.samples[slot]=await probe.capture(tree.remaining(table),row);return slot;}
    async function settle(label){phase=label;const indices=[];for(let i=0;i<5;i++){assert.ok(Date.now()-clock<=120000);await wait(1000);indices.push(await sample(label));}return {indices,rssBytes:median(indices.map(i=>report.samples[i].rssBytes))};}
    async function closed(){const end=Date.now()+5000;while(report.nativeWorkers.some(w=>!w.closed)&&Date.now()<end)await wait(25);assert.ok(report.nativeWorkers.every(w=>w.closed));assert.equal(page.workers().length,0);}
    try{
        if(mode==='file'){const asset=await readStaticFile(base,assetURL.slice(base.length),{maxBytes:expectedBytes});assert.equal(asset.contentType?.split(';')[0].trim(),'application/wasm');assetFile=await publicControlFile(asset.bytes,{expectedBytes,expectedSHA256});report.controlAsset=assetFile.record;}
        const marker=randomBytes(16).toString('hex');browser=await browserType.launch({headless:true,env:{...process.env,MODEL_LENS_PHYSICAL_OWNER:marker}});report.browserVersion=browser.version();const root=await findOwnedBrowserRoot(await readProcessTable(),process.pid,marker);tree=new OwnedProcessTree(root);report.ownership={root,parentPid:process.pid,method:'direct Node child plus exact per-launch random environment marker'};
        context=await browser.newContext({viewport:{width:1280,height:640}});const documentURL=new URL(`__network_control_${mode}__.html`,base).href,html=networkControlDocument(mode,assetURL,expectedBytes);
        await context.route('**/*',async route=>{const request=route.request(),url=new URL(request.url());if(['blob:','data:'].includes(url.protocol)){await route.continue();return;}const allowed=request.method()==='GET'&&request.url().startsWith(base);report.requests.push({url:request.url(),method:request.method(),allowed});assert.ok(report.requests.length<100);if(!allowed){report.errors.push('Unexpected network request.');await route.abort();}else if(request.url()===documentURL)await route.fulfill({status:200,contentType:'text/html',body:html});else await route.continue();});
        page=await context.newPage();page.on('filechooser',()=>{});page.on('pageerror',e=>report.errors.push(e.message));page.on('crash',()=>report.errors.push('Page crash.'));page.on('worker',worker=>{const row={url:worker.url(),closed:false};report.nativeWorkers.push(row);worker.once('close',()=>{row.closed=true;});});await page.goto(documentURL,{waitUntil:'domcontentloaded'});await page.bringToFront();if(mode==='file'){const selected=page.waitForEvent('filechooser');await page.locator('#choose').click();await(await selected).setFiles(assetFile.path);assert.ok(await page.locator('#asset').inputValue());}
        clock=Date.now();report.measurementStartedAt=new Date(clock).toISOString();phase='baseline';await sample();timer=setInterval(()=>{if(sampling)return;sampling=true;pending=sample().catch(error=>report.errors.push('Sampler: '+error.message)).finally(()=>{sampling=false;});},500);
        for(let cycle=1;cycle<=8;cycle++){
            phase=`cycle-${cycle}-${mode==='file'?'file-read':'fetch'}`;
            for(let j=0;j<3;j++){await page.locator('#start').click();await page.locator('#result[data-phase="ready"], #result[data-phase="error"]').waitFor({timeout:30000});const rows=JSON.parse(await page.locator('#result').textContent());assert.equal(rows.length,(cycle-1)*3+j+1);assert.equal(rows.at(-1).error,null,JSON.stringify(rows.at(-1)));assert.equal(rows.at(-1).bytes,mode==='empty'?0:expectedBytes);await page.locator('#stop').click();await closed();assert.equal(report.nativeWorkers.length,rows.length);}
            report.cycles.push({cycle,settled:await settle(`cycle-${cycle}-settle`)});
        }
        clearInterval(timer);await pending;if(mode==='file'){await page.locator('#clear').click();report.fileInputEmpty=(await page.locator('#asset').inputValue())==='';assert.equal(report.fileInputEmpty,true);}
        report.elapsedMs=Date.now()-clock;assert.ok(report.elapsedMs<=120000);report.rows=JSON.parse(await page.locator('#result').textContent());assert.equal(report.rows.length,24);assert.ok(report.rows.every(r=>r.readyAt!==null&&r.terminatedAt>=r.readyAt&&r.revoked&&!r.error));assert.equal(report.requests.filter(q=>q.url===assetURL).length,mode==='fetch'?24:0);assert.equal(report.nativeWorkers.length,24);await closed();assert.deepEqual(report.errors,[]);report.memoryProfile.summary=summarizeMemoryProfile(report.memoryProfile,report.samples);const measured=report.cycles.slice(2);report.summary={measuredCycles:6,closedRssSlopeBytesPerCycle:slope(measured.map(c=>c.settled.rssBytes)),rssDriftBytes:report.cycles.at(-1).settled.rssBytes-report.cycles[1].settled.rssBytes,sampledPeakRssBytes:Math.max(...report.samples.map(s=>s.rssBytes)),scope:'Diagnostic-only, no model/runtime/IO and no RSS acceptance pass/fail. Tiny Worker-script URLs revoked after native termination; production IO timers untouched.'};
    }catch(error){if(error.controlAsset)report.controlAsset=error.controlAsset;report.error=error.stack||String(error);throw Object.assign(error,{firefoxNetworkControl:report});}
    finally{clearInterval(timer);await pending;try{await context?.close();await browser?.close();report.browserClosed=Boolean(browser);if(tree){report.processCleanup=await waitOwnedProcessExit(tree);assert.equal(report.processCleanup.allReaped,true);}}catch(error){report.errors.push('Shutdown: '+error.message);}try{await assetFile?.cleanup();}catch(error){report.errors.push('Public control File cleanup: '+error.message);}const end=gitSource();report.sourceUnchanged=end.commit===source.commit&&end.tree===source.tree&&!end.dirty;report.finishedAt=new Date().toISOString();}
    if(!report.sourceUnchanged||report.errors.length)throw Object.assign(Error('Network control cleanup/source invalid.'),{firefoxNetworkControl:report});report.status='passed';return report;
}
