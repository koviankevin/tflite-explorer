import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile,mkdir,mkdtemp,rm} from 'node:fs/promises';
import path from 'node:path';
import {copyWebTree} from '../scripts/lib/build-profile.mjs';
import {root,sha256,within} from '../scripts/lib/release-artifact.mjs';
test('web packaging copies the exact pinned CPU WASM binary and license beside its loader',async()=>{
    const parent=path.join(root,'test-results');await mkdir(parent,{recursive:true});const destination=await mkdtemp(path.join(parent,'runtime-web-copy-'));assert.ok(within(parent,destination));
    try{const source=path.join(root,'vendor/litert/2.6.0');await copyWebTree(source,destination);const provenance=JSON.parse(await readFile(path.join(source,'provenance.json'),'utf8')),entry=provenance.files.find(f=>f.path.endsWith('.wasm')),bytes=await readFile(path.join(destination,entry.path));assert.equal(bytes.length,entry.bytes);assert.equal(sha256(bytes),entry.sha256);assert.deepEqual([...bytes.subarray(0,8)],[0,97,115,109,1,0,0,0]);assert.ok((await readFile(path.join(destination,'LICENSE'),'utf8')).includes('Apache License'));}
    finally{assert.ok(within(parent,destination));await rm(destination,{recursive:true,force:true});}
});
