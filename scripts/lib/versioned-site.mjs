import {readFile,writeFile,mkdir,readdir,lstat,realpath} from 'node:fs/promises';
import path from 'node:path';
import {buildDestination,verifyArtifact,safeFile,sha256,within,buildEvent} from './release-artifact.mjs';

// Three recent versions, plus a permanent baseline for pre-namespace tabs.
// The baseline also keeps its original root URLs; it is never silently replaced.
export const SITE_LIMITS=Object.freeze({versions:3,files:4096,bytes:512*1024**2,manifestBytes:4*1024**2});
const SITE_FILE='site-manifest.json',HEX=/^[a-f0-9]{16}$/;
const same=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
const row=(name,bytes)=>({path:name,bytes:bytes.length,sha256:sha256(bytes)});
const encoded=value=>Buffer.from(JSON.stringify(value,null,2)+'\n');

async function boundedFiles(directory){
    const files=[];let entries=0;
    async function walk(current,prefix='',depth=0){
        if(depth>32)throw Error('Site directory depth limit exceeded.');
        for(const entry of await readdir(current,{withFileTypes:true})){
            if(++entries>SITE_LIMITS.files*2)throw Error('Site entry limit exceeded.');
            const name=prefix+entry.name,filename=path.join(current,entry.name),info=await lstat(filename);safeFile(name);
            if(info.isSymbolicLink())throw Error('Site cannot contain a symbolic link.');
            if(info.isDirectory())await walk(filename,name+'/',depth+1);
            else if(info.isFile()){files.push(name);if(files.length>SITE_LIMITS.files)throw Error('Site file limit exceeded.');}
            else throw Error('Site entries must be regular files.');
        }
    }
    await walk(directory);return files.sort();
}

async function boundedRead(directory,item){
    const filename=path.join(directory,safeFile(item.path)),info=await lstat(filename);
    if(!info.isFile()||info.isSymbolicLink()||info.size!==item.bytes)throw Error(`Site integrity size mismatch: ${item.path}`);
    const bytes=await readFile(filename);if(sha256(bytes)!==item.sha256)throw Error(`Site integrity hash mismatch: ${item.path}`);return bytes;
}

async function descriptor(directory){
    const rootInfo=await lstat(directory);if(!rootInfo.isDirectory()||rootInfo.isSymbolicLink())throw Error('Release input must be a real directory, not a symbolic link.');
    directory=await realpath(directory);
    const filename=path.join(directory,'release-manifest.json'),info=await lstat(filename);
    if(!info.isFile()||info.isSymbolicLink()||info.size>SITE_LIMITS.manifestBytes)throw Error('Release manifest limit exceeded.');
    const raw=await readFile(filename),manifest=JSON.parse(raw);
    if(manifest.schemaVersion!==1||!HEX.test(manifest.release?.buildId||'')||!Array.isArray(manifest.files)||!manifest.files.length||manifest.files.length>SITE_LIMITS.files)throw Error('Unsupported core release manifest.');
    let bytes=raw.length;
    for(const item of manifest.files){
        safeFile(item.path);if(/^(?:versions(?:\/|$)|site-manifest\.json$)/i.test(item.path))throw Error('Expected a single core release, not a composed site.');
        if(!Number.isSafeInteger(item.bytes)||item.bytes<0||!/^[a-f0-9]{64}$/.test(item.sha256))throw Error('Invalid release file entry.');
        bytes+=item.bytes;if(bytes>SITE_LIMITS.bytes)throw Error('Site byte limit exceeded before reading payloads.');
    }
    return {directory,manifest,raw,bytes,sha256:sha256(raw)};
}

const reference=source=>({release:source.manifest.release,basePath:`versions/${source.manifest.release.buildId}/`,manifestSHA256:source.sha256});
const payload=source=>[...source.manifest.files,row('release-manifest.json',source.raw)];

function rootHTML(bytes,id){
    const html=bytes.toString('utf8');
    if((html.match(/<head>/gi)||[]).length!==1||/<base\b/i.test(html)||!html.includes("base-uri 'self'"))throw Error('Core index must have one head, self base policy and no existing base.');
    return Buffer.from(html.replace(/<head>/i,`<head>\n<base href="./versions/${id}/">`));
}

async function readIndex(source){
    const item=source.manifest.files.find(f=>f.path==='index.html');
    if(!item||item.bytes>2*1024**2)throw Error('Core index size limit exceeded.');
    return boundedRead(source.directory,item);
}

function planFiles(versions,legacy,html){
    const planned=new Map(),keys=new Set();
    function add(name,item,source){
        safeFile(name);if(keys.has(name.toLowerCase()))throw Error(`Site file collision: ${name}`);keys.add(name.toLowerCase());
        planned.set(name,{...item,path:name,source});
    }
    for(const source of versions)for(const item of payload(source))add(reference(source).basePath+item.path,item,{directory:source.directory,path:item.path});
    for(const item of payload(legacy))if(item.path!=='index.html')add(item.path,item,{directory:legacy.directory,path:item.path});
    add('index.html',row('index.html',html),{bytes:html});
    return planned;
}

function budget(files,manifestBytes=SITE_LIMITS.manifestBytes){
    if(files.size+1>SITE_LIMITS.files||[...files.values()].reduce((n,item)=>n+item.bytes,manifestBytes)>SITE_LIMITS.bytes)throw Error('Site file/byte limit exceeded.');
}

async function validateSource(source,{publicOnly}){
    const actual=await boundedFiles(source.directory),expected=payload(source).map(f=>f.path).sort();
    if(!same(actual,expected))throw Error('Release has missing or unlisted files.');
    // Check actual sizes before the shared verifier can allocate payload buffers.
    for(const item of payload(source)){const info=await lstat(path.join(source.directory,item.path));if(!info.isFile()||info.isSymbolicLink()||info.size!==item.bytes)throw Error(`Site integrity size mismatch: ${item.path}`);}
    await verifyArtifact(source.directory,{publicOnly,requireClean:true});
}

export async function composeSite({currentDirectory,retainedDirectories=[],legacyDirectory=currentDirectory,outputDirectory,publicOnly=true}){
    if(typeof outputDirectory!=='string'||!outputDirectory.trim())throw Error('An explicit fresh output directory is required.');
    if(!Array.isArray(retainedDirectories)||retainedDirectories.length>SITE_LIMITS.versions)throw Error('Retained version limit exceeded.');
    const current=await descriptor(currentDirectory),legacy=await descriptor(legacyDirectory),retained=[];
    const sources=new Map();
    function add(source){const id=source.manifest.release.buildId,previous=sources.get(id);if(previous&&previous.sha256!==source.sha256)throw Error(`Immutable build ID collision: ${id}`);sources.set(id,previous||source);return id;}
    const currentId=add(current);
    for(const directory of retainedDirectories){const source=await descriptor(directory),id=add(source);if(id!==currentId&&!retained.includes(id))retained.push(id);}
    if(retained.length+1>SITE_LIMITS.versions)throw Error('Retained version limit exceeded.');
    // Callers list the most recently active version first. Preserve that order
    // so a later update can evict the oldest recent version deterministically.
    add(legacy);
    const versions=[...sources.values()].sort((a,b)=>a.manifest.release.buildId<b.manifest.release.buildId?-1:1);
    for(const source of versions)if(source.manifest.release.distribution!==current.manifest.release.distribution)throw Error('Cannot mix release distributions.');
    const html=rootHTML(await readIndex(current),currentId),planned=planFiles(versions,legacy,html);budget(planned);
    const output=await buildDestination(outputDirectory);
    for(const source of versions)if(source.directory===output||within(source.directory,output)||within(output,source.directory))throw Error('Input and output directories overlap.');
    try{await lstat(output);throw Error('Output directory already exists.');}catch(error){if(error.code!=='ENOENT')throw error;}
    for(const source of versions)await validateSource(source,{publicOnly});
    const body={format:'model-lens-versioned-site',schemaVersion:1,current:reference(current),legacyRoot:reference(legacy),retainedBuildIds:retained,versions:versions.map(reference),files:[...planned.values()].map(({source,...item})=>item)};
    // Use code-point file order, identical across OS locales and JSON readers.
    body.files.sort((a,b)=>a.path<b.path?-1:a.path>b.path?1:0);
    const manifest={...body,siteId:sha256(Buffer.from(JSON.stringify(body)))},manifestBytes=encoded(manifest);budget(planned,manifestBytes.length);
    await buildEvent({event:'create_intent',operation:'compose-site',path:output,kind:'temporary',producer:'scripts/lib/versioned-site.mjs',purpose:'Verified versioned static snapshot with immutable legacy root',inputs:versions.map(s=>s.directory),cleanup_condition:'Retain failed staging and delivered snapshots for inspection; never overwrite an active site.'});
    await mkdir(path.dirname(output),{recursive:true});await mkdir(output);
    for(const item of planned.values()){
        const bytes=item.source.bytes||await boundedRead(item.source.directory,{...item,path:item.source.path});
        const filename=path.join(output,item.path);await mkdir(path.dirname(filename),{recursive:true});await writeFile(filename,bytes,{flag:'wx'});
    }
    await writeFile(path.join(output,SITE_FILE),manifestBytes,{flag:'wx'});
    await verifySite(output,{publicOnly});
    await buildEvent({event:'verified',operation:'compose-site',path:output,siteId:manifest.siteId,buildId:currentId,versions:versions.map(s=>s.manifest.release.buildId)});
    return {directory:output,manifest};
}

export async function verifySite(directory,{publicOnly=true}={}){
    directory=await buildDestination(directory);const info=await lstat(directory);if(!info.isDirectory()||info.isSymbolicLink())throw Error('Site must be a real directory.');
    const manifestFile=path.join(directory,SITE_FILE),manifestInfo=await lstat(manifestFile);
    if(!manifestInfo.isFile()||manifestInfo.isSymbolicLink()||manifestInfo.size>SITE_LIMITS.manifestBytes)throw Error('Site manifest limit exceeded.');
    const manifest=JSON.parse(await readFile(manifestFile,'utf8')),{siteId,...body}=manifest;
    if(!same(Object.keys(body).sort(),['current','files','format','legacyRoot','retainedBuildIds','schemaVersion','versions'].sort())||body.format!=='model-lens-versioned-site'||body.schemaVersion!==1||siteId!==sha256(Buffer.from(JSON.stringify(body)))||!Array.isArray(body.files)||body.files.length>SITE_LIMITS.files||!Array.isArray(body.versions)||!body.versions.length||body.versions.length>SITE_LIMITS.versions+1||!Array.isArray(body.retainedBuildIds)||body.retainedBuildIds.length>=SITE_LIMITS.versions)throw Error('Invalid versioned site manifest.');
    const versions=[];
    for(const entry of body.versions){
        const id=entry.release?.buildId;if(!HEX.test(id||'')||entry.basePath!==`versions/${id}/`||versions.some(s=>s.manifest.release.buildId===id))throw Error('Invalid version path or duplicate build.');
        const source=await descriptor(path.join(directory,entry.basePath));if(!same(reference(source),entry))throw Error('Site manifest and core manifest hash differ.');versions.push(source);
    }
    const current=versions.find(s=>same(reference(s),body.current)),legacy=versions.find(s=>same(reference(s),body.legacyRoot));
    if(!current||!legacy||new Set(body.retainedBuildIds).size!==body.retainedBuildIds.length||body.retainedBuildIds.includes(current.manifest.release.buildId)||body.retainedBuildIds.some(id=>!versions.some(s=>s.manifest.release.buildId===id)))throw Error('Invalid current, legacy or retained release.');
    const expectedIds=new Set([current.manifest.release.buildId,legacy.manifest.release.buildId,...body.retainedBuildIds]);if(versions.length!==expectedIds.size)throw Error('Unlisted version payload.');
    for(const source of versions)if(source.manifest.release.distribution!==current.manifest.release.distribution)throw Error('Cannot mix release distributions.');
    const html=rootHTML(await readIndex(current),current.manifest.release.buildId),planned=planFiles(versions,legacy,html);budget(planned,manifestInfo.size);
    const expected=[...planned.values()].map(({source,...item})=>item).sort((a,b)=>a.path<b.path?-1:a.path>b.path?1:0);
    if(!same(body.files,expected))throw Error('Site manifest integrity differs from its immutable release payloads.');
    const actual=await boundedFiles(directory);if(!same(actual,[SITE_FILE,...planned.keys()].sort()))throw Error('Site contains missing or unlisted files.');
    for(const source of versions)await validateSource(source,{publicOnly});
    for(const item of expected)await boundedRead(directory,item);
    return manifest;
}
