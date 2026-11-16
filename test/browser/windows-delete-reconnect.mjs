import assert from 'node:assert/strict';
import {chromium} from 'playwright';
import {mkdir,writeFile} from 'node:fs/promises';
import {once} from 'node:events';
import path from 'node:path';
import {createStaticServer} from '../../scripts/serve.mjs';
import {deleteReconnectFlow} from './delete-reconnect-flow.mjs';
import {chromiumRuntimeDOMReader} from './runtime-module-cold-flow.mjs';
assert.equal(process.platform,'win32');assert.ok(process.argv.includes('--allow-local-browser'));
const directory=path.resolve(process.env.DELETE_QA_DIR||'build/qa/delete-110-desktop'),site=path.resolve(process.env.DELETE_QA_SITE||'build/qa/delete-110-site');
await mkdir(directory,{recursive:true});const server=createStaticServer(site);server.listen(0,'127.0.0.1');await once(server,'listening');
const report={status:'failed',browsers:[]};
try{
    for(const channel of ['chrome','msedge']){
        const browser=await chromium.launch({channel,headless:true}),row={channel,version:browser.version(),errors:[]};report.browsers.push(row);
        try{
            const context=await browser.newContext({viewport:{width:1280,height:640},acceptDownloads:true}),page=await context.newPage();page.on('pageerror',e=>row.errors.push(e.message));
            await page.goto('http://127.0.0.1:'+server.address().port);await page.locator('#open-model').waitFor({state:'visible'});
            const output=path.join(directory,channel);await mkdir(output,{recursive:true});
            row.result=await deleteReconnectFlow({page,read:await chromiumRuntimeDOMReader(page,context),directory:output,check:name=>console.log(channel+' PASS '+name)});
            assert.deepEqual(row.errors,[]);await page.screenshot({path:path.join(output,'finished.png')});await context.close();
        }finally{await browser.close();row.closed=true;}
    }
    report.status='passed';
}finally{server.close();await writeFile(path.join(directory,'report.json'),JSON.stringify(report,null,2)+'\n');}
