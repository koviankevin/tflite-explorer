import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdir,mkdtemp,readFile,writeFile,lstat,readdir} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import path from 'node:path';
import {root,writeManifest,sha256} from '../scripts/lib/release-artifact.mjs';
import {packageRelease} from '../scripts/package-release.mjs';
import {fetchReleasedCore,recoverPreparedCore,fetchRetainedCore} from '../scripts/lib/release-history.mjs';
import {RELEASE_GATE_KINDS} from '../scripts/lib/release-test-plan.mjs';

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

async function preparedFixture(){
    const f=await fixture(),delivery=path.join(f.temporary,'delivery');await mkdir(delivery);
    const manifestBytes=await readFile(path.join(f.core,'release-manifest.json')),manifest=JSON.parse(manifestBytes),zipName=`model-lens-public-${f.reference.version}-${f.reference.build}.zip`;
    await writeFile(path.join(delivery,zipName),f.bytes);await writeFile(path.join(delivery,zipName+'.sha256'),`${f.reference.sha256}  ${zipName}\n`);await writeFile(path.join(delivery,'release-manifest.json'),manifestBytes);
    await writeFile(path.join(delivery,'release-gates.json'),JSON.stringify({format:'model-lens-release-evidence',version:1,status:'passed',repository:'koviankevin/tflite-explorer',release:manifest.release,gates:RELEASE_GATE_KINDS.map(kind=>({kind}))}));
    const python=process.env.PYTHON_BIN||(process.platform==='win32'?'python':'python3'),archive=path.join(f.temporary,'prepared.zip');
    execFileSync(python,['-I','-c',"import sys,zipfile,pathlib\nwith zipfile.ZipFile(sys.argv[1],'w') as z:\n for p in sorted(pathlib.Path(sys.argv[2]).iterdir()):z.write(p,p.name)",archive,delivery],{windowsHide:true});
    const bytes=await readFile(archive),run={id:31,path:'.github/workflows/verified-pages.yml',event:'workflow_dispatch',head_branch:'main',head_sha:f.reference.source,status:'completed',conclusion:'failure',run_attempt:2,repository:{id:42,full_name:'koviankevin/tflite-explorer'},head_repository:{id:42,full_name:'koviankevin/tflite-explorer'}};
    const job={name:'prepare',run_id:run.id,run_attempt:2,head_sha:run.head_sha,status:'completed',conclusion:'success',started_at:'2026-10-27T01:00:00Z',completed_at:'2026-10-27T01:01:00Z'};
    const artifact={id:7,name:'release-delivery',size_in_bytes:bytes.length,digest:'sha256:'+sha256(bytes),expired:false,created_at:'2026-10-27T01:00:40Z',expires_at:'2099-01-01T00:00:00Z',workflow_run:{id:31,head_branch:'main',head_sha:run.head_sha,repository_id:42,head_repository_id:42}};
    const calls=[];let downloads=0;
    const api=async route=>{
        calls.push(route);assert.ok(route.startsWith('repos/koviankevin/tflite-explorer/'));
        if(route.includes('/releases/tags/'))return null;if(route.includes('/git/'))return f.api(route);
        if(route.includes('/workflows/'))return {total_count:1,workflow_runs:[structuredClone(run)]};
        if(route.endsWith('/runs/31'))return run;
        if(route.includes('/attempts/')){assert.ok(route.includes('/attempts/'+run.run_attempt+'/'));return {total_count:1,jobs:[job]};}
        if(route.includes('/artifacts?'))return {total_count:1,artifacts:[artifact]};
        throw Error('Unexpected recovery API route.');
    };
    const download=async(route,file,limit)=>{downloads++;assert.equal(route,'repos/koviankevin/tflite-explorer/actions/artifacts/7/zip');assert.equal(limit,artifact.size_in_bytes);await writeFile(file,bytes,{flag:'wx'});};
    return {...f,delivery,bytes,run,job,artifact,api,download,calls,downloads:()=>downloads};
}

test('interrupted publication can retain its exact live namespace from the successful prepare attempt',async()=>{
    const f=await preparedFixture(),result=await fetchRetainedCore(f.reference,{outputDirectory:path.join(f.temporary,'recovered'),api:f.api,download:f.download});
    assert.equal(result.manifest.release.buildId,f.reference.build);assert.equal(result.provenance.retentionOnly,true);assert.equal(result.provenance.runId,31);assert.equal(result.provenance.attempt,2);assert.equal(result.provenance.artifactDigest,f.artifact.digest);assert.equal(f.downloads(),1);
    assert.equal(await readFile(path.join(result.directory,'src/app.js'),'utf8'),'throw Error("must never execute retained code");');
    assert.ok(f.calls.some(route=>route.includes('/attempts/2/jobs')));
    await assert.rejects(recoverPreparedCore(f.reference,{outputDirectory:result.directory,api:f.api,download:f.download}),/exist/i);assert.equal(f.downloads(),1);
});

test('retention refuses another run/source/attempt, expired artifacts and incomplete preparation before download',async()=>{
    const f=await preparedFixture(),original={run:structuredClone(f.run),job:structuredClone(f.job),artifact:structuredClone(f.artifact)};
    const changes=[x=>x.run.head_repository.id=99,x=>x.run.head_sha='c'.repeat(40),x=>x.run.event='pull_request',x=>x.run.head_branch='feature',x=>x.run.path='other.yml',x=>x.job.run_attempt=1,x=>x.job.run_id=32,x=>x.job.head_sha='c'.repeat(40),x=>x.job.conclusion='failure',x=>x.artifact.expired=true,x=>x.artifact.expires_at='2000-01-01T00:00:00Z',x=>x.artifact.created_at='2026-10-26T01:00:00Z',x=>x.artifact.created_at='2026-10-27T01:02:00Z',x=>x.artifact.digest=null,x=>x.artifact.workflow_run.head_repository_id=99,x=>x.artifact.workflow_run.head_sha='c'.repeat(40)];
    for(const [i,change] of changes.entries()){
        for(const key of Object.keys(original))Object.assign(f[key],structuredClone(original[key]));change(f);
        const output=path.join(f.temporary,'rejected-'+i);await assert.rejects(recoverPreparedCore(f.reference,{outputDirectory:output,api:f.api,download:f.download}));await assert.rejects(lstat(output),error=>error.code==='ENOENT');
    }
    assert.equal(f.downloads(),0);
});

test('prepared retention does not fall back when a published release fails authentication',async()=>{
    const f=await preparedFixture();await assert.rejects(fetchRetainedCore(f.reference,{outputDirectory:path.join(f.temporary,'no-fallback'),api:async route=>route.includes('/releases/tags/')?{...f.metadata.release,author:{login:'someone'}}:f.api(route),download:f.download}),/Untrusted/i);
    assert.equal(f.downloads(),0);assert.ok(!f.calls.some(route=>route.includes('/workflows/')));
});

test('prepared bytes must match the provider digest and live manifest before becoming a retained core',async()=>{
    const f=await preparedFixture();
    await assert.rejects(recoverPreparedCore(f.reference,{outputDirectory:path.join(f.temporary,'bad-transport'),api:f.api,download:async(route,file)=>writeFile(file,Buffer.alloc(f.bytes.length,1),{flag:'wx'})}),/digest/i);
    await assert.rejects(recoverPreparedCore({...f.reference,manifestSHA256:'0'.repeat(64)},{outputDirectory:path.join(f.temporary,'bad-manifest'),api:f.api,download:f.download}),/hash/i);
    await assert.rejects(lstat(path.join(f.temporary,'bad-manifest','core')),e=>e.code==='ENOENT');
    f.metadata.commit.tree.sha='c'.repeat(40);await assert.rejects(recoverPreparedCore(f.reference,{outputDirectory:path.join(f.temporary,'bad-tree'),api:f.api,download:f.download}),/tree/i);
});

test('authenticated delivery archives still reject extra entries before extraction',async()=>{
    const f=await preparedFixture(),python=process.env.PYTHON_BIN||(process.platform==='win32'?'python':'python3');
    const bytes=execFileSync(python,['-I','-c','import sys,io,zipfile\nz=zipfile.ZipFile(io.BytesIO(sys.stdin.buffer.read())); b=io.BytesIO()\nwith zipfile.ZipFile(b,"w") as out:\n for n in z.namelist():out.writestr(n,z.read(n))\n out.writestr("unexpected.js","throw Error()")\nsys.stdout.buffer.write(b.getvalue())'],{input:f.bytes,windowsHide:true});
    Object.assign(f.artifact,{size_in_bytes:bytes.length,digest:'sha256:'+sha256(bytes)});
    const output=path.join(f.temporary,'extra');await assert.rejects(recoverPreparedCore(f.reference,{outputDirectory:output,api:f.api,download:async(route,file)=>writeFile(file,bytes,{flag:'wx'})}),/archive/i);assert.deepEqual(await readdir(path.join(output,'delivery')),[]);
});
