import {writeFile} from 'node:fs/promises';
import path from 'node:path';
import {validateDelivery,expectedDelivery,assertStaticMime} from './lib/pages-release.mjs';
import {PUBLIC_SITE} from './lib/site-history.mjs';
import {readStaticFile,bindLiveSnapshot,verifyRemoteSnapshot} from './lib/live-site.mjs';
const report={format:'model-lens-live-release',version:2,status:'failed',startedAt:new Date().toISOString(),checks:[]};
try{
    const expected=expectedDelivery(),{manifest}=await validateDelivery('build/pages-delivery',expected);
    const trusted={siteId:process.env.EXPECTED_SITE_ID,siteManifestSHA256:process.env.EXPECTED_SITE_MANIFEST_SHA,coreManifestSHA256:expected.manifest,coreManifest:manifest};
    for(const key of ['siteId','siteManifestSHA256'])if(typeof trusted[key]!=='string'||!/^[a-f0-9]{64}$/.test(trusted[key]))throw Error('Missing trusted full-site outputs.');
    const until=Date.now()+90000;let raw;
    while(Date.now()<until){
        try{const response=await readStaticFile(PUBLIC_SITE,'site-manifest.json');assertStaticMime('site-manifest.json',response.contentType);bindLiveSnapshot(response.bytes,trusted);raw=response.bytes;break;}
        catch(error){report.readinessError=error.message;}
        await new Promise(resolve=>setTimeout(resolve,3000));
    }
    if(!raw)throw Error('Expected complete site did not become live within 90 seconds.');
    const verified=await verifyRemoteSnapshot({base:PUBLIC_SITE,raw,...trusted,onFile:item=>report.checks.push(item)});
    report.siteId=verified.site.siteId;report.siteManifestSHA256=trusted.siteManifestSHA256;report.rootEntrySHA256=verified.rootEntrySHA256;report.legacyRelease=verified.site.legacyRoot.release;report.retainedBuildIds=verified.site.retainedBuildIds;
    report.release=manifest.release;report.status='passed';
}catch(error){report.error=error.message;process.exitCode=1;}
finally{report.finishedAt=new Date().toISOString();await writeFile(path.join(process.env.RUNNER_TEMP,'pages-live-report.json'),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify({status:report.status,files:report.checks.length,error:report.error}));}
