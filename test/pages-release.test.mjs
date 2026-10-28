import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile,writeFile,mkdtemp,rm} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import path from 'node:path';
import os from 'node:os';
import {sha256} from '../scripts/lib/release-artifact.mjs';
import {RELEASE_GATE_KINDS} from '../scripts/lib/release-test-plan.mjs';
import {browserRunnerAllowed,ubuntuMirrorText} from '../scripts/install-browser.mjs';
import {validatePagesWorkflow,readWorkflowInventory,validateWorkflowInventory,assertPagesConfiguration,checkDispatchContext,assertExpectedBuild,assertExpectedSite,assertVersionAvailable,validateDelivery,fileSHA256,immutableGateEvidence,assertStaticMime,expectedDelivery} from '../scripts/lib/pages-release.mjs';
const workflow=JSON.parse(await readFile(new URL('../.github/workflows/verified-pages.yml',import.meta.url),'utf8'));
test('browser installer preserves signed apt sources and restricts mirror setup to hosted Ubuntu 24.04',()=>{
 const env={GITHUB_ACTIONS:'true',GITHUB_REPOSITORY:'koviankevin/tflite-explorer'},release='ID=ubuntu\nVERSION_ID="24.04"\n';assert.equal(browserRunnerAllowed(env,'linux',release),true);for(const [e,p,r] of [[{},'linux',release],[env,'win32',release],[{...env,GITHUB_REPOSITORY:'other/repo'},'linux',release],[env,'linux',release.replace('24.04','26.04')]])assert.equal(browserRunnerAllowed(e,p,r),false);
 const before='http://azure.archive.ubuntu.com/ubuntu/ priority:1\nhttp://archive.ubuntu.com/ubuntu\nhttp://security.ubuntu.com/ubuntu\nhttps://packages.microsoft.com/ubuntu/24.04/prod\n',after=ubuntuMirrorText(before);assert.equal(after,'https://archive.ubuntu.com/ubuntu priority:1\nhttps://archive.ubuntu.com/ubuntu\nhttps://security.ubuntu.com/ubuntu\nhttps://packages.microsoft.com/ubuntu/24.04/prod\n');assert.equal(ubuntuMirrorText(after),after);assert.throws(()=>ubuntuMirrorText('x'.repeat(65537)));const changed=structuredClone(workflow);changed.jobs.verify_live.steps[5].run='echo skip browser install';assert.throws(()=>validatePagesWorkflow(changed));
});
test('Pages write permission is reachable only through the successful gate artifact',()=>{
    assert.equal(validatePagesWorkflow(workflow),true);
    for(const change of [w=>w.jobs.deploy.name='deploy',w=>w.jobs.deploy.needs=[],w=>w.jobs.deploy.if='${{ always() }}',w=>w.jobs.prepare.permissions.pages='write',w=>w.jobs.deploy.steps.push({run:'echo unchecked'}),w=>w.jobs.verify_live.needs=['prepare'],w=>w.jobs.release.if='${{ always() }}',w=>w.jobs.prepare.steps[4].with.path='dist',w=>w.jobs.verify_live.steps[3].env.EXPECTED_ZIP_SHA='untrusted',w=>w.jobs.prepare.outputs.build_id='untrusted',w=>w.on.push={},w=>w.jobs.extra={...w.jobs.deploy},w=>w.jobs.release.steps[0].with['persist-credentials']=true]){const w=structuredClone(workflow);change(w);assert.throws(()=>validatePagesWorkflow(w));}
});
test('all other workflows are read-only, including YAML aliases and escaped keys',async()=>{
    const inventory=await readWorkflowInventory();
    assert.equal(await validateWorkflowInventory(inventory),true);
    const own=inventory.find(f=>f.path.endsWith('verified-pages.yml'));
    for(const text of ['permissions: write-all\njobs: {}','permissions: {contents: read}\njobs: {bypass: {permissions: {pages: write}}}','permissions: &bad {pages: write}\njobs: {bypass: {permissions: *bad}}','"permi\\u0073sions": write-all\njobs: {}','permissions: {contents: read}\npermissions: write-all\njobs: {}','permissions: {contents: read}\nshared: &bad {permissions: {pages: write}}\njobs: {bypass: {<<: *bad}}'])await assert.rejects(validateWorkflowInventory([own,{path:'.github/workflows/bypass.yml',text}]));
    assert.equal(await validateWorkflowInventory([own,{path:'.github/workflows/read.yml',text:'permissions: &safe {contents: read}\njobs: {read: {permissions: *safe}}'}]),true);
    const temporary=await mkdtemp(path.join(os.tmpdir(),'workflow-case-unit-'));try{await writeFile(path.join(temporary,'BYPASS.YML'),'permissions: write-all\njobs: {}');const upper=await readWorkflowInventory(temporary);assert.equal(upper.length,1);await assert.rejects(validateWorkflowInventory([own,...upper]));}finally{await rm(temporary,{recursive:true,force:true});}
});

test('production-transition drivers are valid and reject execution outside isolated CI before opening a browser',()=>{
    for(const file of ['test/browser/production-transition.mjs','test/browser/transition-control.mjs']){
        assert.doesNotThrow(()=>execFileSync(process.execPath,['--check',file],{windowsHide:true,stdio:['ignore','pipe','pipe']}));
        assert.throws(()=>execFileSync(process.execPath,[file,'start'],{env:{...process.env,GITHUB_ACTIONS:'false'},windowsHide:true,timeout:10000,stdio:['ignore','pipe','pipe']}),error=>error.status!==0&&String(error.stderr).includes('ERR_ASSERTION'));
    }
});
test('legacy Pages, wildcard/tag policies and non-main dispatches are rejected',()=>{
    const pages={build_type:'workflow'},env={deployment_branch_policy:{custom_branch_policies:true,protected_branches:false}},policies={total_count:1,branch_policies:[{name:'main',type:'branch'}]};
    assert.doesNotThrow(()=>assertPagesConfiguration(pages,env,policies));
    assert.throws(()=>assertPagesConfiguration({build_type:'legacy'},env,policies));
    for(const name of ['gh-pages','*'])assert.throws(()=>assertPagesConfiguration(pages,env,{total_count:1,branch_policies:[{name,type:'branch'}]}));
    assert.throws(()=>assertPagesConfiguration(pages,env,{total_count:1,branch_policies:[{name:'main',type:'tag'}]}));
    const context={GITHUB_ACTIONS:'true',GITHUB_EVENT_NAME:'workflow_dispatch',GITHUB_REF:'refs/heads/main',GITHUB_REPOSITORY:'koviankevin/tflite-explorer',GITHUB_SHA:'a'.repeat(40),PUBLISH_SITE:'false'};
    assert.doesNotThrow(()=>checkDispatchContext(context));
    for(const [key,value] of Object.entries({GITHUB_EVENT_NAME:'pull_request',GITHUB_REF:'refs/heads/other',GITHUB_REPOSITORY:'other/repo',PUBLISH_SITE:'true; echo injected'}))assert.throws(()=>checkDispatchContext({...context,[key]:value}));
    assert.doesNotThrow(()=>assertExpectedBuild('false','', 'a'.repeat(16)));assert.throws(()=>assertExpectedBuild('true','', 'a'.repeat(16)));assert.throws(()=>assertExpectedBuild('true','b'.repeat(16),'a'.repeat(16)));
});
test('published tags and asset bytes are immutable',()=>{
    const manifest={release:{version:'0.2.0-preview.7',source:{commit:'a'.repeat(40)}}},assets=[{name:'bundle.zip',bytes:123,sha256:'b'.repeat(64)}];
    assert.equal(assertVersionAvailable(manifest,assets,()=>null).exists,false);
    const ref={object:{type:'commit',sha:'a'.repeat(40)}},release={draft:false,html_url:'https://github.com/example',assets:[{name:'bundle.zip',size:123,digest:'sha256:'+'b'.repeat(64)}]};
    const api=route=>route.includes('/git/ref/')?ref:release;
    assert.equal(assertVersionAvailable(manifest,assets,api).exists,true);
    assert.throws(()=>assertVersionAvailable(manifest,[{...assets[0],sha256:'c'.repeat(64)}],api));
    assert.throws(()=>assertVersionAvailable(manifest,assets,route=>route.includes('/git/ref/')?{object:{type:'commit',sha:'d'.repeat(40)}}:release));
    assert.throws(()=>assertVersionAvailable(manifest,assets,()=>release));
    const evidence={status:'passed',version:1,release:manifest.release,gates:[]};assert.deepEqual(immutableGateEvidence({...evidence,verifiedAt:'first',preparedDirectory:'/first'}),immutableGateEvidence({...evidence,verifiedAt:'second',preparedDirectory:'/second'}));
});

test('promotion keeps controller and core sources separate and cannot rewrite an old Release',()=>{
    const env={GITHUB_ACTIONS:'true',GITHUB_EVENT_NAME:'workflow_dispatch',GITHUB_REF:'refs/heads/main',GITHUB_REPOSITORY:'koviankevin/tflite-explorer',GITHUB_SHA:'a'.repeat(40),PUBLISH_SITE:'false',PROMOTE_VERSION:'0.2.0-preview.7',EXPECTED_CORE_SOURCE:'b'.repeat(40)};
    assert.doesNotThrow(()=>checkDispatchContext(env));assert.equal(expectedDelivery(env).source,env.EXPECTED_CORE_SOURCE);assert.equal(expectedDelivery({GITHUB_SHA:env.GITHUB_SHA}).source,env.GITHUB_SHA);
    for(const value of ['latest','v0.2.0-preview.7','../1.2.3',['1.2.3']])assert.throws(()=>checkDispatchContext({...env,PROMOTE_VERSION:value}));
    const changes=[w=>delete w.on.workflow_dispatch.inputs.promote_version,w=>w.on.workflow_dispatch.inputs.promote_version.default='0.2.0-preview.7',w=>w.jobs.prepare.steps[3].env.PROMOTE_VERSION='untrusted',w=>w.jobs.prepare.outputs.core_source='${{ inputs.promote_version }}',w=>w.jobs.prepare.outputs.promotion='true',w=>w.jobs.verify_live.steps[3].env.EXPECTED_CORE_SOURCE='${{ github.sha }}',w=>w.jobs.verify_live.steps[3].env.CORE_PROMOTION='true',w=>w.jobs.release.if="${{ inputs.publish && needs.prepare.result == 'success' && needs.verify_live.result == 'success' }}"];
    for(const change of changes){const value=structuredClone(workflow);change(value);assert.throws(()=>validatePagesWorkflow(value));}
});

test('a matching core cannot publish an unreviewed complete site or bypass trusted site outputs',()=>{
    const id='a'.repeat(64);assert.doesNotThrow(()=>assertExpectedSite('false','',id));assert.doesNotThrow(()=>assertExpectedSite('true',id,id));
    for(const value of ['',undefined,'a'.repeat(16),'b'.repeat(64),[id]])assert.throws(()=>assertExpectedSite('true',value,id));
    const changes=[w=>delete w.on.workflow_dispatch.inputs.expected_site_id,w=>w.jobs.prepare.steps[3].env.EXPECTED_SITE_ID='untrusted',w=>w.jobs.prepare.outputs.site_id='${{ inputs.expected_site_id }}',w=>w.jobs.prepare.outputs.site_manifest_sha='untrusted',w=>delete w.jobs.verify_live.steps[3].env.EXPECTED_SITE_ID,w=>w.jobs.verify_live.steps[3].env.EXPECTED_SITE_MANIFEST_SHA='untrusted',w=>delete w.jobs.verify_live.steps[6].env.EXPECTED_SITE_ID,w=>w.jobs.verify_live.steps[6].env.MODEL_LENS_SMOKE_DIRECTORY='test-results/fixture'];
    for(const change of changes){const value=structuredClone(workflow);change(value);assert.throws(()=>validatePagesWorkflow(value));}
});
test('browser modules and styles require executable MIME types',()=>{
    assert.doesNotThrow(()=>assertStaticMime('src/app.js','text/javascript; charset=utf-8'));assert.doesNotThrow(()=>assertStaticMime('src/app.css','text/css'));assert.doesNotThrow(()=>assertStaticMime('tools/verify-export.mjs','application/octet-stream'));
    for(const [name,type] of [['src/app.js','application/octet-stream'],['src/app.css','text/plain'],['index.html','application/octet-stream']])assert.throws(()=>assertStaticMime(name,type));
    assert.doesNotThrow(()=>assertStaticMime('versions/'+ 'a'.repeat(16)+'/vendor/netron/flatbuffers.js','application/javascript; charset=utf-8'));assert.doesNotThrow(()=>assertStaticMime('site-manifest.json','application/json'));
    assert.doesNotThrow(()=>assertStaticMime('vendor/litert/2.6.0/litert_wasm_compat_internal.wasm','application/wasm'));assert.throws(()=>assertStaticMime('vendor/litert/runtime.wasm','application/octet-stream'));
    for(const [name,type] of [['versions/'+'a'.repeat(16)+'/src/model-worker.js','application/octet-stream'],['site-manifest.json','text/plain'],['versions/'+'a'.repeat(16)+'/release.json','text/html']])assert.throws(()=>assertStaticMime(name,type));
});
test('delivery consumers verify trusted output hashes, complete ZIP members and source',async()=>{
    const dir=await mkdtemp(path.join(os.tmpdir(),'pages-delivery-unit-'));
    try{
        const release={version:'0.2.0-preview.7',distribution:'public',extension:null,source:{commit:'a'.repeat(40),tree:'b'.repeat(40),dirty:false},buildId:'c'.repeat(16)},body=Buffer.from('fixed public app'),manifest={schemaVersion:1,release,files:[{path:'app.txt',bytes:body.length,sha256:sha256(body)}]};
        const manifestBytes=Buffer.from(JSON.stringify(manifest)),receiptBytes=Buffer.from(JSON.stringify({format:'model-lens-release-evidence',version:1,status:'passed',release,gates:RELEASE_GATE_KINDS.map(kind=>({kind}))}));
        await writeFile(path.join(dir,'release-manifest.json'),manifestBytes);await writeFile(path.join(dir,'release-gates.json'),receiptBytes);
        const zipName=`model-lens-public-${release.version}-${release.buildId}.zip`,zip=path.join(dir,zipName);
        execFileSync(process.env.PYTHON_BIN||(process.platform==='win32'?'python':'python3'),['-I','-c',"import sys,zipfile\nwith zipfile.ZipFile(sys.argv[1],'w') as z:\n z.write(sys.argv[2],'release-manifest.json');z.writestr('app.txt','fixed public app')",zip,path.join(dir,'release-manifest.json')],{windowsHide:true});
        const expected={source:release.source.commit,build:release.buildId,manifest:sha256(manifestBytes),receipt:sha256(receiptBytes),zip:await fileSHA256(zip)};await writeFile(zip+'.sha256',`${expected.zip}  ${zipName}\n`);
        assert.equal((await validateDelivery(dir,expected)).manifest.release.buildId,release.buildId);
        await assert.rejects(validateDelivery(dir,{...expected,source:'d'.repeat(40)}),/candidate/);await assert.rejects(validateDelivery(dir,{...expected,manifest:'e'.repeat(64)}),/hash/);
        await writeFile(path.join(dir,'extra.json'),'{}');await assert.rejects(validateDelivery(dir,expected),/Unexpected/);await rm(path.join(dir,'extra.json'));
        await writeFile(zip,Buffer.from('not a zip'));const bad={...expected,zip:await fileSHA256(zip)};await writeFile(zip+'.sha256',`${bad.zip}  ${zipName}\n`);await assert.rejects(validateDelivery(dir,bad));
    }finally{await rm(dir,{recursive:true,force:true});}
});
