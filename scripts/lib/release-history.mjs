import {mkdir,lstat,readFile,copyFile} from 'node:fs/promises';
import {constants} from 'node:fs';
import {createWriteStream} from 'node:fs';
import {spawn,execFileSync} from 'node:child_process';
import {Transform} from 'node:stream';
import {pipeline} from 'node:stream/promises';
import path from 'node:path';
import {buildDestination,verifyArtifact,buildEvent,sha256} from './release-artifact.mjs';
import {ghJSON,fileSHA256,validateDelivery,PAGES_WORKFLOW} from './pages-release.mjs';

const repository='repos/koviankevin/tflite-explorer/',MAX_BYTES=512*1024**2,BOT='github-actions[bot]';
const HEX64=/^[a-f0-9]{64}$/;
function unreleased(){const error=Error('Retained core has no complete immutable published release; interrupted publication must be resolved first.');error.code='UNRELEASED_CORE';return error;}
function checkReference(ref){
    const allowed=['version','build','source','manifestSHA256','sha256','bytes'];
    if(!ref||typeof ref!=='object'||Array.isArray(ref)||Object.keys(ref).some(k=>!allowed.includes(k))||typeof ref.version!=='string'||!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/.test(ref.version)||typeof ref.build!=='string'||!/^[a-f0-9]{16}$/.test(ref.build)||typeof ref.source!=='string'||!/^[a-f0-9]{40}$/.test(ref.source)||typeof ref.manifestSHA256!=='string'||!HEX64.test(ref.manifestSHA256)||ref.sha256!==undefined&&(typeof ref.sha256!=='string'||!HEX64.test(ref.sha256))||ref.bytes!==undefined&&(!Number.isSafeInteger(ref.bytes)||ref.bytes<=0||ref.bytes>MAX_BYTES))throw Error('Invalid immutable release reference.');
}

async function streamAsset(route,filename,expectedBytes){
    let bytes=0,timer;
    const child=spawn(process.env.GH_BIN||'gh',['api',route,'-H','Accept: application/octet-stream'],{windowsHide:true,stdio:['ignore','pipe','pipe']});child.stderr.resume();
    const completed=new Promise((resolve,reject)=>{child.once('error',reject);child.once('close',code=>code===0?resolve():reject(Error(`Release asset download failed (exit ${code}).`)));});
    const limit=new Transform({transform(chunk,encoding,done){bytes+=chunk.length;done(bytes>expectedBytes?Error('Release asset exceeds its declared size.'):null,chunk);}});
    timer=setTimeout(()=>child.kill(),90000);
    try{await Promise.all([pipeline(child.stdout,limit,createWriteStream(filename,{flags:'wx'})),completed]);}
    catch(error){child.kill();await completed.catch(()=>{});throw error;}
    finally{clearTimeout(timer);}
}

function extractArchive(archive,directory,entries=null){
    // Validate every entry before extracting any of them. No archive code runs.
    const script="import sys,zipfile,pathlib,stat,json\nz=zipfile.ZipFile(sys.argv[1]); a=z.infolist(); names=[f.filename for f in a]; expected=json.loads(sys.argv[3])\nassert 0<len(a)<=1000 and len(set(n.casefold() for n in names))==len(names) and sum(f.file_size for f in a)<=512*1024*1024\nassert expected is None or set(names)==set(expected)\nreserved={'CON','PRN','AUX','NUL'}|{'COM'+str(i) for i in range(1,10)}|{'LPT'+str(i) for i in range(1,10)}\nfor f in a:\n n=f.filename; parts=n.split('/'); mode=stat.S_IFMT(f.external_attr>>16)\n assert n and not n.startswith('/') and '\\\\' not in n and ':' not in n and '\\x00' not in n and not f.is_dir() and mode in (0,stat.S_IFREG)\n assert all(p not in ('','.','..') and not p.endswith(('.',' ')) and p.split('.')[0].upper() not in reserved for p in parts)\n assert n not in ('release-manifest.json','release-gates.json') or f.file_size<=4*1024*1024\n assert not n.endswith('.sha256') or f.file_size<=1024\nassert 'release-manifest.json' in names and z.testzip() is None\nz.extractall(sys.argv[2])";
    try{execFileSync(process.env.PYTHON_BIN||(process.platform==='win32'?'python':'python3'),['-I','-c',script,archive,directory,JSON.stringify(entries)],{windowsHide:true,timeout:30000,stdio:['ignore','pipe','pipe']});}
    catch{throw Error('Unsafe release archive: path, entry, inflation or CRC.');}
}

// This is a retention-only recovery path for a core already referenced by the
// live site. It does not qualify a failed run for promotion or publish a Release.
export async function recoverPreparedCore(reference,{outputDirectory,api=ghJSON,download=streamAsset}={}){
    checkReference(reference);
    if(typeof outputDirectory!=='string'||!outputDirectory.trim())throw Error('An explicit fresh history directory is required.');
    const output=await buildDestination(outputDirectory);
    try{await lstat(output);throw Error('History output already exists.');}catch(error){if(error.code!=='ENOENT')throw error;}
    const listing=await api(repository+'actions/workflows/verified-pages.yml/runs?event=workflow_dispatch&branch=main&head_sha='+reference.source+'&per_page=100');
    if(!Array.isArray(listing?.workflow_runs)||listing.total_count!==listing.workflow_runs.length||listing.total_count>100)throw Error('Incomplete prepared-history workflow listing.');
    const candidates=listing.workflow_runs.filter(run=>run.path===PAGES_WORKFLOW&&run.event==='workflow_dispatch'&&run.head_branch==='main'&&run.head_sha===reference.source&&run.status==='completed');
    // Prefer the most recent fully prepared run, without silently choosing a
    // different source, expired artifact or incomplete rerun.
    candidates.sort((a,b)=>b.id-a.id);
    let selected;
    for(const item of candidates){
        if(!Number.isSafeInteger(item.id)||item.id<=0)throw Error('Invalid prepared-history run ID.');
        const route=repository+'actions/runs/'+item.id,run=await api(route);
        if(run.id!==item.id||run.path!==PAGES_WORKFLOW||run.event!=='workflow_dispatch'||run.head_branch!=='main'||run.head_sha!==reference.source||run.status!=='completed'||run.repository?.full_name!=='koviankevin/tflite-explorer'||run.head_repository?.full_name!==run.repository.full_name||!Number.isSafeInteger(run.repository.id)||run.repository.id<=0||run.head_repository.id!==run.repository.id||!Number.isSafeInteger(run.run_attempt)||run.run_attempt<1)throw Error('Untrusted prepared-history workflow source.');
        const [jobs,artifacts]=await Promise.all([api(route+'/attempts/'+run.run_attempt+'/jobs?per_page=100'),api(route+'/artifacts?per_page=100')]);
        if(!Array.isArray(jobs?.jobs)||jobs.total_count!==jobs.jobs.length||jobs.total_count>100||!Array.isArray(artifacts?.artifacts)||artifacts.total_count!==artifacts.artifacts.length||artifacts.total_count>100)throw Error('Incomplete prepared-history job/artifact listing.');
        const preparations=jobs.jobs.filter(j=>j.name==='prepare');
        if(preparations.length!==1)throw Error('Missing or ambiguous preparation job.');
        const job=preparations[0];if(job.conclusion!=='success')continue;
        if(job.status!=='completed'||job.run_id!==run.id||job.run_attempt!==run.run_attempt||job.head_sha!==reference.source)throw Error('Preparation source or attempt mismatch.');
        const matches=artifacts.artifacts.filter(a=>a.name==='release-delivery');
        if(matches.length!==1)throw Error('Missing or ambiguous prepared delivery.');
        const artifact=matches[0],started=Date.parse(job.started_at),ended=Date.parse(job.completed_at),created=Date.parse(artifact.created_at),expires=Date.parse(artifact.expires_at);
        if(!Number.isSafeInteger(artifact.id)||artifact.id<=0||artifact.expired!==false||!Number.isSafeInteger(artifact.size_in_bytes)||artifact.size_in_bytes<=0||artifact.size_in_bytes>MAX_BYTES||!/^sha256:[a-f0-9]{64}$/.test(artifact.digest||'')||![started,ended,created,expires].every(Number.isFinite)||created<started||created>ended||expires<=Date.now()||artifact.workflow_run?.id!==run.id||artifact.workflow_run.head_branch!=='main'||artifact.workflow_run.head_sha!==reference.source||artifact.workflow_run.repository_id!==run.repository.id||artifact.workflow_run.head_repository_id!==run.repository.id)throw Error('Prepared delivery provenance, attempt, expiry or digest differs.');
        selected={run,artifact};break;
    }
    if(!selected)throw Error('No successful preparation can recover the live core; retain the current site and restore a verified backup.');
    const {run,artifact}=selected;
    const commit=await api(repository+'git/commits/'+reference.source);
    if(commit.sha!==reference.source||!/^[a-f0-9]{40}$/.test(commit.tree?.sha||''))throw Error('Prepared core Git tree unavailable.');
    await buildEvent({event:'create_intent',operation:'recover-live-core',path:output,kind:'temporary',producer:'scripts/lib/release-history.mjs',purpose:'Retain an already-live namespace after interrupted publication; never promote it',inputs:[reference.source,String(run.id)],cleanup_condition:'Keep failed staging and authenticated delivery until the replacement snapshot is inspected.'});
    await mkdir(path.dirname(output),{recursive:true});await mkdir(output);
    const archive=path.join(output,'prepared-delivery.zip');await download(repository+'actions/artifacts/'+artifact.id+'/zip',archive,artifact.size_in_bytes);
    const info=await lstat(archive);if(!info.isFile()||info.isSymbolicLink()||info.size!==artifact.size_in_bytes||'sha256:'+await fileSHA256(archive)!==artifact.digest)throw Error('Prepared delivery download size/digest mismatch.');
    const zipName=`model-lens-public-${reference.version}-${reference.build}.zip`,delivery=path.join(output,'delivery');await mkdir(delivery);
    extractArchive(archive,delivery,[zipName,zipName+'.sha256','release-manifest.json','release-gates.json']);
    const receiptBytes=await readFile(path.join(delivery,'release-gates.json')),receipt=JSON.parse(receiptBytes),zipSHA=await fileSHA256(path.join(delivery,zipName));
    const checked=await validateDelivery(delivery,{source:reference.source,build:reference.build,manifest:reference.manifestSHA256,receipt:sha256(receiptBytes),zip:zipSHA});
    if(receipt.repository!=='koviankevin/tflite-explorer'||reference.sha256!==undefined&&reference.sha256!==zipSHA||reference.bytes!==undefined&&(await lstat(checked.zip)).size!==reference.bytes)throw Error('Prepared core receipt or pinned ZIP differs.');
    const directory=path.join(output,'core');await mkdir(directory);extractArchive(checked.zip,directory);
    const manifest=await verifyArtifact(directory,{publicOnly:true,requireClean:true,expectedCommit:reference.source});
    if(manifest.release.version!==reference.version||manifest.release.buildId!==reference.build||manifest.release.source.tree!==commit.tree.sha)throw Error('Prepared core identity or Git tree mismatch.');
    const provenance={kind:'github-prepared-retention',retentionOnly:true,runId:run.id,attempt:run.run_attempt,artifactId:artifact.id,artifactDigest:artifact.digest,source:reference.source,zipSHA256:zipSHA,manifestSHA256:reference.manifestSHA256};
    await buildEvent({event:'verified',operation:'recover-live-core',path:output,buildId:reference.build,...provenance});
    return {directory,manifest,manifestSHA256:reference.manifestSHA256,provenance};
}

export async function fetchRetainedCore(reference,options){
    try{return await fetchReleasedCore(reference,options);}
    catch(error){if(error.code!=='UNRELEASED_CORE')throw error;return recoverPreparedCore(reference,options);}
}

export async function fetchReleasedCore(reference,{outputDirectory,api=ghJSON,download=streamAsset}={}){
    checkReference(reference);
    if(typeof outputDirectory!=='string'||!outputDirectory.trim())throw Error('An explicit fresh history directory is required.');
    const output=await buildDestination(outputDirectory);
    try{await lstat(output);throw Error('History output already exists.');}catch(error){if(error.code!=='ENOENT')throw error;}
    const tag='v'+reference.version;
    const [release,ref,commit]=await Promise.all([api(repository+'releases/tags/'+encodeURIComponent(tag),{allow404:true}),api(repository+'git/ref/tags/'+encodeURIComponent(tag),{allow404:true}),api(repository+'git/commits/'+reference.source)]);
    if(ref&&(ref.object?.type!=='commit'||ref.object.sha!==reference.source)||commit.sha!==reference.source||!/^[a-f0-9]{40}$/.test(commit.tree?.sha||'')||release&&(release.tag_name!==tag||typeof release.draft!=='boolean'||release.author?.login!==BOT||!Number.isSafeInteger(release.id)||release.id<=0||!Array.isArray(release.assets)||release.assets.length>20))throw Error('Untrusted published release or Git tag/source.');
    if(!release||!ref||release.draft)throw unreleased();
    const zipName=`model-lens-public-${reference.version}-${reference.build}.zip`,assets=release.assets.filter(a=>a.name===zipName);
    if(!assets.length)throw unreleased();
    if(assets.length!==1)throw Error('Duplicate immutable ZIP asset.');
    const asset=assets[0];
    if(!Number.isSafeInteger(asset.id)||asset.id<=0||asset.state!=='uploaded'||asset.uploader?.login!==BOT||!Number.isSafeInteger(asset.size)||asset.size<=0||asset.size>MAX_BYTES||!/^sha256:[a-f0-9]{64}$/.test(asset.digest||'')||reference.sha256!==undefined&&asset.digest!=='sha256:'+reference.sha256||reference.bytes!==undefined&&asset.size!==reference.bytes)throw Error('Release asset provenance, size or digest differs.');
    await buildEvent({event:'create_intent',operation:'fetch-release-history',path:output,kind:'temporary',producer:'scripts/lib/release-history.mjs',purpose:'Read-only verified public core for immutable namespace retention',inputs:[tag,reference.source],cleanup_condition:'Keep failed staging and immutable downloaded archives until the candidate snapshot is inspected or superseded.'});
    await mkdir(path.dirname(output),{recursive:true});await mkdir(output);
    const archive=path.join(output,zipName);await download(repository+'releases/assets/'+asset.id,archive,asset.size);
    const info=await lstat(archive);if(!info.isFile()||info.isSymbolicLink()||info.size!==asset.size)throw Error('Downloaded release size mismatch.');
    const archiveSHA=await fileSHA256(archive);if('sha256:'+archiveSHA!==asset.digest)throw Error('Downloaded release digest mismatch.');
    const directory=path.join(output,'core');await mkdir(directory);extractArchive(archive,directory);
    const manifestBytes=await readFile(path.join(directory,'release-manifest.json'));if(sha256(manifestBytes)!==reference.manifestSHA256)throw Error('Retained core manifest differs from its immutable reference.');
    const manifest=await verifyArtifact(directory,{publicOnly:true,requireClean:true,expectedCommit:reference.source});
    if(manifest.release.version!==reference.version||manifest.release.buildId!==reference.build||manifest.release.source.tree!==commit.tree.sha)throw Error('Retained core identity or Git tree mismatch.');
    const provenance={kind:'github-release',releaseId:release.id,assetId:asset.id,tag,source:reference.source,zipSHA256:archiveSHA,zipBytes:asset.size,manifestSHA256:reference.manifestSHA256};
    await buildEvent({event:'verified',operation:'fetch-release-history',path:output,buildId:reference.build,...provenance});
    return {directory,manifest,manifestSHA256:reference.manifestSHA256,provenance};
}

// Promotion uses only a complete immutable Release. CI recovery is deliberately
// absent here; an interrupted or draft publication is never a rollback target.
export async function fetchPublishedDelivery(version,{outputDirectory,api=ghJSON,download=streamAsset}={}){
    if(typeof version!=='string'||version.length>128||!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/.test(version)||typeof outputDirectory!=='string'||!outputDirectory.trim())throw Error('A fixed published version and fresh delivery directory are required.');
    const output=await buildDestination(outputDirectory);
    try{await lstat(output);throw Error('Published delivery output already exists.');}catch(error){if(error.code!=='ENOENT')throw error;}
    const tag='v'+version,[release,ref]=await Promise.all([api(repository+'releases/tags/'+encodeURIComponent(tag),{allow404:true}),api(repository+'git/ref/tags/'+encodeURIComponent(tag),{allow404:true})]);
    if(!release||release.tag_name!==tag||release.draft!==false||release.author?.login!==BOT||!Number.isSafeInteger(release.id)||release.id<=0||ref?.object?.type!=='commit'||typeof ref.object.sha!=='string'||!/^[a-f0-9]{40}$/.test(ref.object.sha)||!Array.isArray(release.assets)||release.assets.length!==4||new Set(release.assets.map(a=>a.id)).size!==4||new Set(release.assets.map(a=>a.name)).size!==4)throw Error('Promotion requires a complete bot Release and immutable source tag.');
    for(const asset of release.assets)if(!Number.isSafeInteger(asset.id)||asset.id<=0||asset.state!=='uploaded'||asset.uploader?.login!==BOT||!Number.isSafeInteger(asset.size)||asset.size<=0||asset.size>(asset.name.endsWith('.zip')?MAX_BYTES:asset.name.endsWith('.sha256')?1024:4*1024**2)||!/^sha256:[a-f0-9]{64}$/.test(asset.digest||''))throw Error('Promotion asset provenance, size or digest differs.');
    const manifestAsset=release.assets.find(a=>a.name==='release-manifest.json');if(!manifestAsset)throw Error('Published core manifest is missing.');
    await buildEvent({event:'create_intent',operation:'fetch-published-delivery',path:output,kind:'temporary',producer:'scripts/lib/release-history.mjs',purpose:'Immutable public Release selected for explicit promotion/rollback',inputs:[tag,ref.object.sha],cleanup_condition:'Retain the authenticated original four assets and failed staging for review.'});
    await mkdir(path.dirname(output),{recursive:true});await mkdir(output);const deliveryDirectory=path.join(output,'delivery');await mkdir(deliveryDirectory);
    async function getAsset(asset){
        const file=path.join(deliveryDirectory,asset.name);await download(repository+'releases/assets/'+asset.id,file,asset.size);const info=await lstat(file);
        if(!info.isFile()||info.isSymbolicLink()||info.size!==asset.size||'sha256:'+await fileSHA256(file)!==asset.digest)throw Error('Published delivery download size/digest mismatch.');return file;
    }
    const manifestFile=await getAsset(manifestAsset),manifestSHA256=manifestAsset.digest.slice(7),manifest=JSON.parse(await readFile(manifestFile,'utf8')),r=manifest.release;
    if(r?.version!==version||r.source?.commit!==ref.object.sha)throw Error('Published manifest does not name its fixed version/tag.');
    const zipName=`model-lens-public-${version}-${r.buildId}.zip`,names=[zipName,zipName+'.sha256','release-manifest.json','release-gates.json'];
    if(release.assets.some(a=>!names.includes(a.name)))throw Error('Published delivery contains unexpected assets.');
    const zipAsset=release.assets.find(a=>a.name===zipName),reference={version,build:r.buildId,source:ref.object.sha,manifestSHA256,sha256:zipAsset.digest.slice(7),bytes:zipAsset.size};checkReference(reference);
    const core=await fetchReleasedCore(reference,{outputDirectory:path.join(output,'verified-core'),api,download});
    await copyFile(path.join(path.dirname(core.directory),zipName),path.join(deliveryDirectory,zipName),constants.COPYFILE_EXCL);
    for(const name of [zipName+'.sha256','release-gates.json'])await getAsset(release.assets.find(a=>a.name===name));
    const expected={source:reference.source,build:reference.build,manifest:manifestSHA256,receipt:release.assets.find(a=>a.name==='release-gates.json').digest.slice(7),zip:reference.sha256};
    const checked=await validateDelivery(deliveryDirectory,expected,{allowBaselineHistory:true});
    if(checked.receipt.repository!=='koviankevin/tflite-explorer')throw Error('Published evidence belongs to another repository.');
    const [confirmedRelease,confirmedTag]=await Promise.all([api(repository+'releases/tags/'+encodeURIComponent(tag)),api(repository+'git/ref/tags/'+encodeURIComponent(tag))]);
    if(confirmedRelease.id!==release.id||confirmedRelease.tag_name!==tag||confirmedRelease.draft!==false||confirmedRelease.author?.login!==BOT||confirmedTag.object?.type!=='commit'||confirmedTag.object.sha!==reference.source||confirmedRelease.assets?.length!==4||checked.assets.some(a=>!confirmedRelease.assets.some(b=>b.name===a.name&&b.state==='uploaded'&&b.uploader?.login===BOT&&b.size===a.bytes&&b.digest==='sha256:'+a.sha256)))throw Error('Published version changed while preparing promotion.');
    const provenance={...core.provenance,kind:'github-published-promotion',assets:checked.assets};
    await buildEvent({event:'verified',operation:'fetch-published-delivery',path:output,buildId:r.buildId,source:reference.source});
    return {...core,deliveryDirectory,receipt:checked.receipt,assets:checked.assets,expected,provenance};
}
