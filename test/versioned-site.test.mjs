import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdir,mkdtemp,readFile,writeFile,lstat,symlink} from 'node:fs/promises';
import {once} from 'node:events';
import {createServer} from 'node:http';
import {spawnSync} from 'node:child_process';
import path from 'node:path';
import {root,writeManifest,sha256} from '../scripts/lib/release-artifact.mjs';
import {createStaticServer} from '../scripts/serve.mjs';
import {composeSite,verifySite,SITE_LIMITS} from '../scripts/lib/versioned-site.mjs';

async function fixture(){await mkdir(path.join(root,'test-results'),{recursive:true});return mkdtemp(path.join(root,'test-results','versioned-site-'));}
async function core(parent,id,{distribution='public',label=id}={}){
    const directory=path.join(parent,id+'-'+label);await mkdir(path.join(directory,'src'),{recursive:true});
    const release={schemaVersion:1,version:'1.0.0-'+id,distribution,extension:distribution==='internal'?{name:'Private fixture',version:id,adapterInterfaceVersion:1,sourceHash:id.repeat(4)}:null,source:{commit:id.repeat(2)+'12345678',tree:'1'.repeat(40),dirty:false},buildId:id};
    const files={'index.html':'<!doctype html><html><head><meta http-equiv="Content-Security-Policy" content="base-uri \'self\'"><script type="module" src="src/app.js"></script></head><body>Model Lens</body></html>','src/app.js':`import './lazy.js'; // ${label}`,'src/lazy.js':`export const version='${label}';`,'src/model-worker.js':`import './lazy.js'; // worker ${label}`,'release.json':JSON.stringify(release)+'\n',LICENSE:'MIT '+label,'LICENSE-Netron.txt':'Upstream MIT','.nojekyll':''};
    if(distribution==='internal'){await mkdir(path.join(directory,'src/internal-dialects'));files['src/internal-dialects/index.js']='export const privateFixture=true;';}
    for(const [name,text] of Object.entries(files))await writeFile(path.join(directory,name),text);
    await writeManifest(directory,release);return directory;
}
const readJSON=async file=>JSON.parse(await readFile(file,'utf8'));

test('real static paths retain legacy and versioned lazy assets through upgrade and rollback',async()=>{
    const temporary=await fixture(),oldId='a'.repeat(16),nextId='b'.repeat(16),old=await core(temporary,oldId),next=await core(temporary,nextId);
    const first=await composeSite({currentDirectory:old,legacyDirectory:old,outputDirectory:path.join(temporary,'first')});
    const upgraded=await composeSite({currentDirectory:next,legacyDirectory:old,retainedDirectories:[old],outputDirectory:path.join(temporary,'upgraded')});
    const rollback=await composeSite({currentDirectory:old,legacyDirectory:old,retainedDirectories:[next],outputDirectory:path.join(temporary,'rollback')});
    let active=first.directory;
    const server=createServer((req,res)=>createStaticServer(active).emit('request',req,res));server.listen(0,'127.0.0.1');await once(server,'listening');
    const base=`http://127.0.0.1:${server.address().port}`;
    try{
        const legacy=await readFile(path.join(old,'src/lazy.js'));
        for(const [site,id] of [[first,oldId],[upgraded,nextId],[rollback,oldId]]){
            active=site.directory;const checked=await verifySite(active);assert.equal(checked.current.release.buildId,id);
            const html=await (await fetch(base+'/')).text();assert.ok(html.includes(`<base href="./versions/${id}/">`));
            assert.equal(sha256(Buffer.from(await (await fetch(base+'/src/lazy.js?v='+oldId)).arrayBuffer())),sha256(legacy));
            assert.equal(sha256(Buffer.from(await (await fetch(base+`/versions/${oldId}/src/lazy.js`)).arrayBuffer())),sha256(legacy));
            assert.equal((await (await fetch(base+'/release.json')).json()).buildId,oldId,'Legacy metadata remains bound to its unchanged root modules.');
        }
        const fresh=await (await fetch(base+`/versions/${nextId}/src/lazy.js`)).text();assert.ok(fresh.includes(nextId));
        assert.equal((await (await fetch(base+'/site-manifest.json')).json()).current.release.buildId,oldId);
    }finally{server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
});

test('recent retention order survives composition independently of lexical build IDs',async()=>{
    const temporary=await fixture(),legacy=await core(temporary,'0'.repeat(16)),current=await core(temporary,'c'.repeat(16)),recent=await core(temporary,'f'.repeat(16)),older=await core(temporary,'a'.repeat(16));
    const snapshot=await composeSite({currentDirectory:current,legacyDirectory:legacy,retainedDirectories:[recent,older],outputDirectory:path.join(temporary,'ordered')});
    assert.deepEqual(snapshot.manifest.retainedBuildIds,['f'.repeat(16),'a'.repeat(16)]);assert.deepEqual((await verifySite(snapshot.directory)).retainedBuildIds,snapshot.manifest.retainedBuildIds);
    assert.equal(snapshot.manifest.versions.length,4);assert.equal(snapshot.manifest.legacyRoot.release.buildId,'0'.repeat(16));
});

test('staging rejects tampering without overwriting an existing site or input',async()=>{
    const temporary=await fixture(),old=await core(temporary,'c'.repeat(16)),next=await core(temporary,'d'.repeat(16)),out=path.join(temporary,'site');
    await composeSite({currentDirectory:next,legacyDirectory:old,retainedDirectories:[old],outputDirectory:out});
    const before=await readFile(path.join(out,'site-manifest.json'));
    await assert.rejects(composeSite({currentDirectory:old,outputDirectory:out}),/exist|存在/i);assert.deepEqual(await readFile(path.join(out,'site-manifest.json')),before);
    const retained=path.join(out,'versions','c'.repeat(16),'src/lazy.js');await writeFile(retained,'changed');await assert.rejects(verifySite(out),/integrity|完整性|hash/i);
    assert.ok((await readFile(path.join(old,'src/lazy.js'),'utf8')).includes('c'.repeat(16)));
    await assert.rejects(composeSite({currentDirectory:old,outputDirectory:path.join(old,'nested')}),/overlap|重疊/i);
});

test('private extensions stay internal and cannot enter a public or mixed distribution site',async()=>{
    const temporary=await fixture(),old=await core(temporary,'1'.repeat(16),{distribution:'internal'}),next=await core(temporary,'2'.repeat(16),{distribution:'internal'}),publicCore=await core(temporary,'3'.repeat(16));
    await assert.rejects(composeSite({currentDirectory:next,legacyDirectory:old,outputDirectory:path.join(temporary,'public')}),/內網|private|public/i);
    const site=await composeSite({currentDirectory:next,legacyDirectory:old,retainedDirectories:[old],outputDirectory:path.join(temporary,'internal'),publicOnly:false});
    assert.equal((await verifySite(site.directory,{publicOnly:false})).current.release.distribution,'internal');
    assert.ok((await readFile(path.join(site.directory,'versions','1'.repeat(16),'src/internal-dialects/index.js'),'utf8')).includes('privateFixture'));
    await assert.rejects(verifySite(site.directory),/內網|private|public/i);
    await assert.rejects(composeSite({currentDirectory:publicCore,legacyDirectory:old,outputDirectory:path.join(temporary,'mixed'),publicOnly:false}),/distribution|發行/i);
});

test('version collisions and limits fail before creating a partial site',async()=>{
    const temporary=await fixture(),id='4'.repeat(16),first=await core(temporary,id,{label:'first'}),collision=await core(temporary,id,{label:'collision'}),out=path.join(temporary,'collision-site');
    await assert.rejects(composeSite({currentDirectory:first,retainedDirectories:[collision],outputDirectory:out}),/collision|衝突/i);await assert.rejects(lstat(out),e=>e.code==='ENOENT');
    const retained=[];for(const digit of ['5','6','7'])retained.push(await core(temporary,digit.repeat(16)));
    await assert.rejects(composeSite({currentDirectory:first,retainedDirectories:retained,outputDirectory:path.join(temporary,'too-many')}),/limit|上限/i);
    const manifest=await readJSON(path.join(first,'release-manifest.json'));manifest.files[0].bytes=SITE_LIMITS.bytes+1;await writeFile(path.join(first,'release-manifest.json'),JSON.stringify(manifest));
    const large=path.join(temporary,'too-large');await assert.rejects(composeSite({currentDirectory:first,outputDirectory:large}),/limit|上限/i);await assert.rejects(lstat(large),e=>e.code==='ENOENT');
});

test('verification rejects unsafe paths, base substitution and unlisted files',async()=>{
    const temporary=await fixture(),input=await core(temporary,'8'.repeat(16)),out=path.join(temporary,'site');await composeSite({currentDirectory:input,outputDirectory:out});
    const html=await readFile(path.join(out,'index.html'),'utf8');await writeFile(path.join(out,'index.html'),html.replace('./versions/','https://invalid.example/'));await assert.rejects(verifySite(out));await writeFile(path.join(out,'index.html'),html);
    await writeFile(path.join(out,'unexpected.json'),'{}');await assert.rejects(verifySite(out),/unlisted|清單外/i);
    const bad=await core(temporary,'9'.repeat(16)),file=path.join(bad,'release-manifest.json'),manifest=await readJSON(file);manifest.files[0].path='../foreign';await writeFile(file,JSON.stringify(manifest));await assert.rejects(composeSite({currentDirectory:bad,outputDirectory:path.join(temporary,'unsafe')}),/路徑|path/i);
});

test('a bad retained payload cannot be activated even with a newly generated outer manifest',async()=>{
    const temporary=await fixture(),input=await core(temporary,'e'.repeat(16)),retained=await core(temporary,'f'.repeat(16)),out=path.join(temporary,'site');await composeSite({currentDirectory:input,retainedDirectories:[retained],outputDirectory:out});
    const name=`versions/${'f'.repeat(16)}/src/lazy.js`,bytes=Buffer.from('new unverified payload');await writeFile(path.join(out,name),bytes);
    const site=await readJSON(path.join(out,'site-manifest.json')),row=site.files.find(f=>f.path===name);row.bytes=bytes.length;row.sha256=sha256(bytes);const {siteId,...body}=site;site.siteId=sha256(Buffer.from(JSON.stringify(body)));await writeFile(path.join(out,'site-manifest.json'),JSON.stringify(site));
    await assert.rejects(verifySite(out),/完整性|integrity|hash/i,'Nested release manifests must still bind immutable payloads.');
});

test('symlink inputs and output parents cannot redirect site assembly',async()=>{
    const temporary=await fixture(),input=await core(temporary,'0'.repeat(16)),alias=path.join(temporary,'input-alias');
    await symlink(input,alias,process.platform==='win32'?'junction':'dir');
    await assert.rejects(composeSite({currentDirectory:alias,outputDirectory:path.join(temporary,'from-alias')}),/symbolic link/i);
    const realParent=path.join(temporary,'real-parent'),parentAlias=path.join(temporary,'parent-alias');await mkdir(realParent);await symlink(realParent,parentAlias,process.platform==='win32'?'junction':'dir');
    await assert.rejects(composeSite({currentDirectory:input,outputDirectory:path.join(parentAlias,'site')}),/symbolic link/i);await assert.rejects(lstat(path.join(realParent,'site')),e=>e.code==='ENOENT');
});

test('the operator CLI assembles and independently verifies the same fresh snapshot',async()=>{
    const temporary=await fixture(),old=await core(temporary,'a1'.repeat(8)),current=await core(temporary,'b2'.repeat(8)),out=path.join(temporary,'cli-site');
    const run=args=>spawnSync(process.execPath,['scripts/compose-site.mjs',...args],{cwd:root,encoding:'utf8',windowsHide:true});
    const missing=run(['--current',current,'--retain',old,'--out',out]);assert.equal(missing.status,1);assert.match(missing.stderr,/explicit --legacy/);await assert.rejects(lstat(out),e=>e.code==='ENOENT');
    const assembled=run(['--current',current,'--legacy',old,'--retain',old,'--out',out]);assert.equal(assembled.status,0,assembled.stderr);assert.equal(JSON.parse(assembled.stdout).currentBuild,'b2'.repeat(8));
    const verified=run(['--verify',out]);assert.equal(verified.status,0,verified.stderr);assert.equal(JSON.parse(verified.stdout).siteId,JSON.parse(assembled.stdout).siteId);
    assert.equal(run(['--verify',out,'--current',current]).status,1);
});
