import assert from 'node:assert/strict';
import {chromium} from 'playwright';
import {mkdir,writeFile} from 'node:fs/promises';
import {once} from 'node:events';
import path from 'node:path';
import {createStaticServer} from '../../scripts/serve.mjs';
import {verifyArtifact} from '../../scripts/lib/release-artifact.mjs';
import {runtimeSupportFlow} from './runtime-support-flow.mjs';
import {chromiumRuntimeDOMReader} from './runtime-module-cold-flow.mjs';
assert.equal(process.platform,'win32');assert.ok(process.argv.includes('--allow-local-browser'));
const directory=path.resolve(process.env.RUNTIME_SUPPORT_QA_DIR||'build/qa/runtime-support-native'),site=path.resolve(process.env.RUNTIME_SUPPORT_QA_SITE||'build/qa/runtime-support-site');
const manifest=await verifyArtifact(site,{publicOnly:true});
await mkdir(directory,{recursive:true});const server=createStaticServer(site);server.listen(0,'127.0.0.1');await once(server,'listening');const base='http://127.0.0.1:'+server.address().port+'/';
const report={status:'failed',at:new Date().toISOString(),release:manifest.release,coreFiles:manifest.files.length,browsers:[]};
try{
 for(const channel of ['chrome','msedge']){
  const browser=await chromium.launch({channel,headless:true}),row={channel,version:browser.version(),errors:[],workers:[]};report.browsers.push(row);
  try{
   const context=await browser.newContext({viewport:{width:1280,height:640},acceptDownloads:true}),page=await context.newPage();
   page.on('pageerror',e=>row.errors.push(e.message));page.on('worker',w=>{const r={url:w.url(),closed:false};assert.equal(new URL(w.url()).searchParams.get('v'),manifest.release.buildId);row.workers.push(r);w.on('close',()=>r.closed=true);});
   const output=path.join(directory,channel);await mkdir(output,{recursive:true});
   row.result=await runtimeSupportFlow({page,read:await chromiumRuntimeDOMReader(page,context),base,directory:output,check:name=>console.log(channel+' PASS '+name)});
   assert.deepEqual(row.errors,[]);await context.close();assert.ok(row.workers.every(w=>w.closed));
  }catch(error){row.error=error.stack;throw error;}finally{await browser.close();row.closed=true;}
 }
 report.status='passed';
}catch(error){report.error=error.stack;process.exitCode=1;}
finally{server.close();await writeFile(directory+'/report.json',JSON.stringify(report,null,2)+'\n',{flag:'wx'});console.log(JSON.stringify({status:report.status,build:manifest.release.buildId,browsers:report.browsers.map(b=>({channel:b.channel,status:b.result?.status,workers:b.workers.length,closed:b.closed})),error:report.error}));}
