import {test} from 'node:test';
import assert from 'node:assert/strict';

const source=`appendButton(row, desc, doMeasure, "Measure", "measureButton");
function doMeasure() {
  updateAboutMemoryFromReporters();
}
function updateAboutMemoryFromReporters() {
  gMgr.getReports(handleReport, null, displayReports, null, true);
}
`;
function fixture({text='Main Process (pid 100)\n10 MB -- explicit\n20 MB -- resident',missing=false,closeError=false,navigationError=null,url='about:memory',documentURL=url,buttonMissing=false}={}){
    const calls=[],page={on(){},url(){return url;},async goto(target,options){calls.push(['goto',target,options]);if(navigationError)throw navigationError;},locator(selector){return {async evaluate(){assert.equal(selector,'html');calls.push(['documentURL']);return documentURL;},async waitFor(){assert.equal(selector,'#measureButton');calls.push(['nativeReady']);if(buttonMissing)throw Error('Native Measure button missing');},async check(){calls.push(['check',selector]);},async click(){calls.push(['click',selector]);},async innerText(){assert.equal(selector,'body');return text;}};},getByLabel(label){assert.equal(label,'anonymize');return {async check(){calls.push(['check','anonymize']);}};},getByText(){return {first(){return {async waitFor(){if(missing)throw Error('Report not rendered');}};}};},async close(){calls.push(['close']);if(closeError)throw Error('Native page close failed');}};
    return {calls,context:{async newPage(){calls.push(['newPage']);return page;}}};
}

test('source proof recognizes ordinary measurement and rejects explicit collection or unsupported dispatch',async()=>{
    const {memoryReporterSourceProof}=await import('./browser/firefox-native-memory-report.mjs');const proof=memoryReporterSourceProof(source);assert.equal(proof.reporterOnly,true);assert.match(proof.sha256,/^[a-f0-9]{64}$/);
    for(const bad of [source.replace('desc, doMeasure','desc, doGC'),source.replace('updateAboutMemoryFromReporters();','doGC(); updateAboutMemoryFromReporters();'),source.replace('gMgr.getReports(','gMgr.minimizeMemoryUsage('),source.replace('gMgr.getReports(','gMgr.getReportsExtended('),source.replace('gMgr.getReports(','window.windowUtils.garbageCollect(); gMgr.getReports('),'unsupported'])assert.throws(()=>memoryReporterSourceProof(bad));
    assert.throws(()=>memoryReporterSourceProof(' '.repeat(256*1024+1)));
});

test('native snapshot uses one ordinary Measure click, anonymizes, bounds text and closes the page',async()=>{
    const {memoryReporterSourceProof,readFirefoxNativeMemory}=await import('./browser/firefox-native-memory-report.mjs'),f=fixture(),r=await readFirefoxNativeMemory(f.context,memoryReporterSourceProof(source));
    assert.equal(r.status,'passed');assert.equal(r.forcedGC,false);assert.equal(r.measureCalls,1);assert.equal(r.pageClosed,true);assert.match(r.text,/resident/);assert.match(r.sha256,/^[a-f0-9]{64}$/);assert.deepEqual(f.calls,[['newPage'],['goto','about:memory',{waitUntil:'commit',timeout:10000}],['documentURL'],['nativeReady'],['check','#verbose'],['check','anonymize'],['click','#measureButton'],['close']]);assert.equal(r.navigation.documentURL,'about:memory');assert.equal(r.navigation.ready,true);
});

test('lifecycle timeout recovers only after the native URI, DOM URI and Measure button are verified',async()=>{
    const {memoryReporterSourceProof,readFirefoxNativeMemory}=await import('./browser/firefox-native-memory-report.mjs');const error=Object.assign(Error('page.goto: Timeout 10000ms exceeded.'),{name:'TimeoutError'}),f=fixture({navigationError:error}),r=await readFirefoxNativeMemory(f.context,memoryReporterSourceProof(source));assert.equal(r.status,'passed');assert.equal(r.measureCalls,1);assert.equal(r.navigation.timeoutRecovered,true);assert.match(r.navigation.error,/Timeout/);assert.equal(r.pageClosed,true);
});

test('wrong URI, missing native controls, and non-timeout protocol errors cannot become successful measurements',async()=>{
    const {memoryReporterSourceProof,readFirefoxNativeMemory}=await import('./browser/firefox-native-memory-report.mjs');
    for(const options of [{url:'about:blank'},{documentURL:'https://example.invalid/'},{buttonMissing:true},{navigationError:Error('Target page, context or browser has been closed')}]){const f=fixture(options);await assert.rejects(readFirefoxNativeMemory(f.context,memoryReporterSourceProof(source)),error=>{assert.equal(error.firefoxNativeMemory.measureCalls,0);assert.equal(error.firefoxNativeMemory.status,'failed');assert.equal(error.firefoxNativeMemory.pageClosed,true);assert.ok(error.firefoxNativeMemory.navigation);return true;});assert.ok(!f.calls.some(c=>c[0]==='click'));}
});

test('unverified native source is rejected before opening a diagnostic page',async()=>{
    const {readFirefoxNativeMemory}=await import('./browser/firefox-native-memory-report.mjs'),f=fixture();await assert.rejects(readFirefoxNativeMemory(f.context,{reporterOnly:false}),/source|來源/i);assert.deepEqual(f.calls,[]);
});

test('oversized or incomplete native reports fail visibly and still close without retaining the full text',async()=>{
    const {memoryReporterSourceProof,readFirefoxNativeMemory}=await import('./browser/firefox-native-memory-report.mjs');
    for(const options of [{text:'Main Process explicit resident '+ 'x'.repeat(512*1024)},{missing:true},{text:'Main Process: incomplete'}]){const f=fixture(options);await assert.rejects(readFirefoxNativeMemory(f.context,memoryReporterSourceProof(source)),error=>{assert.equal(error.firefoxNativeMemory.status,'failed');assert.equal(error.firefoxNativeMemory.pageClosed,true);assert.equal(error.firefoxNativeMemory.text,undefined);return true;});assert.deepEqual(f.calls.at(-1),['close']);}
});

test('a native page close failure cannot produce a successful snapshot receipt',async()=>{
    const {memoryReporterSourceProof,readFirefoxNativeMemory}=await import('./browser/firefox-native-memory-report.mjs'),f=fixture({closeError:true});await assert.rejects(readFirefoxNativeMemory(f.context,memoryReporterSourceProof(source)),error=>{assert.equal(error.firefoxNativeMemory.status,'failed');assert.equal(error.firefoxNativeMemory.pageClosed,false);return true;});
});
