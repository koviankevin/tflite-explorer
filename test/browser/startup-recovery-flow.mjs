// Fault injection only on an isolated Hosted Chromium context. All successful
// requests use the unchanged deployed files; no application API or DOM writes.
import assert from 'node:assert/strict';
import {chromiumRuntimeDOMReader} from './runtime-module-cold-flow.mjs';
import {sha256} from '../../scripts/lib/release-artifact.mjs';

export async function startupRecoveryFlow({browser,base,coreBasePath,buildId}){
    assert.equal(process.env.GITHUB_ACTIONS,'true');assert.equal(process.platform,'linux');
    const report={format:'model-lens-startup-recovery',version:1,status:'failed',earlyOpenRequired:true,guideReadinessRequired:true,cases:[],errors:[],workers:[],requests:[],downloads:0};
    const appURL=new URL(coreBasePath+'src/app.js?v='+buildId,base).href,zipURL=new URL(coreBasePath+'vendor/netron/zip.js?v='+buildId,base).href;
    for(const mode of ['entry-failure','dependency-failure','pending-recovery','early-open','guide-ready']){
        let context,page,read,release,observed;const held=new Promise(resolve=>{release=resolve;}),seen=new Promise(resolve=>{observed=resolve;});
        const rows=[],requests=[],errors=[],delayed=['pending-recovery','early-open','guide-ready'].includes(mode);let inject=true,contextsClosed=false,bounds,earlyClick,earlyChooser,earlyClicked=false,earlyProof,guideProof;
        try{
            context=await browser.newContext({viewport:{width:1280,height:640},acceptDownloads:true});
            await context.route('**/*',async route=>{
                const request=route.request(),url=request.url();requests.push({url,method:request.method()});
                if(request.method()!=='GET'||!url.startsWith(base)){errors.push('Unexpected external/non-GET request.');await route.abort();return;}
                const target=mode==='dependency-failure'||mode==='guide-ready'?zipURL:appURL;
                if(url===target&&inject){inject=false;observed();if(mode!=='entry-failure')await held;if(!delayed){await route.abort('failed');return;}}
                await route.continue();
            });
            page=await context.newPage();page.setDefaultTimeout(30000);
            read=await chromiumRuntimeDOMReader(page,context);
            page.on('pageerror',error=>errors.push(error.message));page.on('crash',()=>errors.push('Page crash.'));page.on('download',()=>{report.downloads++;});
            page.on('worker',worker=>{const row={mode,url:worker.url(),closed:false};rows.push(row);worker.on('close',()=>{row.closed=true;});});
            await page.goto(base,{waitUntil:'domcontentloaded'});
            let timer;try{await Promise.race([seen,new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('Startup fault request was not observed.')),30000);})]);}finally{clearTimeout(timer);}
            const panel=page.locator('#application-startup');
            if(mode==='dependency-failure'){
                await page.locator('#release-info-button').click();await page.getByText(buildId,{exact:true}).waitFor();release();
            }
            if(delayed){
                if(mode==='pending-recovery')await panel.locator('[id=application-startup-reload]').focus();
                assert.equal(await panel.getAttribute('data-state'),'loading');assert.equal(await panel.isVisible(),true);assert.equal(await page.locator('#status').textContent(),'正在載入網站');
                assert.equal(await page.locator('#open-model').isDisabled(),true);
                if(mode!=='guide-ready')assert.equal(await read(()=>document.querySelector('#open-model').onclick===null),true);
                else{await page.locator('#usage-guide-button').click();await page.locator('#guide-tab-explore').click();assert.equal(await page.locator('[data-guide-action=open]').isDisabled(),true);}
                if(mode==='early-open'){
                    earlyChooser=page.waitForEvent('filechooser');earlyChooser.catch(()=>{});
                    earlyClick=page.locator('#open-model').click().then(()=>{earlyClicked=true;});earlyClick.catch(()=>{});
                    await page.waitForTimeout(100);assert.equal(earlyClicked,false);
                }
                assert.equal(await page.locator('#model-file').inputValue(),'');release();
            }else{
                await page.locator('#application-startup[data-state=failed]').waitFor();
                assert.equal(await panel.getAttribute('role'),'alert');assert.equal(await page.locator('#status').textContent(),'網站啟動未完成');assert.equal(await page.locator('dialog[open]').count(),0);
                const text=await panel.textContent();assert.ok(text.includes('網站啟動未完成'));assert.ok(!text.includes('app.js')&&!text.includes('zip.js')&&!text.includes(base));
                assert.equal(await read(()=>document.activeElement===document.querySelector('#application-startup-reload')),true);
                assert.equal(await read(()=>document.querySelector('.app-header').inert),true);
                bounds=await panel.boundingBox();assert.ok(bounds&&bounds.x>=0&&bounds.y>=0&&bounds.x+bounds.width<=1280&&bounds.y+bounds.height<=640);
                if(mode==='dependency-failure'){
                    const bytes=await page.screenshot();assert.ok(bytes.length>0&&bytes.length<=512*1024);
                    report.failureScreenshot={mode,encoding:'base64',mime:'image/png',bytes:bytes.length,sha256:sha256(bytes),data:bytes.toString('base64')};
                }
                const navigation=page.waitForNavigation({waitUntil:'domcontentloaded'});
                // This must remain usable even while partial application
                // shortcut handlers exist after the dependency failure.
                await page.locator('#application-startup-reload').press('Enter');await navigation;
            }
            const deadline=Date.now()+30000;while(!await read(()=>document.querySelector('#autosave-enabled').disabled===false&&document.querySelector('#application-startup').hidden)){assert.ok(Date.now()<deadline,'Application did not recover after native reload/releasing the held request.');await page.waitForTimeout(50);}
            assert.equal(await page.locator('#open-model').isDisabled(),false);assert.equal(await read(()=>typeof document.querySelector('#open-model').onclick),'function');
            if(mode==='guide-ready'){
                await page.locator('[data-guide-action=open]:enabled').waitFor();assert.equal(await page.locator('#usage-guide').getAttribute('open'),'');assert.equal(await read(()=>document.activeElement===document.querySelector('#guide-tab-explore')),true);
                guideProof={disabledWhileLoading:true,enabledWhenReady:true,dialogPreserved:true,focusPreserved:true};await page.keyboard.press('Escape');
            }
            if(mode==='early-open'){
                await earlyClick;const chooser=await earlyChooser,handle=chooser.element();
                try{assert.equal(await read(()=>document.querySelector('#application-startup').hidden&&!document.querySelector('#open-model').disabled),true);await chooser.setFiles([]);}finally{await handle.dispose();}
                assert.equal(await read(()=>document.querySelector('#model-file').files.length),0);
                earlyProof={disabledWhilePending:true,clickWaitedForReady:true,nativeChooser:true,selectedFiles:0};
            }
            assert.equal(await page.locator('#model-file').inputValue(),'');assert.equal(await read(()=>document.querySelector('.app-header').inert),false);
            assert.equal(await page.locator('#status').textContent(),'準備就緒');assert.equal(await page.locator('#model-tabs').isVisible(),false);assert.equal(await page.locator('#layer-count').textContent(),'—');
            if(mode==='pending-recovery')assert.equal(await read(()=>document.activeElement===document.querySelector('#open-model')),true);
            assert.ok(!requests.some(r=>/\/(?:model-worker|tflite-runtime-worker)\.js(?:\?|$)|\/vendor\/litert\//.test(r.url)));
            assert.equal(rows.filter(w=>/\/(?:model-worker|tflite-runtime-worker)\.js(?:\?|$)/.test(w.url)).length,0);
            assert.ok(await read(()=>document.documentElement.scrollWidth<=1280));
            await context.close();contextsClosed=true;assert.ok(rows.every(w=>w.closed));assert.deepEqual(errors,[]);
            report.cases.push({mode,recovered:true,contextClosed:true,modelOpened:false,runtimeFetched:false,keyboardReload:!delayed,pendingFocusRestored:mode==='pending-recovery',workers:rows.length,...(bounds?{failureBounds:bounds}:{}),...(earlyProof?{earlyOpen:earlyProof}:{}),...(guideProof?{guideReadiness:guideProof}:{})});
        }catch(error){report.error=error.stack||String(error);throw Object.assign(error,{startupRecovery:report});}
        finally{release();if(context&&!contextsClosed)await context.close();report.workers.push(...rows);report.requests.push(...requests);report.errors.push(...errors);}
    }
    assert.equal(report.downloads,0);assert.deepEqual(report.errors,[]);assert.ok(report.workers.every(w=>w.closed));report.status='passed';return report;
}
