import {test} from 'node:test';
import assert from 'node:assert/strict';
import {runInNewContext} from 'node:vm';
import {createDOMObservationEngine,registerDOMReader,desktopDOMReader} from './browser/desktop-dom-reader.mjs';
test('the isolated observation channel reads DOM and transports JSON without changing the app document',async()=>{
    const original={textContent:'已選取 3 個 layers',onclick:()=>{}},carriers=[];
    const document={querySelector:s=>{assert.equal(s,'#capture-count');return original;},createElement:tag=>{assert.equal(tag,'output');const n={isConnected:false,textContent:''};carriers.push(n);return n;},appendChild:()=>assert.fail('Reader must not mutate the app document')};
    const isolated=runInNewContext('('+createDOMObservationEngine.toString()+')()',{document});
    const page={locator:selector=>{assert.ok(selector.startsWith('lensobserve='));const encoded=selector.slice('lensobserve='.length);return {textContent:async()=>isolated.query(document,encoded).textContent};}};
    const read=desktopDOMReader(page);
    assert.deepEqual(await read((selector,count)=>({text:document.querySelector(selector).textContent,count,handler:typeof document.querySelector(selector).onclick}),'#capture-count',3),{text:'已選取 3 個 layers',count:3,handler:'function'});
    assert.equal(await read(()=>undefined),undefined);
    assert.equal(original.textContent,'已選取 3 個 layers');assert.ok(carriers.every(c=>!c.isConnected));
    let registration;await registerDOMReader({register:async(...args)=>{registration=args;}});assert.deepEqual(registration,['lensobserve',createDOMObservationEngine,{contentScript:true}]);
});
