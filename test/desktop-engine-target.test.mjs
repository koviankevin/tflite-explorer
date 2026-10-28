import {test} from 'node:test';
import assert from 'node:assert/strict';
import {verifyCandidateHTTP} from '../scripts/lib/desktop-engine-target.mjs';
import {sha256} from '../scripts/lib/release-artifact.mjs';
const data=new Map([['index.html',Buffer.from('<html>candidate</html>')],['src/app.js',Buffer.from('export const value=1;')]]),manifest={files:[...data].map(([path,bytes])=>({path,bytes:bytes.length,sha256:sha256(bytes)}))};
const read=async(_base,name)=>({bytes:data.get(name||'index.html'),contentType:!name||name.endsWith('.html')?'text/html':'text/javascript'});
test('candidate HTTP binds actual root and every served core byte and MIME to the verified manifest',async()=>{
    const r=await verifyCandidateHTTP('http://127.0.0.1:1234/tflite-explorer/',manifest,read);assert.equal(r.files,2);assert.equal(r.kind,'candidate-core');assert.equal(r.rootEntrySHA256,manifest.files[0].sha256);assert.equal(r.checks.length,2);
    for(const bad of [async(b,n)=>({...await read(b,n),bytes:Buffer.from('altered')}),async(b,n)=>({...await read(b,n),contentType:'text/plain'})])await assert.rejects(verifyCandidateHTTP('http://127.0.0.1:1234/tflite-explorer/',manifest,bad));
    await assert.rejects(verifyCandidateHTTP('http://127.0.0.1:1234/tflite-explorer/',manifest,async(b,n)=>n===''?{...await read(b,n),bytes:Buffer.from('wrong root')}:read(b,n)));
});
