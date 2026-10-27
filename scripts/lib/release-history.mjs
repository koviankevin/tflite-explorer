import {mkdir,lstat,readFile} from 'node:fs/promises';
import {createWriteStream} from 'node:fs';
import {spawn,execFileSync} from 'node:child_process';
import {Transform} from 'node:stream';
import {pipeline} from 'node:stream/promises';
import path from 'node:path';
import {buildDestination,verifyArtifact,buildEvent,sha256} from './release-artifact.mjs';
import {ghJSON,fileSHA256} from './pages-release.mjs';

const repository='repos/koviankevin/tflite-explorer/',MAX_BYTES=512*1024**2,BOT='github-actions[bot]';
const HEX64=/^[a-f0-9]{64}$/;
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

function extractArchive(archive,directory){
    // Validate every entry before extracting any of them. No archive code runs.
    const script="import sys,zipfile,pathlib,stat\nz=zipfile.ZipFile(sys.argv[1]); a=z.infolist(); names=[f.filename for f in a]\nassert 0<len(a)<=1000 and len(set(n.casefold() for n in names))==len(names) and sum(f.file_size for f in a)<=512*1024*1024\nreserved={'CON','PRN','AUX','NUL'}|{'COM'+str(i) for i in range(1,10)}|{'LPT'+str(i) for i in range(1,10)}\nfor f in a:\n n=f.filename; parts=n.split('/'); mode=stat.S_IFMT(f.external_attr>>16)\n assert n and not n.startswith('/') and '\\\\' not in n and ':' not in n and '\\x00' not in n and not f.is_dir() and mode in (0,stat.S_IFREG)\n assert all(p not in ('','.','..') and not p.endswith(('.',' ')) and p.split('.')[0].upper() not in reserved for p in parts)\n assert n!='release-manifest.json' or f.file_size<=4*1024*1024\nassert 'release-manifest.json' in names and z.testzip() is None\nz.extractall(sys.argv[2])";
    try{execFileSync(process.env.PYTHON_BIN||(process.platform==='win32'?'python':'python3'),['-I','-c',script,archive,directory],{windowsHide:true,timeout:30000,stdio:['ignore','pipe','pipe']});}
    catch{throw Error('Unsafe release archive: path, entry, inflation or CRC.');}
}

export async function fetchReleasedCore(reference,{outputDirectory,api=ghJSON,download=streamAsset}={}){
    checkReference(reference);
    if(typeof outputDirectory!=='string'||!outputDirectory.trim())throw Error('An explicit fresh history directory is required.');
    const output=await buildDestination(outputDirectory);
    try{await lstat(output);throw Error('History output already exists.');}catch(error){if(error.code!=='ENOENT')throw error;}
    const tag='v'+reference.version;
    const [release,ref,commit]=await Promise.all([api(repository+'releases/tags/'+encodeURIComponent(tag),{allow404:true}),api(repository+'git/ref/tags/'+encodeURIComponent(tag),{allow404:true}),api(repository+'git/commits/'+reference.source)]);
    if(!release||!ref){const error=Error('Retained core has no immutable published release; interrupted publication must be resolved first.');error.code='UNRELEASED_CORE';throw error;}
    if(release.tag_name!==tag||release.draft!==false||release.author?.login!==BOT||!Number.isSafeInteger(release.id)||release.id<=0||ref.object?.type!=='commit'||ref.object.sha!==reference.source||commit.sha!==reference.source||!/^[a-f0-9]{40}$/.test(commit.tree?.sha||'')||!Array.isArray(release.assets)||release.assets.length>20)throw Error('Untrusted published release or Git tag/source.');
    const zipName=`model-lens-public-${reference.version}-${reference.build}.zip`,assets=release.assets.filter(a=>a.name===zipName);
    if(assets.length!==1)throw Error('Missing or duplicate immutable ZIP asset.');
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
