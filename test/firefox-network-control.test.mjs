import {test} from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {networkControlDocument} from './browser/firefox-network-memory-control.mjs';

function fixture(mode){
    const elements=Object.fromEntries(['start','stop','result'].map(id=>[id,{textContent:'',dataset:{}}])),workers=[],blobs=[],revoked=[];let time=0;
    class Blob{constructor(parts,options){this.parts=parts;this.options=options;blobs.push(this);}}
    class Worker{constructor(url){this.url=url;this.terminations=0;workers.push(this);}terminate(){assert.equal(this.onmessage,null);assert.equal(this.onerror,null);this.terminations++;}}
    const document=networkControlDocument(mode,'https://control.invalid/vendor/runtime.wasm'),script=document.match(/<script>([\s\S]*)<\/script>/)[1];vm.runInNewContext(script,{document:{getElementById:id=>elements[id]},Date:{now:()=>++time},Worker,Blob,URL:{createObjectURL:()=>`blob:synthetic-${workers.length+1}`,revokeObjectURL:url=>revoked.push(url)}});
    return {elements,workers,blobs,revoked,rows:()=>JSON.parse(elements.result.textContent)};
}
test('empty control only posts byte count; native ready/terminate and tiny script URL lifecycle remain distinct',()=>{
    const f=fixture('empty');f.elements.start.onclick();assert.equal(f.workers.length,1);assert.doesNotMatch(f.blobs[0].parts[0],/fetch|WebAssembly|importScripts|model/i);assert.equal(f.elements.result.dataset.phase,'starting');assert.throws(()=>f.elements.start.onclick(),/Invalid control/);f.workers[0].onmessage({data:{bytes:0}});assert.equal(f.elements.result.dataset.phase,'ready');f.elements.stop.onclick();assert.equal(f.workers[0].terminations,1);assert.equal(f.rows()[0].bytes,0);assert.ok(f.rows()[0].terminatedAt>=f.rows()[0].readyAt);assert.equal(f.rows()[0].revoked,true);assert.equal('closed'in f.rows()[0],false,'DOM acknowledgment must not pretend to observe native close');assert.deepEqual(f.revoked,['blob:synthetic-1']);
});
test('fetch control consumes the selected public response but never instantiates runtime or sends its bytes',()=>{
    const f=fixture('fetch');f.elements.start.onclick();const script=f.blobs[0].parts[0];assert.match(script,/fetch\("https:\/\/control\.invalid\/vendor\/runtime\.wasm"\)/);assert.match(script,/arrayBuffer/);assert.match(script,/postMessage\(\{bytes:b\.byteLength\}\)/);assert.doesNotMatch(script,/WebAssembly|importScripts|executeRuntime|compileModel/);new vm.Script(script);f.workers[0].onmessage({data:{bytes:10948854}});f.elements.stop.onclick();assert.equal(f.rows()[0].bytes,10948854);assert.equal(f.workers[0].terminations,1);
});
test('control failures stay visible and invalid mode or non-HTTP source is rejected',()=>{
    const f=fixture('fetch');f.elements.start.onclick();f.workers[0].onmessage({data:{error:'HTTP503'}});assert.equal(f.elements.result.dataset.phase,'error');assert.equal(f.rows()[0].error,'HTTP503');assert.equal(f.rows()[0].bytes,null);f.elements.stop.onclick();assert.equal(f.workers[0].terminations,1);assert.throws(()=>networkControlDocument('unknown','https://control.invalid/a'));assert.throws(()=>networkControlDocument('fetch','file:///private-model'));
});
