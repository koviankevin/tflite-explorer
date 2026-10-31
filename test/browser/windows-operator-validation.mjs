// Explicit isolated Windows QA; no personal browser profiles or private files.
import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {once} from 'node:events';
import {chromium,selectors} from 'playwright';
import {createStaticServer} from '../../scripts/serve.mjs';
import {verifyArtifact,gitSource} from '../../scripts/lib/release-artifact.mjs';
import {trustedDocument} from './trusted-document.mjs';
import {registerDOMReader,desktopDOMReader} from './desktop-dom-reader.mjs';
import {windowsProcessObserver} from './windows-process-memory.mjs';
import {operatorValidationFlow} from './operator-validation-flow.mjs';
assert.equal(process.platform,'win32');assert.ok(process.argv.includes('--allow-local-browser'));
const [channel,build,output]=process.argv.slice(2).filter(a=>!a.startsWith('--'));assert.ok(['chrome','msedge'].includes(channel)&&build&&output);
const source=gitSource();assert.equal(source.dirty,false);
const manifest=await verifyArtifact(build,{publicOnly:true,requireClean:true,expectedCommit:source.commit}),directory=path.resolve(output);await mkdir(directory);
const server=createStaticServer(path.resolve(build));server.listen(0,'127.0.0.1');await once(server,'listening');const base=`http://127.0.0.1:${server.address().port}/`;
const report={format:'model-lens-windows-operator-validation',status:'failed',channel,source,release:manifest.release,startedAt:new Date().toISOString(),checks:[],errors:[],workers:[],scope:'Public synthetic UI on authenticated original HTML fixture; not HTTP document transport, physical RSS or a fix for historical native-close failures.'};
let browser,context,page,observer,closing=false;
await registerDOMReader(selectors);
try{
    browser=await chromium.launch({channel,headless:true,args:channel==='chrome'?['--disable-updater-scheduler']:[]});report.browserVersion=browser.version();
    const cdp=await browser.newBrowserCDPSession();observer=await windowsProcessObserver({python:process.env.MODEL_LENS_QA_PYTHON,cdp,channel});report.root=observer.root;
    context=await browser.newContext({acceptDownloads:true,viewport:{width:1280,height:640}});const doc=await trustedDocument(build,manifest);report.documentFixture=doc.proof;
    await context.route('**/*',async route=>{const r=route.request();if(new URL(r.url()).origin!==new URL(base).origin||r.method()!=='GET'){report.errors.push('Unexpected application network request');return route.abort();}if(!await doc.handle(route,base))return route.continue();});
    page=await context.newPage();page.on('pageerror',e=>report.errors.push(e.message));page.on('worker',w=>{const row={url:w.url(),closed:false};report.workers.push(row);w.once('close',()=>{row.closed=true;});});
    report.flow=await operatorValidationFlow({page,read:desktopDOMReader(page),base,directory,check:name=>report.checks.push(name)});report.functionalStatus='passed';
    await context.close();context=null;closing=true;let timer;
    try{await Promise.race([browser.close(),new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('normal browser.close exceeded10s')),10000);})]);}finally{clearTimeout(timer);}
    report.browserClosed=true;const remaining=await observer.remaining();report.processCleanup={allReaped:remaining.rows.length===0,remaining:remaining.rows,identities:remaining.identities};
    assert.ok(report.processCleanup.allReaped);assert.ok(report.workers.length&&report.workers.every(w=>w.closed));assert.deepEqual(report.errors,[]);assert.deepEqual(gitSource(),source);report.status='passed';
}catch(error){report.error=error.stack||String(error);if(error.operatorValidation)report.flow=error.operatorValidation;if(page&&!page.isClosed()){report.failureDOM=await desktopDOMReader(page)(()=>({mode:document.body.className,notice:document.querySelector('#notice')?.textContent,edit:document.querySelector('#edit-message')?.textContent,dialogs:Array.from(document.querySelectorAll('dialog[open]'),e=>e.id)})).catch(e=>({error:e.message}));await page.screenshot({path:path.join(directory,'failure.png')}).catch(()=>{});}process.exitCode=1;await writeFile(path.join(directory,'failure-checkpoint.json'),JSON.stringify(report,null,2)+'\n',{flag:'wx'});}
finally{
    if(!closing&&browser){await context?.close();await browser.close();}
    if(observer)report.observerClose=await observer.close();server.closeAllConnections();await new Promise(r=>server.close(r));report.finishedAt=new Date().toISOString();await writeFile(path.join(directory,'report.json'),JSON.stringify(report,null,2)+'\n',{flag:'wx'});
    console.log(JSON.stringify({status:report.status,functionalStatus:report.functionalStatus,channel,error:report.error}));
}
