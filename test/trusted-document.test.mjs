import test from 'node:test';import assert from 'node:assert/strict';import {mkdtemp,writeFile,unlink,rmdir} from 'node:fs/promises';import os from 'node:os';import path from 'node:path';
import {trustedDocument} from './browser/trusted-document.mjs';import {sha256} from '../scripts/lib/release-artifact.mjs';
const policy="default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; connect-src 'self'",html=Buffer.from(`<meta http-equiv="Content-Security-Policy" content="${policy}"><script src="/app.js"></script>`);
const manifest=body=>({release:{distribution:'public',extension:null,source:{dirty:false}},files:[{path:'index.html',bytes:body.length,sha256:sha256(body)}]});
async function fixture(body,run){const directory=await mkdtemp(path.join(os.tmpdir(),'model-lens-trusted-document-'));try{await writeFile(path.join(directory,'index.html'),body);await run(directory);}finally{await unlink(path.join(directory,'index.html'));await rmdir(directory);}}
test('trusted document supplies exact authenticated bytes/CSP and never intercepts assets,foreign origins,queries or POST',()=>fixture(html,async directory=>{
 const doc=await trustedDocument(directory,manifest(html)),calls=[];const route=(url,method='GET',type='document')=>({request:()=>({url:()=>url,method:()=>method,resourceType:()=>type}),fulfill:async response=>calls.push(response)});
 for(const args of [['http://foreign.invalid/'],['http://127.0.0.1:1/app.js','GET','script'],['http://127.0.0.1:1/?secret=x'],['http://127.0.0.1:1/','POST']])assert.equal(await doc.handle(route(...args),'http://127.0.0.1:1'),false);
 assert.equal(calls.length,0);assert.equal(await doc.handle(route('http://127.0.0.1:1/'),'http://127.0.0.1:1'),true);assert.deepEqual(calls[0].body,html);assert.equal(calls[0].headers['Content-Security-Policy'],policy);assert.equal(doc.proof.deliveries,1);assert.equal(doc.proof.httpDocumentTransportVerified,false);
}));
test('changed HTML,private build,dirty source and absent policy are refused instead of silently repaired',()=>fixture(html,async directory=>{
 for(const mutate of [m=>m.files[0].sha256='0'.repeat(64),m=>m.release.distribution='internal',m=>m.release.source.dirty=true,m=>m.files.push({...m.files[0]})]){const m=manifest(html);mutate(m);await assert.rejects(trustedDocument(directory,m));}
 const absent=Buffer.from('<html>no CSP</html>');await writeFile(path.join(directory,'index.html'),absent);await assert.rejects(trustedDocument(directory,manifest(absent)),/CSP/);
}));
