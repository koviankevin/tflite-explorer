// Local isolated rehearsal only. Never changes GitHub Pages or the user's server.
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,readFile,writeFile,rename} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {createServer} from 'node:http';
import {once} from 'node:events';
import path from 'node:path';
import {createStaticServer} from './serve.mjs';
import {root,verifyArtifact,gitSource} from './lib/release-artifact.mjs';
const args=process.argv.slice(2);if(args.length!==3)throw Error('Usage: node scripts/drill-release-rollback.mjs previous.zip candidate.zip new-report.json');
const output=path.resolve(args[2]);await mkdir(path.dirname(output),{recursive:true});await writeFile(output,'',{flag:'wx'});
await mkdir(path.join(root,'build/qa'),{recursive:true});const temporary=await mkdtemp(path.join(root,'build/qa/rollback-'));
const report={format:'model-lens-rollback-drill',version:1,status:'failed',startedAt:new Date().toISOString(),source:gitSource(),temporary,steps:[],scope:'Isolated loopback HTTP version directories and atomic pointer; no production switch or browser data migration.'};
let server;
const digest=bytes=>createHash('sha256').update(bytes).digest('hex');
try{
    const versions=[];
    for(const [i,zip] of args.slice(0,2).entries()){
        const directory=path.join(temporary,`version-${i}`);await mkdir(directory);
        const python=process.env.PYTHON_BIN||(process.platform==='win32'?'python':'python3');
        const script="import sys,zipfile,pathlib,stat\nz=zipfile.ZipFile(sys.argv[1]); dest=pathlib.Path(sys.argv[2]).resolve(); a=z.infolist(); names=[f.filename for f in a]\nassert 0<len(a)<=1000 and len(set(n.lower() for n in names))==len(names) and sum(f.file_size for f in a)<=512*1024*1024\nfor f in a:\n p=pathlib.PurePosixPath(f.filename); assert not p.is_absolute() and '..' not in p.parts and '\\\\' not in f.filename and ':' not in f.filename and not f.is_dir() and not stat.S_ISLNK(f.external_attr>>16)\nassert z.testzip() is None\nz.extractall(dest)";
        execFileSync(python,['-I','-c',script,path.resolve(zip),directory],{timeout:30000,windowsHide:true});
        const manifest=await verifyArtifact(directory,{publicOnly:true,requireClean:true});versions.push({directory,manifest});
        report.steps.push({operation:'verified-zip',zip:path.basename(zip),zipSHA256:digest(await readFile(zip)),release:manifest.release,files:manifest.files.length});
    }
    assert.notEqual(versions[0].manifest.release.buildId,versions[1].manifest.release.buildId,'Need two distinct releases.');
    const handlers=new Map(versions.map(v=>[v.manifest.release.buildId,createStaticServer(v.directory)])),pointer=path.join(temporary,'current.json');
    const activate=async version=>{
        const m=await verifyArtifact(version.directory,{publicOnly:true,requireClean:true});
        await writeFile(pointer+'.next',JSON.stringify({buildId:m.release.buildId}),{flag:'wx',flush:true});await rename(pointer+'.next',pointer);
    };
    await activate(versions[0]);
    server=createServer(async(req,res)=>{
        try{
            const url=new URL(req.url,'http://localhost'),match=/^\/versions\/([a-f0-9]{16})(\/.*)$/.exec(url.pathname);
            if(match&&handlers.has(match[1])){req.url=match[2]+url.search;handlers.get(match[1]).emit('request',req,res);return;}
            if(url.pathname==='/'||url.pathname==='/index.html'){const active=JSON.parse(await readFile(pointer,'utf8'));res.writeHead(302,{Location:`/versions/${active.buildId}/`,'Cache-Control':'no-store'});res.end();return;}
            res.writeHead(404);res.end();
        }catch{res.writeHead(500);res.end();}
    });server.listen(0,'127.0.0.1');await once(server,'listening');const base=`http://127.0.0.1:${server.address().port}`;
    const verifyHTTP=async(version,operation)=>{
        const redirect=await fetch(base+'/',{redirect:'manual'});assert.equal(redirect.status,302);assert.equal(redirect.headers.get('location'),`/versions/${version.manifest.release.buildId}/`);
        const prefix=base+redirect.headers.get('location'),actual=await (await fetch(prefix+'release-manifest.json')).json();assert.deepEqual(actual,version.manifest);
        const pending=[...version.manifest.files];await Promise.all(Array.from({length:4},async()=>{while(pending.length){const f=pending.pop(),r=await fetch(prefix+f.path);assert.equal(r.status,200,f.path);const bytes=Buffer.from(await r.arrayBuffer());assert.equal(bytes.length,f.bytes,f.path);assert.equal(digest(bytes),f.sha256,f.path);}}));
        report.steps.push({operation,buildId:version.manifest.release.buildId,files:actual.files.length,allHTTPHashesMatch:true});
    };
    await verifyHTTP(versions[0],'initial');
    const appPath=path.join(versions[1].directory,'src/app.js'),saved=await readFile(appPath);await writeFile(appPath,'tampered candidate');
    await assert.rejects(activate(versions[1]),/完整性/);assert.equal(JSON.parse(await readFile(pointer)).buildId,versions[0].manifest.release.buildId);await writeFile(appPath,saved);report.steps.push({operation:'reject-tampered-candidate',previousPointerPreserved:true});
    await activate(versions[1]);await verifyHTTP(versions[1],'upgrade');
    // An already-open version URL keeps its own lazy imports across activation.
    const old=versions[0].manifest.files.find(f=>f.path==='src/app.js'),oldResponse=await fetch(`${base}/versions/${versions[0].manifest.release.buildId}/src/app.js`);assert.equal(digest(Buffer.from(await oldResponse.arrayBuffer())),old.sha256);report.steps.push({operation:'old-version-lazy-asset-still-consistent'});
    await activate(versions[0]);await verifyHTTP(versions[0],'rollback');report.status='passed';
}catch(error){report.error=error.stack||String(error);process.exitCode=1;}
finally{if(server){server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}report.finishedAt=new Date().toISOString();await writeFile(output,JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify({status:report.status,report:output,temporary}));}
