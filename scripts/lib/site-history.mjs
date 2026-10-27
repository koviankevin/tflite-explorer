import {readFile} from 'node:fs/promises';
import path from 'node:path';
import {verifyArtifact,buildDestination,safeFile,sha256} from './release-artifact.mjs';
import {SITE_LIMITS,composeSite} from './versioned-site.mjs';
import {SITE_BASELINE,BASELINE_MANIFEST_SHA256} from './release-baseline.mjs';
import {fetchRetainedCore} from './release-history.mjs';
import {readDeployedSite,assertDeployedHistory} from './deployment-history.mjs';

export const PUBLIC_SITE='https://koviankevin.github.io/tflite-explorer/';
export {BASELINE_MANIFEST_SHA256};
const equal=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
const hex=(value,length)=>typeof value==='string'&&new RegExp(`^[a-f0-9]{${length}}$`).test(value);
const keys=(value,expected)=>value&&typeof value==='object'&&!Array.isArray(value)&&equal(Object.keys(value).sort(),[...expected].sort());

function checkReference(ref){
    const r=ref?.release;
    if(!keys(ref,['release','basePath','manifestSHA256'])||!hex(ref.manifestSHA256,64)||!r||typeof r.version!=='string'||!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/.test(r.version)||!hex(r.buildId,16)||r.distribution!=='public'||r.extension!==null||r.source?.dirty!==false||!hex(r.source.commit,40)||!hex(r.source.tree,40)||ref.basePath!==`versions/${r.buildId}/`)throw Error('Invalid public site core reference.');
}

function checkBaseline(ref){
    checkReference(ref);
    const r=ref.release;
    if(r.version!==SITE_BASELINE.version||r.buildId!==SITE_BASELINE.build||r.source.commit!==SITE_BASELINE.source||ref.manifestSHA256!==BASELINE_MANIFEST_SHA256)throw Error('Original root baseline cannot be replaced.');
}

// This checks the bounded live index, not remote payloads. Every retained core
// is subsequently authenticated independently through GitHub and reverified by
// the composer; a self-consistent HTTP index alone never qualifies its bytes.
export function parseLiveSite(raw){
    if(!Buffer.isBuffer(raw)||raw.length>SITE_LIMITS.manifestBytes)throw Error('Live site index size/type differs.');
    const value=JSON.parse(raw),{siteId,...body}=value;
    if(!keys(value,['format','schemaVersion','current','legacyRoot','retainedBuildIds','versions','files','siteId'])||body.format!=='model-lens-versioned-site'||body.schemaVersion!==1||!hex(siteId,64)||siteId!==sha256(Buffer.from(JSON.stringify(body)))||!Array.isArray(body.versions)||body.versions.length<1||body.versions.length>SITE_LIMITS.versions+1||!Array.isArray(body.retainedBuildIds)||body.retainedBuildIds.length>=SITE_LIMITS.versions||!Array.isArray(body.files)||!body.files.length||body.files.length>=SITE_LIMITS.files)throw Error('Invalid live site index.');
    checkReference(body.current);checkBaseline(body.legacyRoot);
    const versions=new Map();
    for(const ref of body.versions){checkReference(ref);const id=ref.release.buildId;if(versions.has(id))throw Error('Duplicate live core reference.');versions.set(id,ref);}
    const ids=[body.current.release.buildId,body.legacyRoot.release.buildId,...body.retainedBuildIds];
    if(new Set(body.retainedBuildIds).size!==body.retainedBuildIds.length||body.retainedBuildIds.includes(body.current.release.buildId)||body.retainedBuildIds.some(id=>!hex(id,16))||versions.size!==new Set(ids).size||ids.some(id=>!versions.has(id))||!equal(versions.get(body.current.release.buildId),body.current)||!equal(versions.get(body.legacyRoot.release.buildId),body.legacyRoot))throw Error('Live version roles differ from the retained payloads.');
    const names=new Set();let total=raw.length;
    for(const file of body.files){
        if(!keys(file,['path','bytes','sha256']))throw Error('Invalid live file entry.');
        safeFile(file.path);const name=file.path.toLowerCase();
        if(name==='site-manifest.json'||names.has(name)||!Number.isSafeInteger(file.bytes)||file.bytes<0||!hex(file.sha256,64))throw Error('Invalid live file bounds/hash.');
        names.add(name);total+=file.bytes;if(total>SITE_LIMITS.bytes)throw Error('Live site byte limit exceeded.');
    }
    return value;
}

export function planSiteHistory({candidate,liveSite=null,legacyRelease=null}){
    checkReference(candidate);let legacy,previous=[],liveSiteId=null;
    if(liveSite){
        // Accept the same validation boundary for callers that already parsed it.
        liveSite=parseLiveSite(Buffer.from(JSON.stringify(liveSite)));
        legacy=liveSite.legacyRoot;liveSiteId=liveSite.siteId;
        previous=[liveSite.current,...liveSite.retainedBuildIds.map(id=>liveSite.versions.find(v=>v.release.buildId===id))];
        const collision=liveSite.versions.find(v=>v.release.buildId===candidate.release.buildId);
        if(collision&&!equal(collision,candidate))throw Error('Candidate collides with an immutable live build.');
    }else{
        legacy={release:legacyRelease,basePath:`versions/${SITE_BASELINE.build}/`,manifestSHA256:BASELINE_MANIFEST_SHA256};checkBaseline(legacy);previous=[legacy];
    }
    const seen=new Set([candidate.release.buildId]),retained=[];
    for(const ref of previous){const id=ref.release.buildId;if(!seen.has(id)){seen.add(id);retained.push(ref);}}
    return {current:candidate,legacyRoot:legacy,retained:retained.slice(0,SITE_LIMITS.versions-1),liveSiteId};
}

export async function readPublicSiteFile(name){
    if(!['site-manifest.json','release.json'].includes(name))throw Error('Unexpected public history request.');
    const response=await fetch(PUBLIC_SITE+name,{cache:'no-store',redirect:'error',signal:AbortSignal.timeout(20000)});
    if(name==='site-manifest.json'&&response.status===404){await response.body?.cancel();return null;}
    if(!response.ok){await response.body?.cancel();throw Error(`Public history HTTP ${response.status}: ${name}`);}
    const declared=response.headers.get('content-length');if(declared!==null&&(!/^\d+$/.test(declared)||Number(declared)>SITE_LIMITS.manifestBytes)){await response.body?.cancel();throw Error('Public history response exceeds metadata limit.');}
    const chunks=[];let bytes=0;
    for await(const chunk of response.body){bytes+=chunk.length;if(bytes>SITE_LIMITS.manifestBytes)throw Error('Public history response exceeds metadata limit.');chunks.push(chunk);}
    return Buffer.concat(chunks);
}

export async function preparePublicSnapshot({currentDirectory,outputDirectory,historyDirectory,readPublic=readPublicSiteFile,acquire=fetchRetainedCore,readDeployment=readDeployedSite}){
    if(typeof historyDirectory!=='string'||!historyDirectory.trim()||typeof outputDirectory!=='string'||!outputDirectory.trim())throw Error('Explicit fresh history and snapshot directories are required.');
    const manifest=await verifyArtifact(currentDirectory,{publicOnly:true,requireClean:true}),candidate={release:manifest.release,basePath:`versions/${manifest.release.buildId}/`,manifestSHA256:sha256(await readFile(path.join(currentDirectory,'release-manifest.json')))};
    const deployed=await readDeployment(),index=await readPublic('site-manifest.json'),liveSite=index===null?null:parseLiveSite(index),legacyRelease=liveSite?null:JSON.parse(await readPublic('release.json'));
    assertDeployedHistory({liveSite,legacyRelease},deployed);
    const plan={...planSiteHistory({candidate,liveSite,legacyRelease}),deployment:deployed};
    const history=await buildDestination(historyDirectory),references=new Map([[candidate.release.buildId,candidate]]),cores=new Map([[candidate.release.buildId,{directory:currentDirectory,manifest,provenance:{kind:'verified-candidate'}}]]);
    for(const ref of [plan.legacyRoot,...plan.retained]){
        const id=ref.release.buildId;if(cores.has(id)){if(!equal(ref,references.get(id)))throw Error('History reference conflicts with the candidate.');continue;}
        const reference={version:ref.release.version,build:id,source:ref.release.source.commit,manifestSHA256:ref.manifestSHA256};
        if(id===SITE_BASELINE.build)Object.assign(reference,{sha256:SITE_BASELINE.sha256,bytes:SITE_BASELINE.bytes});
        const core=await acquire(reference,{outputDirectory:path.join(history,id)});
        const raw=await readFile(path.join(core.directory,'release-manifest.json')),actual=JSON.parse(raw);
        if(!equal(actual.release,ref.release)||sha256(raw)!==ref.manifestSHA256)throw Error('Acquired history differs from the live reference.');
        cores.set(id,core);references.set(id,ref);
    }
    const snapshot=await composeSite({currentDirectory,legacyDirectory:cores.get(plan.legacyRoot.release.buildId).directory,retainedDirectories:plan.retained.map(ref=>cores.get(ref.release.buildId).directory),outputDirectory,publicOnly:true});
    return {...snapshot,plan,history:[...cores].map(([build,core])=>({build,...core.provenance}))};
}
