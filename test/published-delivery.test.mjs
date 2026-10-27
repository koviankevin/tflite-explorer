import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdir,mkdtemp,writeFile,readFile,lstat} from 'node:fs/promises';
import path from 'node:path';
import {root,writeManifest,sha256} from '../scripts/lib/release-artifact.mjs';
import {packageRelease} from '../scripts/package-release.mjs';
import {fetchPublishedDelivery} from '../scripts/lib/release-history.mjs';
import {RELEASE_GATE_KINDS} from '../scripts/lib/release-test-plan.mjs';
import {LEGACY_DELIVERY} from '../scripts/lib/release-baseline.mjs';
import {deliveryGateKinds} from '../scripts/lib/pages-release.mjs';

async function fixture(){
    await mkdir(path.join(root,'test-results'),{recursive:true});const temporary=await mkdtemp(path.join(root,'test-results','published-delivery-')),core=path.join(temporary,'source');await mkdir(path.join(core,'src'),{recursive:true});
    const release={schemaVersion:1,version:'1.2.3',buildId:'1'.repeat(16),distribution:'public',extension:null,source:{commit:'a'.repeat(40),tree:'b'.repeat(40),dirty:false}};
    for(const [name,text] of Object.entries({'index.html':'fixture','src/app.js':'throw Error("retained code must not execute");','src/model-worker.js':'export {};','release.json':JSON.stringify(release),LICENSE:'MIT','LICENSE-Netron.txt':'MIT'}))await writeFile(path.join(core,name),text);
    await writeManifest(core,release);const pkg=await packageRelease(core,{output:path.join(temporary,'packages')}),zipName=path.basename(pkg.file);
    const payloads=new Map([[zipName,await readFile(pkg.file)],[zipName+'.sha256',await readFile(pkg.file+'.sha256')],['release-manifest.json',await readFile(path.join(core,'release-manifest.json'))],['release-gates.json',Buffer.from(JSON.stringify({format:'model-lens-release-evidence',version:1,status:'passed',repository:'koviankevin/tflite-explorer',release,gates:RELEASE_GATE_KINDS.map(kind=>({kind}))}))]]);
    const metadata={release:{id:42,tag_name:'v1.2.3',draft:false,author:{login:'github-actions[bot]'},assets:[...payloads].map(([name,bytes],i)=>({id:i+1,name,size:bytes.length,digest:'sha256:'+sha256(bytes),state:'uploaded',uploader:{login:'github-actions[bot]'}}))},tag:{object:{type:'commit',sha:release.source.commit}},commit:{sha:release.source.commit,tree:{sha:release.source.tree}}};
    const calls=[],downloads=[];
    const api=async route=>{calls.push(route);assert.ok(route.startsWith('repos/koviankevin/tflite-explorer/'));if(route.includes('/releases/tags/'))return metadata.release;if(route.includes('/git/ref/'))return metadata.tag;if(route.includes('/git/commits/'))return metadata.commit;throw Error('Unexpected route: no CI fallback is allowed.');};
    const download=async(route,file,limit)=>{const id=Number(route.split('/').at(-1)),asset=metadata.release.assets.find(a=>a.id===id);assert.ok(asset);downloads.push(asset.name);assert.equal(limit,asset.size);await writeFile(file,payloads.get(asset.name),{flag:'wx'});};
    return {temporary,core,release,metadata,payloads,api,download,calls,downloads};
}

test('promotion preserves the original four Release assets and source instead of rebuilding or rewriting evidence',async()=>{
    const f=await fixture(),result=await fetchPublishedDelivery('1.2.3',{outputDirectory:path.join(f.temporary,'promotion'),api:f.api,download:f.download});
    assert.equal(result.manifest.release.source.commit,f.release.source.commit);assert.equal(result.provenance.kind,'github-published-promotion');assert.equal(result.expected.zip,sha256(f.payloads.values().next().value));assert.equal(result.assets.length,4);
    for(const [name,bytes] of f.payloads)assert.deepEqual(await readFile(path.join(result.deliveryDirectory,name)),bytes);
    assert.equal(await readFile(path.join(result.directory,'src/app.js'),'utf8'),'throw Error("retained code must not execute");');assert.equal(f.downloads.length,4);assert.ok(!f.calls.some(route=>route.includes('/actions/')));
    await assert.rejects(fetchPublishedDelivery('1.2.3',{outputDirectory:result.directory,api:f.api,download:f.download}),/exist/);
});

test('missing/draft/partial/manual or ambiguous Releases never become promotion targets or use CI recovery',async()=>{
    const f=await fixture(),original=structuredClone(f.metadata);
    const changes=[m=>m.release=null,m=>m.release.draft=true,m=>m.release.author.login='someone',m=>m.release.assets.pop(),m=>m.release.assets[0].uploader.login='someone',m=>m.release.assets[0].state='new',m=>m.release.assets[0].digest=null,m=>m.release.assets[0].size=0,m=>m.release.assets[1].id=m.release.assets[0].id,m=>m.release.assets[1].name=m.release.assets[0].name,m=>m.tag.object.type='tag',m=>m.release.tag_name='v9.9.9'];
    for(const [i,change] of changes.entries()){Object.assign(f.metadata,structuredClone(original));change(f.metadata);const out=path.join(f.temporary,'bad-'+i);await assert.rejects(fetchPublishedDelivery('1.2.3',{outputDirectory:out,api:f.api,download:f.download}));await assert.rejects(lstat(out),e=>e.code==='ENOENT');}
    assert.equal(f.downloads.length,0);assert.ok(!f.calls.some(route=>route.includes('/actions/')));
    for(const version of ['../1.2.3','v1.2.3',['1.2.3'],'latest'])await assert.rejects(fetchPublishedDelivery(version,{outputDirectory:path.join(f.temporary,'unsafe'),api:f.api,download:f.download}));
});

test('promotion rejects substituted manifest bytes, a different Git tree and changed publication metadata',async()=>{
    const f=await fixture();
    await assert.rejects(fetchPublishedDelivery('1.2.3',{outputDirectory:path.join(f.temporary,'manifest'),api:f.api,download:async(route,file)=>writeFile(file,Buffer.from('{}'),{flag:'wx'})}),/digest|size/);
    f.metadata.commit.tree.sha='c'.repeat(40);await assert.rejects(fetchPublishedDelivery('1.2.3',{outputDirectory:path.join(f.temporary,'tree'),api:f.api,download:f.download}),/tree/);f.metadata.commit.tree.sha='b'.repeat(40);
    let releases=0;const api=async route=>{const value=await f.api(route);if(route.includes('/releases/tags/')&&++releases>=3)return {...value,id:999};return value;};
    await assert.rejects(fetchPublishedDelivery('1.2.3',{outputDirectory:path.join(f.temporary,'changed'),api,download:f.download}),/changed/);
});

test('the historical three-gate exception needs explicit promotion and every pinned baseline hash',()=>{
    assert.deepEqual(deliveryGateKinds(LEGACY_DELIVERY),RELEASE_GATE_KINDS);assert.deepEqual(deliveryGateKinds(LEGACY_DELIVERY,{allowBaselineHistory:true}),['core','browser','contract']);
    for(const key of Object.keys(LEGACY_DELIVERY)){const altered={...LEGACY_DELIVERY,[key]:'0'.repeat(LEGACY_DELIVERY[key].length)};assert.deepEqual(deliveryGateKinds(altered,{allowBaselineHistory:true}),RELEASE_GATE_KINDS);}
    assert.deepEqual(deliveryGateKinds(LEGACY_DELIVERY,{allowBaselineHistory:'true'}),RELEASE_GATE_KINDS);
});

test('a newly published three-gate bundle cannot use the baseline exception',async()=>{
    const f=await fixture(),bytes=Buffer.from(JSON.stringify({format:'model-lens-release-evidence',version:1,status:'passed',repository:'koviankevin/tflite-explorer',release:f.release,gates:['core','browser','contract'].map(kind=>({kind}))}));
    f.payloads.set('release-gates.json',bytes);Object.assign(f.metadata.release.assets.find(a=>a.name==='release-gates.json'),{size:bytes.length,digest:'sha256:'+sha256(bytes)});
    await assert.rejects(fetchPublishedDelivery('1.2.3',{outputDirectory:path.join(f.temporary,'three-gates'),api:f.api,download:f.download}),/candidate/);
});
