import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdir,mkdtemp,writeFile,lstat,readFile} from 'node:fs/promises';
import path from 'node:path';
import {root,sha256,writeManifest} from '../scripts/lib/release-artifact.mjs';
import {SITE_BASELINE} from '../scripts/lib/site-browser-policy.mjs';
import {BASELINE_MANIFEST_SHA256,parseLiveSite,planSiteHistory,preparePublicSnapshot,readPublicSiteFile,PUBLIC_SITE} from '../scripts/lib/site-history.mjs';

const encoded=value=>Buffer.from(JSON.stringify(value)),copy=value=>structuredClone(value);
const baseline={release:{schemaVersion:1,version:SITE_BASELINE.version,buildId:SITE_BASELINE.build,distribution:'public',extension:null,source:{commit:SITE_BASELINE.source,tree:'b'.repeat(40),dirty:false}},basePath:`versions/${SITE_BASELINE.build}/`,manifestSHA256:BASELINE_MANIFEST_SHA256};
const ref=id=>({release:{schemaVersion:1,version:'0.2.0-preview.'+id,buildId:String(id).repeat(16),distribution:'public',extension:null,source:{commit:'a'.repeat(40),tree:'b'.repeat(40),dirty:false}},basePath:`versions/${String(id).repeat(16)}/`,manifestSHA256:String(id).repeat(64)});
function site(current,retained=[]){
    const versions=[...new Map([current,baseline,...retained].map(r=>[r.release.buildId,r])).values()];
    return sign({format:'model-lens-versioned-site',schemaVersion:1,current,legacyRoot:baseline,retainedBuildIds:retained.map(r=>r.release.buildId),versions,files:[{path:'index.html',bytes:5,sha256:'a'.repeat(64)}]});
}
function sign(value){const {siteId,...body}=value;return {...body,siteId:sha256(encoded(body))};}

test('first migration pins the currently served original root instead of guessing a baseline',()=>{
    const candidate=ref(8),plan=planSiteHistory({candidate,legacyRelease:baseline.release});
    assert.deepEqual(plan.current,candidate);assert.deepEqual(plan.legacyRoot,baseline);assert.deepEqual(plan.retained,[baseline]);assert.equal(plan.liveSiteId,null);
    for(const change of [r=>r.buildId='0'.repeat(16),r=>r.version='0.2.0-preview.6',r=>r.source.commit='a'.repeat(40),r=>r.source.dirty=true,r=>r.distribution='internal']){const release=copy(baseline.release);change(release);assert.throws(()=>planSiteHistory({candidate,legacyRelease:release}));}
});

test('upgrades retain the two most recently active versions and the permanent root baseline',()=>{
    const old=ref(3),recent=ref(4),active=ref(5),candidate=ref(8),live=site(active,[recent,old]);
    assert.deepEqual(parseLiveSite(encoded(live)),live);
    const plan=planSiteHistory({candidate,liveSite:live});assert.deepEqual(plan.retained,[active,recent]);assert.deepEqual(plan.legacyRoot,baseline);assert.equal(plan.liveSiteId,live.siteId);
    const next=site(candidate,plan.retained),another=planSiteHistory({candidate:ref(9),liveSite:next});assert.deepEqual(another.retained,[candidate,active]);assert.deepEqual(another.legacyRoot,baseline);
});

test('idempotent preparation and rollback preserve candidate namespaces without requiring their Release',()=>{
    const active=ref(8),previous=ref(4),live=site(active,[previous,baseline]);
    assert.deepEqual(planSiteHistory({candidate:active,liveSite:live}).retained,[previous,baseline]);
    const rollback=planSiteHistory({candidate:previous,liveSite:live});assert.deepEqual(rollback.retained,[active,baseline]);assert.deepEqual(rollback.legacyRoot,baseline);
    const collision={...copy(previous),manifestSHA256:'0'.repeat(64)};assert.throws(()=>planSiteHistory({candidate:collision,liveSite:live}),/collid/i);
});

test('resigned HTTP metadata cannot substitute a private core, baseline, role, path or excessive budget',()=>{
    const original=site(ref(8),[ref(4)]);
    const changes=[v=>v.legacyRoot.manifestSHA256='0'.repeat(64),v=>v.current.release.distribution='internal',v=>v.current.release.extension={private:true},v=>v.current.basePath='../other/',v=>v.current.release.buildId=['8'.repeat(16)],v=>v.current.manifestSHA256=['8'.repeat(64)],v=>v.retainedBuildIds.push(v.retainedBuildIds[0]),v=>v.retainedBuildIds.push(v.current.release.buildId),v=>v.versions.push(copy(v.versions[0])),v=>v.versions.pop(),v=>v.files[0].path='../escape',v=>v.files.push(copy(v.files[0])),v=>v.files[0].bytes=512*1024**2,v=>v.files[0].path='site-manifest.json',v=>v.files[0].sha256='no',v=>v.schemaVersion=2,v=>v.surprise=true];
    for(const change of changes){const value=copy(original);change(value);assert.throws(()=>parseLiveSite(encoded(sign(value))));}
    const stale=copy(original);stale.current.release.version='2.0.0';assert.throws(()=>parseLiveSite(encoded(stale)));
    assert.throws(()=>parseLiveSite(Buffer.alloc(4*1024**2+1)));assert.throws(()=>parseLiveSite(encoded(null)));
});

async function candidateFixture(){
    await mkdir(path.join(root,'test-results'),{recursive:true});const temporary=await mkdtemp(path.join(root,'test-results','site-history-')),core=path.join(temporary,'core');await mkdir(path.join(core,'src'),{recursive:true});const release=ref(8).release;
    for(const [name,text] of Object.entries({'index.html':"<head><meta content=\"base-uri 'self'\"></head>",'src/app.js':'export {};','src/model-worker.js':'export {};','release.json':JSON.stringify(release),LICENSE:'MIT','LICENSE-Netron.txt':'MIT'}))await writeFile(path.join(core,name),text);
    const manifest=await writeManifest(core,release);return {temporary,core,reference:{release,basePath:ref(8).basePath,manifestSHA256:sha256(await readFile(path.join(core,'release-manifest.json')))},manifest};
}

test('unavailable history fails closed and an already-live candidate is never reacquired',async()=>{
    const f=await candidateFixture(),calls=[],snapshot=path.join(f.temporary,'site');
    const live=site(f.reference,[baseline]);
    await assert.rejects(preparePublicSnapshot({currentDirectory:f.core,outputDirectory:snapshot,historyDirectory:path.join(f.temporary,'history'),readDeployment:async()=>({siteId:live.siteId,legacy:false}),readPublic:async name=>{assert.equal(name,'site-manifest.json');return encoded(live);},acquire:async(reference,options)=>{calls.push(reference);assert.ok(options.outputDirectory.endsWith(SITE_BASELINE.build));throw Error('Verified backup unavailable');}}),/backup/);
    assert.deepEqual(calls,[{version:SITE_BASELINE.version,build:SITE_BASELINE.build,source:SITE_BASELINE.source,manifestSHA256:BASELINE_MANIFEST_SHA256,sha256:SITE_BASELINE.sha256,bytes:SITE_BASELINE.bytes}]);await assert.rejects(lstat(snapshot),e=>e.code==='ENOENT');
});

test('a wrong live root or HTTP failure cannot silently fall back or produce a replacement site',async()=>{
    const f=await candidateFixture(),base={currentDirectory:f.core,outputDirectory:path.join(f.temporary,'site'),historyDirectory:path.join(f.temporary,'history'),readDeployment:async()=>({siteId:'0'.repeat(64),legacy:false}),acquire:async()=>assert.fail('must reject before downloading')};
    await assert.rejects(preparePublicSnapshot({...base,readPublic:async()=>{throw Error('HTTP 503');}}),/503/);
    await assert.rejects(preparePublicSnapshot({...base,readPublic:async name=>name==='site-manifest.json'?null:encoded({...baseline.release,buildId:'0'.repeat(16)})}),/history|baseline|reference/i);
    await assert.rejects(preparePublicSnapshot({...base,readPublic:async()=>encoded({format:'unknown'})}));await assert.rejects(lstat(base.outputDirectory),e=>e.code==='ENOENT');
});

test('a stale CDN snapshot stops preparation before acquiring or deleting any retained core',async()=>{
    const f=await candidateFixture(),live=site(f.reference,[baseline]),output=path.join(f.temporary,'stale-site');
    await assert.rejects(preparePublicSnapshot({currentDirectory:f.core,outputDirectory:output,historyDirectory:path.join(f.temporary,'history'),readDeployment:async()=>({siteId:'0'.repeat(64),legacy:false}),readPublic:async()=>encoded(live),acquire:async()=>assert.fail('stale HTTP must not alter retention')}),/history/);await assert.rejects(lstat(output),e=>e.code==='ENOENT');
});

test('public metadata reads are fixed-origin, bounded, and only an actual index 404 permits legacy migration',async()=>{
    const original=globalThis.fetch;let response;
    try{
        globalThis.fetch=async(url,options)=>{assert.ok([PUBLIC_SITE+'site-manifest.json',PUBLIC_SITE+'release.json'].includes(url));assert.equal(options.redirect,'error');assert.equal(options.cache,'no-store');return response;};
        response=new Response('not found',{status:404});assert.equal(await readPublicSiteFile('site-manifest.json'),null);
        response=new Response('not found',{status:404});await assert.rejects(readPublicSiteFile('release.json'),/404/);
        for(const status of [403,429,503]){response=new Response('error',{status});await assert.rejects(readPublicSiteFile('site-manifest.json'),new RegExp(String(status)));}
        response=new Response('{}');assert.equal((await readPublicSiteFile('site-manifest.json')).toString(),'{}');
        response=new Response('{}',{headers:{'content-length':String(4*1024**2+1)}});await assert.rejects(readPublicSiteFile('site-manifest.json'),/limit/);
        response=new Response(new ReadableStream({start(controller){controller.enqueue(new Uint8Array(4*1024**2));controller.enqueue(new Uint8Array(1));controller.close();}}));await assert.rejects(readPublicSiteFile('site-manifest.json'),/limit/);
        await assert.rejects(readPublicSiteFile('../private'));
    }finally{globalThis.fetch=original;}
});
