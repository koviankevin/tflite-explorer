import {safeFile,sha256} from './release-artifact.mjs';
import {assertStaticMime} from './pages-release.mjs';
import {parseLiveSite} from './site-history.mjs';
import {SITE_LIMITS} from './versioned-site.mjs';

const equal=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
const hex=(value,n)=>typeof value==='string'&&new RegExp(`^[a-f0-9]{${n}}$`).test(value);

export async function readStaticFile(base,name,{maxBytes=SITE_LIMITS.manifestBytes,allow404=false,fetcher=fetch}={}){
    const location=new URL(base);
    if(!['http:','https:'].includes(location.protocol)||location.username||location.password||location.search||location.hash||!location.pathname.endsWith('/')||!Number.isSafeInteger(maxBytes)||maxBytes<0||maxBytes>SITE_LIMITS.bytes)throw Error('Invalid static read destination or limit.');
    if(name)safeFile(name);
    const url=new URL(name.split('/').map(encodeURIComponent).join('/'),location);
    const response=await fetcher(url.href,{cache:'no-store',redirect:'error',signal:AbortSignal.timeout(20000)});
    if(allow404&&response.status===404){await response.body?.cancel();return null;}
    if(!response.ok){await response.body?.cancel();throw Error(`Static HTTP ${response.status}: ${name||'/'}`);}
    // A small encoded response can have more header bytes than its decoded body.
    // Bound the actual body independently; hashes always describe decoded bytes.
    const declared=response.headers.get('content-length');
    if(declared!==null&&(!/^\d+$/.test(declared)||Number(declared)>Math.max(maxBytes,1024))){await response.body?.cancel();throw Error(`Static response limit exceeded: ${name}`);}
    const chunks=[];let length=0;
    for await(const chunk of response.body){length+=chunk.length;if(length>maxBytes)throw Error(`Static body limit exceeded: ${name}`);chunks.push(chunk);}
    return {bytes:Buffer.concat(chunks),contentType:response.headers.get('content-type')};
}

function checkCore(manifest,expectedBuild){
    const r=manifest?.release;
    if(manifest?.schemaVersion!==1||!hex(expectedBuild,16)||r?.buildId!==expectedBuild||r.distribution!=='public'||r.extension!==null||r.source?.dirty!==false||!hex(r.source.commit,40)||!hex(r.source.tree,40)||!Array.isArray(manifest.files)||!manifest.files.length||manifest.files.length>SITE_LIMITS.files)throw Error('Live core does not match the expected public build.');
    const names=new Set();let bytes=0;
    for(const item of manifest.files){safeFile(item.path);const name=item.path.toLowerCase();if(names.has(name)||name==='release-manifest.json'||!Number.isSafeInteger(item.bytes)||item.bytes<0||!hex(item.sha256,64))throw Error('Invalid live core file entry.');names.add(name);bytes+=item.bytes;}
    if(bytes>SITE_LIMITS.bytes)throw Error('Live core byte limit exceeded.');
}

export function bindLiveSnapshot(raw,{siteId,siteManifestSHA256,coreManifestSHA256,coreManifest}){
    if(!hex(siteId,64)||!hex(siteManifestSHA256,64)||!hex(coreManifestSHA256,64)||!Buffer.isBuffer(raw)||sha256(raw)!==siteManifestSHA256)throw Error('Missing or mismatched trusted site outputs.');
    const site=parseLiveSite(raw);checkCore(coreManifest,site.current.release.buildId);
    const corePath=site.current.basePath+'release-manifest.json',coreFile=site.files.find(f=>f.path===corePath);
    if(site.siteId!==siteId||site.current.manifestSHA256!==coreManifestSHA256||!equal(site.current.release,coreManifest.release)||coreFile?.sha256!==coreManifestSHA256||!site.files.some(f=>f.path==='index.html'))throw Error('Live site is not the prepared core and complete snapshot.');
    const files=new Map(site.files.map(f=>[f.path,f]));
    for(const item of coreManifest.files){const actual=files.get(site.current.basePath+item.path);if(actual?.bytes!==item.bytes||actual?.sha256!==item.sha256)throw Error('Site payload differs from the prepared core manifest.');}
    return site;
}

export async function verifyRemoteSnapshot({base,raw,siteId,siteManifestSHA256,coreManifestSHA256,coreManifest,read=readStaticFile,onFile=()=>{}}){
    const site=bindLiveSnapshot(raw,{siteId,siteManifestSHA256,coreManifestSHA256,coreManifest}),pending=[...site.files],checks=[];
    // Read the actual browser entry as well as /index.html; a stale CDN root is
    // a failure even when versioned assets and the index filename are correct.
    const index=site.files.find(f=>f.path==='index.html'),entry=await read(base,'',{maxBytes:index.bytes});
    assertStaticMime('index.html',entry.contentType);
    if(entry.bytes.length!==index.bytes||sha256(entry.bytes)!==index.sha256)throw Error('Live root entry differs from the prepared index.');
    let failure;
    await Promise.all(Array.from({length:6},async()=>{
        while(!failure&&pending.length){
            const item=pending.pop();
            try{
                const response=await read(base,item.path,{maxBytes:item.bytes});assertStaticMime(item.path,response.contentType);
                if(response.bytes.length!==item.bytes||sha256(response.bytes)!==item.sha256)throw Error(`Live file differs: ${item.path}`);
                if(item.path===site.current.basePath+'release-manifest.json'&&!equal(JSON.parse(response.bytes),coreManifest))throw Error('Live namespaced core manifest differs.');
                const check={...item,contentType:response.contentType};checks.push(check);onFile(check);
            }catch(error){failure??=error;}
        }
    }));
    if(failure)throw failure;
    return {site,checks,rootEntrySHA256:sha256(entry.bytes)};
}

// The manual browser smoke can still inspect the existing pre-migration site.
// Gated publication passes siteId, so missing/new-index failures never downgrade
// to root baseline metadata during a versioned deployment.
export async function resolveLiveCore({base,expectedBuild,expectedSiteId='',read=readStaticFile}){
    if(!hex(expectedBuild,16)||expectedSiteId!==''&&!hex(expectedSiteId,64))throw Error('Invalid expected live identity.');
    const index=await read(base,'site-manifest.json',{allow404:true});let site=null,coreBasePath='';
    if(index){assertStaticMime('site-manifest.json',index.contentType);site=parseLiveSite(index.bytes);if(expectedSiteId&&site.siteId!==expectedSiteId)throw Error('Unexpected live site ID.');coreBasePath=site.current.basePath;}
    else if(expectedSiteId)throw Error('Prepared versioned site index is missing.');
    const response=await read(base,coreBasePath+'release-manifest.json'),manifest=JSON.parse(response.bytes);assertStaticMime('release-manifest.json',response.contentType);checkCore(manifest,expectedBuild);
    if(site&&(!equal(site.current.release,manifest.release)||sha256(response.bytes)!==site.current.manifestSHA256))throw Error('Active namespace and live core manifest differ.');
    return {manifest,coreBasePath,site,manifestSHA256:sha256(response.bytes)};
}
