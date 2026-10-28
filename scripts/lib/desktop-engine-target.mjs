import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {once} from 'node:events';
import {readFile} from 'node:fs/promises';
import path from 'node:path';
import {buildSite} from '../build.mjs';
import {createStaticServer} from '../serve.mjs';
import {verifyArtifact,sha256} from './release-artifact.mjs';
import {resolveLiveCore,readStaticFile,verifyRemoteSnapshot} from './live-site.mjs';
import {assertStaticMime} from './pages-release.mjs';

export async function verifyCandidateHTTP(base,manifest,read=readStaticFile){
    const entries=manifest.files,index=entries.find(f=>f.path==='index.html');assert.ok(index);
    const check=async(item,name=item.path)=>{const r=await read(base,name,{maxBytes:item.bytes});assertStaticMime(item.path,r.contentType);assert.equal(r.bytes.length,item.bytes);assert.equal(sha256(r.bytes),item.sha256);return {...item,contentType:r.contentType};};
    await check(index,'');const checks=[];let next=0;
    await Promise.all(Array.from({length:6},async()=>{while(next<entries.length)checks.push(await check(entries[next++]));}));
    return {kind:'candidate-core',files:checks.length,rootEntrySHA256:index.sha256,checks};
}
export async function openDesktopTarget(settings,source){
    assert.equal(source.dirty,false);assert.match(source.commit,/^[a-f0-9]{40}$/);assert.match(source.tree,/^[a-f0-9]{40}$/);
    if(settings.target==='production'){
        const {base,expectedBuild,expectedSiteId}=settings,resolved=await resolveLiveCore({base,expectedBuild,expectedSiteId}),{manifest,coreBasePath}=resolved;
        const raw=(await readStaticFile(base,'site-manifest.json')).bytes;
        const verified=await verifyRemoteSnapshot({base,raw,siteId:expectedSiteId,siteManifestSHA256:sha256(raw),coreManifestSHA256:resolved.manifestSHA256,coreManifest:manifest});
        return {base,expectedBuild,expectedSiteId,manifest,coreBasePath,staticVerification:{kind:'production-site',siteId:verified.site.siteId,manifestSHA256:sha256(raw),coreManifestSHA256:resolved.manifestSHA256,rootEntrySHA256:verified.rootEntrySHA256,files:verified.checks.length},async verifyUnchanged(){const after=await resolveLiveCore({base,expectedBuild,expectedSiteId});assert.equal(after.manifestSHA256,resolved.manifestSHA256);assert.equal(sha256((await readStaticFile(base,'site-manifest.json')).bytes),sha256(raw));},async close(){}};
    }
    assert.equal(settings.target,'candidate');assert.ok(['firefox','webkit'].includes(settings.engine));
    // Fixed generated destination, public default profile, no caller URL/path.
    const built=await buildSite({output:`build/desktop-${settings.engine}-candidate`}),directory=built.directory;
    const manifest=await verifyArtifact(directory,{publicOnly:true,expectedCommit:source.commit,requireClean:true});assert.equal(manifest.release.source.tree,source.tree);
    const handler=createStaticServer(directory),mount='/tflite-explorer/',server=createServer((req,res)=>{if(!req.url.startsWith(mount)){res.writeHead(404).end();return;}req.url='/'+req.url.slice(mount.length);handler.emit('request',req,res);});
    server.listen(0,'127.0.0.1');await once(server,'listening');const base=`http://127.0.0.1:${server.address().port}${mount}`;
    const close=async()=>{server.closeAllConnections();await new Promise(resolve=>server.close(resolve));};
    try{
        const staticVerification=await verifyCandidateHTTP(base,manifest);staticVerification.coreManifestSHA256=sha256(await readFile(path.join(directory,'release-manifest.json')));
        return {base,expectedBuild:manifest.release.buildId,expectedSiteId:null,manifest,coreBasePath:'',staticVerification,async verifyUnchanged(){const after=await verifyArtifact(directory,{publicOnly:true,expectedCommit:source.commit,requireClean:true});assert.deepEqual(after,manifest);},close};
    }catch(error){await close();throw error;}
}
