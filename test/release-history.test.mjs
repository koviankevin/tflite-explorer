import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdir,mkdtemp,readFile,writeFile,lstat,readdir} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import path from 'node:path';
import {root,writeManifest,sha256} from '../scripts/lib/release-artifact.mjs';
import {packageRelease} from '../scripts/package-release.mjs';
import {fetchReleasedCore} from '../scripts/lib/release-history.mjs';

async function fixture({internal=false}={}){
    await mkdir(path.join(root,'test-results'),{recursive:true});const temporary=await mkdtemp(path.join(root,'test-results','release-history-')),core=path.join(temporary,'source');await mkdir(path.join(core,'src'),{recursive:true});
    const release={schemaVersion:1,version:'1.2.3',buildId:'1'.repeat(16),distribution:internal?'internal':'public',extension:internal?{name:'Private test',version:'1',adapterInterfaceVersion:1,sourceHash:'9'.repeat(64)}:null,source:{commit:'a'.repeat(40),tree:'b'.repeat(40),dirty:false}};
    for(const [name,text] of Object.entries({'index.html':'fixture','src/app.js':'throw Error("must never execute retained code");','src/model-worker.js':'export {};','release.json':JSON.stringify(release),LICENSE:'MIT','LICENSE-Netron.txt':'Upstream MIT'}))await writeFile(path.join(core,name),text);
    await writeManifest(core,release);const pkg=await packageRelease(core,{output:path.join(temporary,'packages')}),bytes=await readFile(pkg.file),manifestSHA256=sha256(await readFile(path.join(core,'release-manifest.json')));
    const reference={version:release.version,build:release.buildId,source:release.source.commit,manifestSHA256,sha256:pkg.sha256,bytes:bytes.length};
    const metadata={release:{id:42,tag_name:'v1.2.3',draft:false,author:{login:'github-actions[bot]'},assets:[{id:7,name:`model-lens-public-${release.version}-${release.buildId}.zip`,state:'uploaded',size:bytes.length,digest:'sha256:'+pkg.sha256,uploader:{login:'github-actions[bot]'}}]},tag:{object:{type:'commit',sha:reference.source}},commit:{sha:reference.source,tree:{sha:release.source.tree}}};
    const api=async route=>{assert.ok(route.startsWith('repos/koviankevin/tflite-explorer/'));if(route.includes('/releases/tags/'))return metadata.release;if(route.includes('/git/ref/'))return metadata.tag;if(route.includes('/git/commits/'))return metadata.commit;throw Error('Unexpected API route.');};
    let downloads=0;const download=async(route,file,limit)=>{downloads++;assert.equal(route,'repos/koviankevin/tflite-explorer/releases/assets/7');assert.equal(limit,metadata.release.assets[0].size);await writeFile(file,bytes,{flag:'wx'});};
    return {temporary,core,bytes,reference,metadata,api,download,downloads:()=>downloads};
}

test('retained core comes from the exact bot release, tag, asset digest, manifest and source tree',async()=>{
    const f=await fixture(),result=await fetchReleasedCore(f.reference,{outputDirectory:path.join(f.temporary,'fetched'),api:f.api,download:f.download});
    assert.equal(result.manifest.release.source.commit,f.reference.source);assert.equal(result.manifestSHA256,f.reference.manifestSHA256);assert.equal(result.provenance.assetId,7);assert.equal(f.downloads(),1);assert.equal(await readFile(path.join(result.directory,'src/app.js'),'utf8'),'throw Error("must never execute retained code");');
    await assert.rejects(fetchReleasedCore(f.reference,{outputDirectory:f.core,api:f.api,download:f.download}),/exist|存在/i);assert.equal(f.downloads(),1);
});

test('foreign refs, manual uploads, draft/duplicate assets and digest drift fail before download',async()=>{
    const changes=[m=>m.release.draft=true,m=>m.release.author.login='someone',m=>m.release.tag_name='v9',m=>m.tag.object.type='tag',m=>m.tag.object.sha='c'.repeat(40),m=>m.commit.sha='c'.repeat(40),m=>m.release.assets[0].uploader.login='someone',m=>m.release.assets[0].state='new',m=>m.release.assets[0].digest='sha256:'+'0'.repeat(64),m=>m.release.assets[0].size++,m=>m.release.assets.push({...m.release.assets[0]}),m=>m.release.assets[0].id=-1];
    const f=await fixture(),original=structuredClone(f.metadata);
    for(const [i,change] of changes.entries()){Object.assign(f.metadata,structuredClone(original));change(f.metadata);const out=path.join(f.temporary,'bad-'+i);await assert.rejects(fetchReleasedCore(f.reference,{outputDirectory:out,api:f.api,download:f.download}));await assert.rejects(lstat(out),e=>e.code==='ENOENT');}
    assert.equal(f.downloads(),0);await assert.rejects(fetchReleasedCore({...f.reference,version:'../../other'},{outputDirectory:path.join(f.temporary,'unsafe'),api:f.api,download:f.download}));
    Object.assign(f.metadata,structuredClone(original));for(const key of ['build','source','manifestSHA256','sha256'])await assert.rejects(fetchReleasedCore({...f.reference,[key]:[f.reference[key]]},{outputDirectory:path.join(f.temporary,'typed-'+key),api:f.api,download:f.download}),/reference/i);assert.equal(f.downloads(),0);
    await assert.rejects(fetchReleasedCore(f.reference,{outputDirectory:path.join(f.temporary,'unfinished'),api:async route=>route.includes('/releases/tags/')?null:f.api(route),download:f.download}),error=>error.code==='UNRELEASED_CORE');assert.equal(f.downloads(),0);
});

test('downloaded bytes are independently checked before any archive extraction',async()=>{
    const f=await fixture();
    for(const [name,bytes] of [['short',f.bytes.subarray(0,10)],['changed',Buffer.alloc(f.bytes.length,1)]]){
        const out=path.join(f.temporary,name);await assert.rejects(fetchReleasedCore(f.reference,{outputDirectory:out,api:f.api,download:async(route,file)=>writeFile(file,bytes,{flag:'wx'})}),/size|digest|hash/i);await assert.rejects(lstat(path.join(out,'core')),e=>e.code==='ENOENT');
    }
});

test('ZIP traversal is rejected before writing any payload outside the fresh destination',async()=>{
    const f=await fixture(),python=process.env.PYTHON_BIN||(process.platform==='win32'?'python':'python3');
    const bytes=execFileSync(python,['-I','-c','import io,sys,zipfile\nb=io.BytesIO()\nwith zipfile.ZipFile(b,"w") as z:\n z.writestr("../escape","bad");z.writestr("release-manifest.json","{}")\nsys.stdout.buffer.write(b.getvalue())'],{windowsHide:true});
    const digest=sha256(bytes);Object.assign(f.metadata.release.assets[0],{size:bytes.length,digest:'sha256:'+digest});const out=path.join(f.temporary,'traversal');
    await assert.rejects(fetchReleasedCore({...f.reference,sha256:digest,bytes:bytes.length},{outputDirectory:out,api:f.api,download:async(route,file)=>writeFile(file,bytes,{flag:'wx'})}),/archive|ZIP/i);await assert.rejects(lstat(path.join(out,'escape')),e=>e.code==='ENOENT');assert.deepEqual(await readdir(path.join(out,'core')),[]);
});

test('a self-consistent archive cannot substitute private content, another manifest or a foreign Git tree',async()=>{
    const privateFixture=await fixture({internal:true});await assert.rejects(fetchReleasedCore(privateFixture.reference,{outputDirectory:path.join(privateFixture.temporary,'private'),api:privateFixture.api,download:privateFixture.download}),/內網|private/i);
    const f=await fixture();await assert.rejects(fetchReleasedCore({...f.reference,manifestSHA256:'0'.repeat(64)},{outputDirectory:path.join(f.temporary,'manifest'),api:f.api,download:f.download}),/manifest/i);
    f.metadata.commit.tree.sha='c'.repeat(40);await assert.rejects(fetchReleasedCore(f.reference,{outputDirectory:path.join(f.temporary,'tree'),api:f.api,download:f.download}),/tree|來源/i);
});
