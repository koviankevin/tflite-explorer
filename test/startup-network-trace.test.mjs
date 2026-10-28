import {test} from 'node:test';
import assert from 'node:assert/strict';
import {startupNetworkTrace} from './browser/startup-network-trace.mjs';
const base='https://example.invalid/tool/',req=(name,{method='GET',type='script'}={})=>({url:()=>new URL(name,base).href,method:()=>method,resourceType:()=>type,failure:()=>({errorText:'net::ERR_HTTP2_PROTOCOL_ERROR'})});
test('startup evidence distinguishes intentionally held graph code from failed and pending main modules',()=>{
    let time=0;const t=startupNetworkTrace(base,{now:()=>time++}),main=req('versions/a/src/app.js?secret=query'),zip=req('versions/a/vendor/netron/zip.js'),dependency=req('versions/a/src/dependency.js');
    t.request(main);t.response({request:()=>main,status:()=>200,headers:()=>({'content-type':'text/javascript','authorization':'do not record'})});t.finished(main);t.hold(zip);t.request(dependency);t.failed(dependency);
    const s=t.snapshot();assert.deepEqual(s.requests.map(r=>[r.path,r.state,r.held]),[['versions/a/src/app.js','finished',false],['versions/a/vendor/netron/zip.js','pending',true],['versions/a/src/dependency.js','failed',false]]);assert.equal(s.requests[0].status,200);assert.equal(s.requests[2].failure,'net::ERR_HTTP2_PROTOCOL_ERROR');assert.ok(s.requests[0].finishedMs>s.requests[0].responseMs);assert.ok(!JSON.stringify(s).includes('secret')&&!JSON.stringify(s).includes('authorization'));
    t.finished(zip);assert.equal(s.requests[1].state,'pending','prior evidence must be an independent snapshot');assert.equal(t.snapshot().requests[1].state,'finished');
});

test('diagnostic text strips URL credentials, query values and external file/body URLs',()=>{
    const t=startupNetworkTrace(base),r=req('a.js');r.failure=()=>({errorText:'failed https://user:password@example.invalid/tool/a.js?private=secret#fragment'});t.request(r);t.failed(r);
    t.console({type:()=> 'error',text:()=> 'blocked data:private-payload file:///company/model.bin https://other.invalid/private.js?token=hidden'});
    const s=t.snapshot();assert.equal(s.requests[0].failure,'failed https://example.invalid/tool/a.js');assert.ok(s.consoleErrors[0].message.includes('[external URL]'));for(const value of ['password','secret','fragment','private-payload','company','hidden'])assert.ok(!JSON.stringify(s).includes(value));
    for(const b of [base+'?secret',base+'#hash','https://user:password@example.invalid/tool/'])assert.throws(()=>startupNetworkTrace(b),/bounded/);
});
test('trace refuses foreign, uploaded, model fetch and post-startup requests and bounds diagnostics',()=>{
    const t=startupNetworkTrace(base,{requestLimit:2,consoleLimit:1});
    for(const r of [req('https://other.invalid/model.js'),req('/toolbox/x.js'),req('model.tflite',{type:'fetch'}),req('file.js',{method:'POST'})])t.request(r);
    assert.equal(t.snapshot().requests.length,0);const a=req('a.js');t.request(a);t.request(a);t.request(req('b.js'));t.request(req('c.js'));t.console({type:()=> 'warning',text:()=> 'ignore'});t.console({type:()=> 'error',text:()=> 'x'.repeat(2000)});t.console({type:()=> 'error',text:()=> 'limit'});t.stop();t.request(req('user-model.js'));t.console({type:()=> 'error',text:()=> 'private after startup'});
    const s=t.snapshot();assert.equal(s.requests.length,2);assert.equal(s.consoleErrors.length,1);assert.equal(s.consoleErrors[0].message.length,512);assert.equal(s.truncated,true);assert.ok(s.stoppedAtMs>=0);assert.ok(!JSON.stringify(s).includes('private'));
    for(const options of [{requestLimit:0},{requestLimit:129},{consoleLimit:0},{consoleLimit:33}])assert.throws(()=>startupNetworkTrace(base,options),/bounded/);
});
