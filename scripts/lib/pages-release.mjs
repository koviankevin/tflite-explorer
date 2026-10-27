import {readFile,readdir,lstat} from 'node:fs/promises';
import {createReadStream} from 'node:fs';
import {createHash} from 'node:crypto';
import {spawnSync,execFileSync} from 'node:child_process';
import path from 'node:path';
import {safeFile,sha256} from './release-artifact.mjs';
export const PAGES_WORKFLOW='.github/workflows/verified-pages.yml';
export const OFFICIAL_ACTIONS=Object.freeze({checkout:'actions/checkout@11d5960a326750d5838078e36cf38b85af677262',node:'actions/setup-node@49933ea5288caeca8642d1e84afbd3f7d6820020',upload:'actions/upload-artifact@ea165f8d65b6e75b540449e92b4886f43607fa02',download:'actions/download-artifact@d3f86a106a0bac45b974a628896c90dbdf5c8093',deploy:'actions/deploy-pages@d6db90164ac5ed86f2b6aed7e0febac5b3c0c03e'});
export const PAGES_CONDITIONS=Object.freeze({prepare:"${{ github.ref == 'refs/heads/main' && github.repository == 'koviankevin/tflite-explorer' }}",deploy:"${{ github.ref == 'refs/heads/main' && inputs.publish && needs.prepare.result == 'success' }}",verify_live:"${{ inputs.publish && needs.prepare.result == 'success' && needs.deploy.result == 'success' }}",release:"${{ inputs.publish && needs.prepare.result == 'success' && needs.verify_live.result == 'success' }}"});
const equal=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
export async function readWorkflowInventory(directory='.github/workflows'){
    const names=(await readdir(directory)).filter(n=>/\.ya?ml$/i.test(n));
    return Promise.all(names.map(async name=>{const filename=path.join(directory,name),info=await lstat(filename);if(!info.isFile()||info.isSymbolicLink()||info.size>1024**2)throw Error('Workflow must be a bounded regular file.');return {path:'.github/workflows/'+name,text:await readFile(filename,'utf8')};}));
}
export async function validateWorkflowInventory(files){
    const {parseDocument}=await import('yaml');let found=false;
    if(!files.length||files.length>100)throw Error('Invalid workflow inventory.');
    const readOnly=p=>p==='read-all'||p&&typeof p==='object'&&!Array.isArray(p)&&Object.values(p).every(value=>['read','none'].includes(value));
    for(const file of files){
        if(Buffer.byteLength(file.text)>1024**2)throw Error('Oversized workflow.');
        const document=parseDocument(file.text,{uniqueKeys:true,version:'1.2',merge:true});if(document.errors.length||document.warnings.length)throw Error(`Malformed/unsupported workflow YAML: ${file.path}`);
        const value=document.toJS({maxAliasCount:50});
        if(file.path===PAGES_WORKFLOW){validatePagesWorkflow(value);found=true;}
        else if(!readOnly(value?.permissions)||Object.values(value?.jobs||{}).some(job=>job?.permissions!==undefined&&!readOnly(job.permissions)))throw Error(`Unexpected write permission outside the gated release: ${file.path}`);
    }
    if(!found)throw Error('Gated Pages workflow missing.');return true;
}
export function validatePagesWorkflow(w){
    if(!equal(Object.keys(w.on||{}),['workflow_dispatch'])||w.on.workflow_dispatch.inputs?.publish?.type!=='boolean'||w.on.workflow_dispatch.inputs.publish.default!==false||!equal(w.permissions,{'contents':'read'})||w.concurrency?.group!=='pages-production'||w.concurrency['cancel-in-progress']!==false||!equal(Object.keys(w.jobs||{}).sort(),['deploy','prepare','release','verify_live']))throw Error('Invalid Pages workflow entry, permissions or concurrency.');
    const rights={prepare:{contents:'read',actions:'read',pages:'read'},deploy:{contents:'read',actions:'read',pages:'write','id-token':'write'},verify_live:{contents:'read',actions:'read'},release:{contents:'write',actions:'read'}};
    const needs={prepare:undefined,deploy:['prepare'],verify_live:['prepare','deploy'],release:['prepare','verify_live']};
    for(const [name,job] of Object.entries(w.jobs)){
        if(job.if!==PAGES_CONDITIONS[name]||!equal(job.permissions,rights[name])||!equal(job.needs,needs[name])||job['continue-on-error']||!Number.isInteger(job['timeout-minutes'])||job['timeout-minutes']>15||job['runs-on']!=='ubuntu-24.04')throw Error(`Unsafe Pages job ${name}.`);
        if(job.steps.some(s=>s['continue-on-error']||s.uses&&!Object.values(OFFICIAL_ACTIONS).includes(s.uses)))throw Error(`Unpinned/ignored step in ${name}.`);
    }
    const deploy=w.jobs.deploy;
    if(deploy.environment?.name!=='github-pages'||deploy.steps.length!==1||deploy.steps[0].uses!==OFFICIAL_ACTIONS.deploy||deploy.steps[0].with?.artifact_name!=='github-pages')throw Error('Deployment must only promote its gated Pages artifact.');
    for(const job of [w.jobs.prepare,w.jobs.verify_live,w.jobs.release]){
        const checkout=job.steps.find(s=>s.uses===OFFICIAL_ACTIONS.checkout);
        if(checkout?.with?.ref!=='${{ github.sha }}'||checkout.with['persist-credentials']!==false)throw Error('Checkout must be fixed and credential-free.');
        const prepare=job===w.jobs.prepare;
        if(job.steps.length!==(prepare?6:5)||job.steps[0]!==checkout||job.steps[1].uses!==OFFICIAL_ACTIONS.node||job.steps[1].with?.['node-version']!=='22.23.3'||job.steps.filter(s=>s.run).length!==(prepare?2:1))throw Error('Unexpected executable release steps.');
    }
    if(!w.jobs.prepare.steps.some(s=>s.run==='node scripts/prepare-pages-release.mjs')||!w.jobs.verify_live.steps.some(s=>s.run==='node scripts/verify-pages-live.mjs')||!w.jobs.release.steps.some(s=>s.run==='node scripts/publish-release-bundle.mjs'))throw Error('Required verification entry missing.');
    const p=w.jobs.prepare.steps;
    if(p[2].run!=='npm ci --ignore-scripts'||p[3].id!=='prepare'||p[3].run!=='node scripts/prepare-pages-release.mjs'||p[4].uses!==OFFICIAL_ACTIONS.upload||p[4].with?.name!=='github-pages'||p[4].with.path!=='${{ steps.prepare.outputs.pages_tar }}'||p[5].uses!==OFFICIAL_ACTIONS.upload||p[5].with?.name!=='release-delivery'||p[5].with.path!=='${{ steps.prepare.outputs.delivery_directory }}')throw Error('Pages must upload only the prepared tar and bundle.');
    for(const key of ['build_id','version','manifest_sha','receipt_sha','zip_sha'])if(w.jobs.prepare.outputs?.[key]!==`\${{ steps.prepare.outputs.${key} }}`)throw Error('Release outputs must come from the gate.');
    for(const [name,script] of [['verify_live','node scripts/verify-pages-live.mjs'],['release','node scripts/publish-release-bundle.mjs']]){
        const steps=w.jobs[name].steps;
        if(steps[2].uses!==OFFICIAL_ACTIONS.download||!equal(steps[2].with,{name:'release-delivery',path:'build/pages-delivery'})||steps[3].run!==script)throw Error('Release consumers must read the current gated bundle.');
        for(const [key,value] of Object.entries({EXPECTED_BUILD:'build_id',EXPECTED_MANIFEST_SHA:'manifest_sha',EXPECTED_RECEIPT_SHA:'receipt_sha',EXPECTED_ZIP_SHA:'zip_sha'}))if(steps[3].env?.[key]!==`\${{ needs.prepare.outputs.${value} }}`)throw Error('Missing trusted delivery hash output.');
    }
    return true;
}
export function assertPagesConfiguration(pages,environment,policies){
    if(pages?.build_type!=='workflow'||environment?.deployment_branch_policy?.custom_branch_policies!==true||environment.deployment_branch_policy.protected_branches!==false||policies?.total_count!==1||policies.branch_policies?.length!==1||policies.branch_policies[0].name!=='main'||policies.branch_policies[0].type!=='branch')throw Error('Pages must use Actions and allow only the main branch environment.');
}
export function checkDispatchContext(env=process.env){
    if(env.GITHUB_ACTIONS!=='true'||env.GITHUB_EVENT_NAME!=='workflow_dispatch'||env.GITHUB_REF!=='refs/heads/main'||env.GITHUB_REPOSITORY!=='koviankevin/tflite-explorer'||!/^[a-f0-9]{40}$/.test(env.GITHUB_SHA||'')||!['true','false'].includes(env.PUBLISH_SITE))throw Error('Only a main-branch workflow_dispatch may prepare this release.');
}
export function assertExpectedBuild(publish,expected,actual){if(publish==='true'&&(!/^[a-f0-9]{16}$/.test(expected||'')||expected!==actual))throw Error('Publish needs the exact build ID from a successful dry run.');}
export function immutableGateEvidence(receipt){const {preparedDirectory,verifiedAt,...evidence}=receipt;return {...evidence,format:'model-lens-release-evidence'};}
export function ghJSON(route,{allow404=false}={}){
    if(!/^repos\/[\w.-]+\/[\w.-]+\//.test(route))throw Error('Only repository API reads are allowed.');
    const r=spawnSync(process.env.GH_BIN||'gh',['api',route],{encoding:'utf8',timeout:30000,maxBuffer:8*1024**2,windowsHide:true});
    if(r.status===0)return JSON.parse(r.stdout);
    if(allow404&&/HTTP 404/.test(r.stderr||''))return null;
    throw Error(`GitHub metadata unavailable for ${route}: ${(r.stderr||r.error?.message||'unknown').slice(0,500)}`);
}
export function assertVersionAvailable(manifest,assets,api=ghJSON){
    const repo=process.env.GITHUB_REPOSITORY||'koviankevin/tflite-explorer',tag=`v${manifest.release.version}`;
    const ref=api(`repos/${repo}/git/ref/tags/${encodeURIComponent(tag)}`,{allow404:true});
    if(ref&&(ref.object?.type!=='commit'||ref.object.sha!==manifest.release.source.commit))throw Error('Version tag already names another source; choose a new version.');
    const release=api(`repos/${repo}/releases/tags/${encodeURIComponent(tag)}`,{allow404:true});
    if(!release)return {tag,exists:false};
    if(!ref)throw Error('Published release has no matching version tag.');
    if(release.draft||release.assets?.length!==assets.length||assets.some(a=>!release.assets.some(b=>b.name===a.name&&b.size===a.bytes&&b.digest===`sha256:${a.sha256}`)))throw Error('Published version is immutable; its source/assets differ.');
    return {tag,exists:true,url:release.html_url};
}
export async function fileSHA256(filename){const h=createHash('sha256');for await(const chunk of createReadStream(filename))h.update(chunk);return h.digest('hex');}
export async function validateDelivery(directory,expected){
    for(const [key,pattern] of Object.entries({source:/^[a-f0-9]{40}$/,build:/^[a-f0-9]{16}$/,manifest:/^[a-f0-9]{64}$/,receipt:/^[a-f0-9]{64}$/,zip:/^[a-f0-9]{64}$/}))if(!pattern.test(expected?.[key]||''))throw Error(`Missing trusted ${key} output.`);
    const names=await readdir(directory);for(const name of names){safeFile(name);const info=await lstat(path.join(directory,name));if(!info.isFile()||info.isSymbolicLink())throw Error('Delivery entries must be regular files.');}
    const manifestBytes=await readFile(path.join(directory,'release-manifest.json')),receiptBytes=await readFile(path.join(directory,'release-gates.json'));
    if(manifestBytes.length>4*1024**2||receiptBytes.length>4*1024**2||sha256(manifestBytes)!==expected.manifest||sha256(receiptBytes)!==expected.receipt)throw Error('Delivery metadata hash mismatch.');
    const manifest=JSON.parse(manifestBytes),receipt=JSON.parse(receiptBytes),r=manifest.release;
    if(r?.distribution!=='public'||r.extension||r.source?.dirty!==false||r.source.commit!==expected.source||r.buildId!==expected.build||receipt.format!=='model-lens-release-evidence'||receipt.version!==1||receipt.status!=='passed'||!equal(receipt.release,r)||!equal(receipt.gates?.map(g=>g.kind),['core','browser','contract']))throw Error('Delivery is not the verified public candidate.');
    const zipName=`model-lens-public-${r.version}-${r.buildId}.zip`,allowed=[zipName,zipName+'.sha256','release-manifest.json','release-gates.json'].sort();if(!equal([...names].sort(),allowed))throw Error('Unexpected/missing delivery files.');
    const zip=path.join(directory,zipName),size=(await lstat(zip)).size;if(size>512*1024**2||await fileSHA256(zip)!==expected.zip)throw Error('ZIP hash/size mismatch.');
    const checksum=await readFile(zip+'.sha256','utf8');if(checksum!==`${expected.zip}  ${zipName}\n`)throw Error('Checksum sidecar differs.');
    // Read/CRC/hash every member without extracting or executing the ZIP.
    const script="import zipfile,sys,json,hashlib\nz=zipfile.ZipFile(sys.argv[1]); m=json.load(open(sys.argv[2],encoding='utf-8')); a=z.infolist()\nassert 0<len(a)<=1000 and sum(f.file_size for f in a)<=512*1024*1024\nassert len(set(f.filename for f in a))==len(a) and set(f.filename for f in a)==set([f['path'] for f in m['files']]+['release-manifest.json'])\nassert z.testzip() is None and json.loads(z.read('release-manifest.json'))==m\nfor f in m['files']:\n b=z.read(f['path']); assert len(b)==f['bytes'] and hashlib.sha256(b).hexdigest()==f['sha256']\n";
    execFileSync(process.env.PYTHON_BIN||(process.platform==='win32'?'python':'python3'),['-I','-c',script,zip,path.join(directory,'release-manifest.json')],{timeout:30000,windowsHide:true,stdio:['pipe','pipe','pipe']});
    const assets=[];for(const name of allowed){const p=path.join(directory,name);assets.push({name,bytes:(await lstat(p)).size,sha256:await fileSHA256(p)});}
    return {manifest,receipt,zip,assets};
}
export function expectedDelivery(env=process.env){return {source:env.GITHUB_SHA,build:env.EXPECTED_BUILD,manifest:env.EXPECTED_MANIFEST_SHA,receipt:env.EXPECTED_RECEIPT_SHA,zip:env.EXPECTED_ZIP_SHA};}
