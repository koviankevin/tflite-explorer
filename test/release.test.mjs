import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdir,mkdtemp,writeFile,readFile,lstat} from 'node:fs/promises';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {spawnSync} from 'node:child_process';
import {buildSite} from '../scripts/build.mjs';
import {packageRelease} from '../scripts/package-release.mjs';
import {root,verifyArtifact,buildDestination,buildEvent,safeFile,sha256} from '../scripts/lib/release-artifact.mjs';
import {readProfile,copyWebTree} from '../scripts/lib/build-profile.mjs';
import {validateDialectAdapters} from '../src/mlir-dialect-contract.js';
import {releaseRows} from '../src/release-info.js';
import {parseMLIR} from '../src/mlir-engine.js';
import {exportMLIR} from '../src/mlir-export.js';

test('fixed public/internal packages preserve extensions and enforce release integrity',async t=>{
    await mkdir(path.join(root,'test-results'),{recursive:true});
    await buildEvent({event:'create_intent',operation:'release-tests',path:'test-results/release-*',kind:'temporary',producer:'test/release.test.mjs',purpose:'Isolated public/internal packaging acceptance',cleanup_condition:'Keep failed cases or inspection builds; artifacts can be regenerated from this test.'});
    const temporary=await mkdtemp(path.join(root,'test-results','release-'));
    const publicPath=path.join(temporary,'public'),internalPath=path.join(temporary,'internal'),extension=path.join(temporary,'extension');
    await mkdir(extension);
    await writeFile(path.join(extension,'index.js'),`import {label} from './label.js';\nexport const mlirDialects=[{namespace:'company',interfaceVersion:1,describeOperation:()=>[{name:'build extension',type:'string',value:label}]}];\n`);
    await writeFile(path.join(extension,'label.js'),`export const label='Internal fixture adapter';\n`);
    const profile={schemaVersion:1,distribution:'internal',name:'測試內網擴充',extensionVersion:'1.2.3',adapterInterfaceVersion:1,dialectDirectory:'./extension'};
    const profilePath=path.join(temporary,'profile.json');await writeFile(profilePath,JSON.stringify(profile));
    const registry=await readFile(path.join(root,'src/mlir-dialect-registry.js'));
    let publicBuild,internalBuild;
    await t.test('public build is self-contained, canonical and bound to source',async()=>{
        publicBuild=await buildSite({output:publicPath});
        const manifest=await verifyArtifact(publicPath,{publicOnly:true});
        assert.equal(manifest.release.distribution,'public');assert.equal(manifest.release.extension,null);
        assert.equal(manifest.release.buildId,publicBuild.release.buildId);
        assert.ok(!manifest.files.some(f=>f.path.includes('internal-dialects')));
        assert.ok((await readFile(path.join(publicPath,'index.html'),'utf8')).includes(`?v=${publicBuild.release.buildId}`));
        assert.ok(manifest.files.filter(f=>f.path.endsWith('.js')).length>50);
        assert.equal(releaseRows(manifest.release).find(r=>r[0]==='發行類型')[1],'公開版');
    });
    await t.test('internal build uses real adapter, search metadata and export/reopen without changing core',async()=>{
        internalBuild=await buildSite({output:internalPath,profile:profilePath});
        const manifest=await verifyArtifact(internalPath);
        assert.equal(manifest.release.distribution,'internal');assert.equal(manifest.release.extension.version,'1.2.3');
        assert.match(manifest.release.extension.sourceHash,/^[a-f0-9]{64}$/);
        assert.notEqual(internalBuild.release.buildId,publicBuild.release.buildId);
        assert.deepEqual(await readFile(path.join(root,'src/mlir-dialect-registry.js')),registry);
        const {mlirDialects}=await import(pathToFileURL(path.join(internalPath,'src/mlir-dialect-registry.js')));
        const metadata=await readFile(path.join(root,'vendor/netron/mlir-metadata.json'),'utf8');
        const index=await parseMLIR(new TextEncoder().encode('%a = "company.input"() : () -> i32\n%b = "company.use"(%a) : (i32) -> i32'),{metadata,dialects:mlirDialects});
        assert.equal(index.graphs[0].graph.nodes[0].attributes.find(a=>a.name==='build extension').value,'Internal fixture adapter');
        const exported=await exportMLIR(index,0,[0,1]);
        const reopened=await parseMLIR(new Uint8Array(await exported.blob.arrayBuffer()),{metadata,dialects:mlirDialects});
        assert.equal(reopened.graphs[0].graph.nodes[1].attributes.find(a=>a.name==='build extension').value,'Internal fixture adapter');
        await assert.rejects(verifyArtifact(internalPath,{publicOnly:true}),/拒絕公開/);
    });
    await t.test('standard ZIP reader checks every CRC and manifest entry',async()=>{
        for(const directory of [publicPath,internalPath]) {
            const result=await packageRelease(directory,{output:path.join(temporary,'packages')});
            const python=process.platform==='win32'?'python':'python3';
            const check=spawnSync(python,['-c','import zipfile,json,sys; z=zipfile.ZipFile(sys.argv[1]); assert z.testzip() is None; m=json.loads(z.read("release-manifest.json")); assert set(z.namelist())==set([f["path"] for f in m["files"]]+["release-manifest.json"]); print(m["release"]["distribution"])',result.file],{encoding:'utf8',windowsHide:true});
            assert.equal(check.status,0,check.stderr || check.error?.message);assert.equal(check.stdout.trim(),result.distribution);
            assert.equal(sha256(await readFile(result.file)),result.sha256);
            assert.ok((await readFile(result.file+'.sha256','utf8')).startsWith(result.sha256));
            await assert.rejects(lstat(result.file+'.partial'),e=>e.code==='ENOENT');
        }
    });
    await t.test('bad profile, foreign source, mutations, stale files and dirty builds cannot publish',async()=>{
        await assert.rejects(verifyArtifact(publicPath,{expectedCommit:'0'.repeat(40)}),/commit/);
        if(publicBuild.release.source.dirty)await assert.rejects(verifyArtifact(publicPath,{requireClean:true}),/未提交/);
        const original=await readFile(path.join(publicPath,'src/app.js'));
        await writeFile(path.join(publicPath,'src/app.js'),'tampered');
        await assert.rejects(verifyArtifact(publicPath),/完整性/);await writeFile(path.join(publicPath,'src/app.js'),original);
        await writeFile(path.join(publicPath,'private-options.js'),'do not ship');
        await assert.rejects(verifyArtifact(publicPath),/清單外/);
        const rebuilt=await buildSite({output:publicPath});assert.equal(rebuilt.release.buildId,publicBuild.release.buildId);
        await assert.rejects(lstat(path.join(publicPath,'private-options.js')),e=>e.code==='ENOENT');
        await verifyArtifact(publicPath,{publicOnly:true});
        await writeFile(profilePath,JSON.stringify({...profile,adapterInterfaceVersion:99}));
        await assert.rejects(buildSite({output:publicPath,profile:profilePath}),/不相容/);
        await verifyArtifact(publicPath,{publicOnly:true});
        await writeFile(profilePath,JSON.stringify(profile));
        await assert.rejects(buildSite({output:'dist',profile:profilePath}),/獨立輸出/);
        await writeFile(path.join(extension,'secret.tflite'),'model');
        await assert.rejects(readProfile(profilePath),/不得放/);
        await assert.rejects(copyWebTree(extension,path.join(temporary,'bad-web')),/含模型/);
    });
    await buildEvent({event:'verified',operation:'release-tests',path:temporary,public:publicBuild.release.buildId,internal:internalBuild.release.buildId});
});

test('release paths and dialect contract reject unsafe or incompatible inputs',async()=>{
    for(const value of ['../outside','src','vendor','.','build','test-results'])await assert.rejects(buildDestination(value),/輸出限於/);
    for(const value of ['../secret','/abs','C:/secret','a\\b','x/../secret','a/','a.'])assert.throws(()=>safeFile(value),/不安全/);
    assert.throws(()=>validateDialectAdapters([{namespace:'company'},{namespace:'company'}]),/重複/);
    assert.throws(()=>validateDialectAdapters([{namespace:'company',interfaceVersion:2}]),/版本/);
    assert.throws(()=>validateDialectAdapters([{namespace:'company',describeOperation:'javascript'}]),/function/);
    assert.throws(()=>releaseRows({schemaVersion:1,distribution:'public'}),/格式/);
});
