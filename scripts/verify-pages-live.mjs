import {writeFile} from 'node:fs/promises';
import path from 'node:path';
import {sha256} from './lib/release-artifact.mjs';
import {validateDelivery,expectedDelivery,assertStaticMime} from './lib/pages-release.mjs';
const report={format:'model-lens-live-release',version:1,status:'failed',startedAt:new Date().toISOString(),checks:[]};
try{
    const {manifest}=await validateDelivery('build/pages-delivery',expectedDelivery());
    const base='https://koviankevin.github.io/tflite-explorer/',build=manifest.release.buildId,until=Date.now()+90000;let ready=false;
    while(Date.now()<until){try{const r=await fetch(base+'release.json?v='+build,{signal:AbortSignal.timeout(20000)});if(r.ok){const value=await r.json();if(JSON.stringify(value)===JSON.stringify(manifest.release)){ready=true;break;}}}catch(error){report.readinessError=error.message;}await new Promise(resolve=>setTimeout(resolve,3000));}
    if(!ready)throw Error('Expected release did not become live within 90 seconds.');
    const response=await fetch(base+'release-manifest.json?v='+build,{signal:AbortSignal.timeout(20000)});if(!response.ok||JSON.stringify(await response.json())!==JSON.stringify(manifest))throw Error('Live manifest differs.');
    const pending=[...manifest.files];await Promise.all(Array.from({length:6},async()=>{while(pending.length){const item=pending.pop(),r=await fetch(base+item.path+'?v='+build,{signal:AbortSignal.timeout(20000)});if(!r.ok)throw Error(`HTTP ${r.status}: ${item.path}`);const contentType=r.headers.get('content-type');assertStaticMime(item.path,contentType);const bytes=Buffer.from(await r.arrayBuffer());if(bytes.length!==item.bytes||sha256(bytes)!==item.sha256)throw Error(`Live file differs: ${item.path}`);report.checks.push({path:item.path,bytes:item.bytes,sha256:item.sha256,contentType});}}));
    report.release=manifest.release;report.status='passed';
}catch(error){report.error=error.message;process.exitCode=1;}
finally{report.finishedAt=new Date().toISOString();await writeFile(path.join(process.env.RUNNER_TEMP,'pages-live-report.json'),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify({status:report.status,files:report.checks.length,error:report.error}));}
