import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {once} from 'node:events';
import {sha256} from '../scripts/lib/release-artifact.mjs';
import {SITE_BASELINE} from '../scripts/lib/site-browser-policy.mjs';
import {BASELINE_MANIFEST_SHA256} from '../scripts/lib/site-history.mjs';
import {bindLiveSnapshot,readStaticFile,verifyRemoteSnapshot,resolveLiveCore} from '../scripts/lib/live-site.mjs';

const json=value=>Buffer.from(JSON.stringify(value,null,2)+'\n'),row=(name,bytes)=>({path:name,bytes:bytes.length,sha256:sha256(bytes)});
function fixture(){
    const release={schemaVersion:1,version:'0.2.0-preview.8',buildId:'8'.repeat(16),distribution:'public',extension:null,source:{commit:'a'.repeat(40),tree:'b'.repeat(40),dirty:false}};
    const prefix=`versions/${release.buildId}/`,coreFiles=new Map(Object.entries({'index.html':'<head></head>','src/app.js':'export const active=true;','src/model-worker.js':'export {};','release.json':JSON.stringify(release),LICENSE:'MIT','LICENSE-Netron.txt':'MIT','demo.tflite':'public-fixture'}).map(([name,text])=>[name,Buffer.from(text)]));
    const coreManifest={schemaVersion:1,release,files:[...coreFiles].map(([name,bytes])=>row(name,bytes))},manifestBytes=json(coreManifest);
    const current={release,basePath:prefix,manifestSHA256:sha256(manifestBytes)},legacyRoot={release:{...release,version:SITE_BASELINE.version,buildId:SITE_BASELINE.build,source:{...release.source,commit:SITE_BASELINE.source}},basePath:`versions/${SITE_BASELINE.build}/`,manifestSHA256:BASELINE_MANIFEST_SHA256};
    const files=new Map([...coreFiles].map(([name,bytes])=>[prefix+name,bytes]));files.set(prefix+'release-manifest.json',manifestBytes);files.set('index.html',Buffer.from(`<head><base href="./${prefix}"></head>`));files.set('release.json',json(legacyRoot.release));files.set('src/app.js',Buffer.from('export const legacy=true;'));
    const body={format:'model-lens-versioned-site',schemaVersion:1,current,legacyRoot,retainedBuildIds:[SITE_BASELINE.build],versions:[current,legacyRoot],files:[...files].map(([name,bytes])=>row(name,bytes))},site={...body,siteId:sha256(Buffer.from(JSON.stringify(body)))},raw=json(site);files.set('site-manifest.json',raw);
    const trusted={siteId:site.siteId,siteManifestSHA256:sha256(raw),coreManifestSHA256:current.manifestSHA256,coreManifest};
    return {files,site,raw,trusted,coreManifest,prefix};
}

async function serverFixture(){
    const f=fixture(),requests=[],overrides=new Map();
    const type=name=>name.endsWith('.html')?'text/html':name.endsWith('.js')?'text/javascript':name.endsWith('.json')?'application/json':'application/octet-stream';
    const server=createServer((req,res)=>{
        requests.push(req.url);const pathname=decodeURIComponent(new URL(req.url,'http://localhost').pathname);
        if(!pathname.startsWith('/tflite-explorer/')){res.writeHead(404).end();return;}
        const name=pathname.slice('/tflite-explorer/'.length)||'index.html',override=overrides.get(name),bytes=override?.bytes??f.files.get(name);
        if(!bytes){res.writeHead(404).end();return;}res.writeHead(200,{'content-type':override?.type||type(name)}).end(bytes);
    });server.listen(0,'127.0.0.1');await once(server,'listening');
    return {...f,requests,overrides,base:`http://127.0.0.1:${server.address().port}/tflite-explorer/`,close:async()=>{server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}};
}

test('full-site HTTP verification reads the real root and every namespaced/legacy file using prepared hashes',async()=>{
    const f=await serverFixture();
    try{const result=await verifyRemoteSnapshot({base:f.base,raw:f.raw,...f.trusted});assert.equal(result.checks.length,f.site.files.length);assert.equal(result.rootEntrySHA256,sha256(f.files.get('index.html')));assert.equal(result.site.current.release.buildId,'8'.repeat(16));assert.ok(f.requests.includes('/tflite-explorer/'));assert.ok(f.requests.includes('/tflite-explorer/'+f.prefix+'src/model-worker.js'));assert.ok(f.requests.every(name=>!name.includes('?')));}
    finally{await f.close();}
});

test('wrong full-site outputs cannot authorize a different snapshot even when the core build matches',()=>{
    const f=fixture();
    for(const change of [v=>v.siteId='0'.repeat(64),v=>v.siteManifestSHA256='0'.repeat(64),v=>v.coreManifestSHA256='0'.repeat(64),v=>v.coreManifest={...v.coreManifest,release:{...v.coreManifest.release,buildId:'9'.repeat(16)}}]){const trusted=structuredClone(f.trusted);change(trusted);assert.throws(()=>bindLiveSnapshot(f.raw,trusted));}
    const site=structuredClone(f.site),file=site.files.find(x=>x.path===f.prefix+'src/app.js');file.sha256='0'.repeat(64);const {siteId,...body}=site;site.siteId=sha256(Buffer.from(JSON.stringify(body)));const raw=json(site);
    assert.throws(()=>bindLiveSnapshot(raw,{...f.trusted,siteId:site.siteId,siteManifestSHA256:sha256(raw)}),/payload/);
});

test('the actual root, stale assets and non-executable namespaced worker MIME all fail verification',async()=>{
    const f=await serverFixture();
    try{
        for(const [name,override,reason] of [['index.html',{bytes:Buffer.from('old entry')},/root entry/],[f.prefix+'src/app.js',{bytes:Buffer.from('old app')},/differs/],[f.prefix+'src/model-worker.js',{bytes:f.files.get(f.prefix+'src/model-worker.js'),type:'application/octet-stream'},/MIME/]]){f.overrides.set(name,override);await assert.rejects(verifyRemoteSnapshot({base:f.base,raw:f.raw,...f.trusted}),reason);f.overrides.clear();}
    }finally{await f.close();}
});

test('live browser resolution follows current namespace instead of the frozen root metadata',async()=>{
    const f=await serverFixture();
    try{
        const resolved=await resolveLiveCore({base:f.base,expectedBuild:f.coreManifest.release.buildId,expectedSiteId:f.site.siteId});assert.equal(resolved.coreBasePath,f.prefix);assert.deepEqual(resolved.manifest,f.coreManifest);assert.ok(!f.requests.includes('/tflite-explorer/release-manifest.json'));
        await assert.rejects(resolveLiveCore({base:f.base,expectedBuild:SITE_BASELINE.build}),/build/);
        await assert.rejects(resolveLiveCore({base:f.base,expectedBuild:f.coreManifest.release.buildId,expectedSiteId:'0'.repeat(64)}),/site ID/);
        f.overrides.set(f.prefix+'release-manifest.json',{bytes:json({...f.coreManifest,surprise:true})});await assert.rejects(resolveLiveCore({base:f.base,expectedBuild:f.coreManifest.release.buildId}),/differ/);
    }finally{await f.close();}
});

test('only manual legacy smoke accepts an actual missing site index; publication never downgrades',async()=>{
    const f=fixture(),calls=[],read=async(base,name)=>{calls.push(name);return name==='site-manifest.json'?null:{bytes:json(f.coreManifest),contentType:'application/json'};};
    const old=await resolveLiveCore({base:'https://example.invalid/',expectedBuild:f.coreManifest.release.buildId,read});assert.equal(old.coreBasePath,'');assert.equal(old.site,null);assert.deepEqual(calls,['site-manifest.json','release-manifest.json']);
    await assert.rejects(resolveLiveCore({base:'https://example.invalid/',expectedBuild:f.coreManifest.release.buildId,expectedSiteId:f.site.siteId,read}),/missing/);
    await assert.rejects(resolveLiveCore({base:'https://example.invalid/',expectedBuild:f.coreManifest.release.buildId,read:async()=>{throw Error('HTTP 503');}}),/503/);
});

test('static responses are bounded and cannot redirect or downgrade other HTTP failures',async()=>{
    const base='https://example.invalid/tool/';
    const fetcher=response=>async(url,options)=>{assert.ok(url.startsWith(base));assert.equal(options.redirect,'error');assert.equal(options.cache,'no-store');return response;};
    assert.equal(await readStaticFile(base,'site-manifest.json',{allow404:true,fetcher:fetcher(new Response('missing',{status:404}))}),null);
    await assert.rejects(readStaticFile(base,'site-manifest.json',{allow404:true,fetcher:fetcher(new Response('error',{status:503}))}),/503/);
    await assert.rejects(readStaticFile(base,'large',{maxBytes:5,fetcher:fetcher(new Response('123456'))}),/limit/);
    await assert.rejects(readStaticFile(base,'large',{maxBytes:5,fetcher:fetcher(new Response('small',{headers:{'content-length':'2000'}}))}),/limit/);
    await assert.rejects(readStaticFile(base,'../escape',{fetcher:async()=>assert.fail('must reject before network')}));
    await assert.rejects(readStaticFile('https://user:secret@example.invalid/tool/','a',{fetcher:async()=>assert.fail('credentials prohibited')}));
});
