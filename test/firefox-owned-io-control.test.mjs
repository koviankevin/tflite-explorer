import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import vm from 'node:vm';
import {ownedIOControlDocument} from './browser/firefox-owned-io-control.mjs';
import {PAYLOAD_BYTES} from './browser/firefox-payload-memory-control.mjs';
const helper=await readFile(new URL('../src/runtime-io.js',import.meta.url),'utf8');
function fixture(){
    const elements=Object.fromEntries(['choose-model','choose-input','model','input','start','stop','clear','download','result','meta'].map(id=>[id,{files:[],dataset:{},textContent:'',disabled:false,click(){},set value(v){this._value=v;if(v==='')this.files=[];},get value(){return this._value||'';}}])),workers=[],urls=new Map(),revoked=[],timers=[];let serial=0,now=1000;
    class Worker{constructor(url){this.url=url;workers.push(this);}postMessage(data,transfer){this.payload=structuredClone(data,{transfer});}terminate(){assert.equal(this.onmessage,null);assert.equal(this.onerror,null);this.closed=true;}}
    const html=ownedIOControlDocument(helper),scope={Blob,Uint8Array,ArrayBuffer,structuredClone,Worker,Date:{now:()=>now},URL:{createObjectURL:b=>{const url='blob:control-'+(++serial);urls.set(url,b);return url;},revokeObjectURL:u=>revoked.push(u)},document:{getElementById:id=>elements[id],createElement:()=>({click(){}})},setTimeout:(fn,ms)=>timers.push({fn,ms})};vm.runInNewContext(html.match(/<script>([\s\S]*)<\/script>/)[1],scope);
    return {elements,workers,urls,revoked,timers,html,rows:()=>JSON.parse(elements.result.textContent),meta:()=>JSON.parse(elements.meta.textContent),advance:ms=>now+=ms,async runWorker(w){const code=await urls.get(w.url).text(),realm={Uint8Array,ArrayBuffer,postMessage:(data,transfer)=>{w.result=structuredClone(data,{transfer});}};vm.runInNewContext(code,realm);await realm.onmessage({data:w.payload});w.onmessage({data:w.result});return code;}};
}

test('raw IO control uses actual zeroed transfer across three Workers and one natural download',async()=>{
    const f=fixture();f.elements.model.files=[new Blob([new Uint8Array(PAYLOAD_BYTES).fill(25)])];let previous;
    for(let i=0;i<3;i++){f.elements.input.files=[new Blob([new Uint8Array(PAYLOAD_BYTES).fill(7)])];f.elements.start.onclick();const w=f.workers.at(-1);if(previous)assert.equal(previous.byteLength,0);const code=await f.runWorker(w);assert.doesNotMatch(code,/WebAssembly|loadLiteRt|executeRuntime|fetch\(/);const row=f.rows().at(-1);assert.equal(row.error,null);assert.equal(row.zeroBefore,true);assert.equal(row.reused,i>0);assert.equal(row.blobBytes,2*PAYLOAD_BYTES);previous=w.result.io;f.elements.stop.onclick();assert.equal(f.elements.input.files.length,0);assert.equal(w.closed,true);}
    f.elements.download.onclick();assert.equal(previous.byteLength,0);const url=f.meta().urls[0],blob=f.urls.get(url.url),bytes=new Uint8Array(await blob.arrayBuffer());assert.equal(blob.type,'application/octet-stream');const hash=b=>createHash('sha256').update(b).digest('hex');assert.equal(hash(bytes),hash(Buffer.concat([Buffer.alloc(PAYLOAD_BYTES,7),Buffer.alloc(PAYLOAD_BYTES,8)])));assert.equal(f.timers[0].ms,60000);assert.equal(url.revokedAt,null);f.elements.clear.onclick();assert.equal(f.elements.download.disabled,true);assert.equal(f.elements.model.files.length,0);f.advance(60000);f.timers[0].fn();assert.equal(f.meta().urls[0].revokedAt-f.meta().urls[0].createdAt,60000);assert.ok(f.revoked.includes(url.url));
});

test('builder refuses new imports or script boundaries and starts no inference or external requests',()=>{
    for(const bad of ['unsupported',helper+'\nimport data from "./private.js";',helper+'\n</script>'])assert.throws(()=>ownedIOControlDocument(bad));const html=ownedIOControlDocument(helper);assert.doesNotMatch(html,/WebAssembly\.Instance|loadLiteRt\(|executeRuntime\(|fetch\(/);assert.equal((html.match(/<script>/g)||[]).length,1);
});

test('control Worker rejects uncleared or malformed scratch before returning any IO',async()=>{
    for(const buffer of [new Uint8Array(2*PAYLOAD_BYTES).fill(9).buffer,new ArrayBuffer(8),new SharedArrayBuffer(2*PAYLOAD_BYTES)]){const f=fixture();f.elements.model.files=[new Blob([new Uint8Array(PAYLOAD_BYTES).fill(25)])];f.elements.input.files=[new Blob([new Uint8Array(PAYLOAD_BYTES).fill(7)])];f.elements.start.onclick();const w=f.workers[0];w.payload.ioBuffer=buffer;await f.runWorker(w);assert.match(w.result.error,/scratch/);assert.equal(w.result.io,undefined);f.elements.stop.onclick();}
});
