import {test} from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {gzipSync} from 'node:zlib';
import {writeFile,readFile,rmdir,lstat,unlink} from 'node:fs/promises';
import path from 'node:path';
import {sha256,buildEvent} from '../scripts/lib/release-artifact.mjs';

const fixture=()=>({version:1,hasMozMallocUsableSize:true,reports:[
    {process:'Main Process (pid 100)',path:'resident',kind:2,units:0,amount:10000,description:'Resident bytes'},
    {process:'Main Process (pid 100)',path:'explicit/js-non-window/runtime',kind:1,units:0,amount:1000,description:'JS bytes'},
    {process:'Main Process (pid 100)',path:'explicit/heap-unclassified',kind:1,units:0,amount:200,description:'Unclassified bytes'},
    {process:'Main Process (pid 100)',path:'heap-overhead-ratio',kind:2,units:3,amount:1250,description:'Percentage, not bytes'}]});

test('native gzip is kept complete with bounded decoding and non-overlapping category totals',async()=>{
    const {parseFirefoxSignalReport}=await import('./browser/firefox-native-signal-report.mjs'),bytes=gzipSync(JSON.stringify(fixture())),r=parseFirefoxSignalReport(bytes,100);
    assert.equal(r.compressedSHA256,sha256(bytes));assert.deepEqual(Buffer.from(r.gzipBase64,'base64'),bytes);assert.equal(r.reportCount,4);assert.equal(r.processes[0].explicitBytes,1200);assert.equal(r.processes[0].otherBytes.resident,10000);assert.equal(r.processes[0].explicitCategories['js-non-window'],1000);
    for(const value of [{...fixture(),version:2},{...fixture(),reports:[]},{...fixture(),reports:[{...fixture().reports[0],amount:Infinity}]}])assert.throws(()=>parseFirefoxSignalReport(gzipSync(JSON.stringify(value)),100));
    assert.throws(()=>parseFirefoxSignalReport(bytes,101));assert.throws(()=>parseFirefoxSignalReport(Buffer.alloc(512*1024+1),100));assert.throws(()=>parseFirefoxSignalReport(gzipSync(Buffer.alloc(16*1024*1024+1)),100));assert.throws(()=>parseFirefoxSignalReport(Buffer.from('not gzip'),100));
});

test('the actual Python signal guard rejects reused/unowned roots and unsupported handlers before sending',async()=>{
    const {FIREFOX_SIGNAL_PYTHON}=await import('./browser/firefox-native-signal-report.mjs');
    const proof={pid:100,startTicks:'42',parentPid:99,marker:'a'.repeat(32),bundle:'/owned/firefox'},observed={pid:100,startTicks:'42',parentPid:99,state:'S',marker:'a'.repeat(32),executable:'/owned/firefox/firefox-bin',caught:(1n<<33n).toString(16)};
    const script=FIREFOX_SIGNAL_PYTHON+'\nx=json.loads(sys.argv[1]);validate_target(x[0],x[1],34);print("validated")';
    const python=process.env.PYTHON_BIN||(process.platform==='win32'?'C:/Users/kovia/.cache/codex-runtimes/codex-primary-runtime/dependencies/python/python.exe':'python3');
    const run=o=>execFileSync(python,['-I','-c',script,JSON.stringify([proof,o])],{encoding:'utf8',windowsHide:true,stdio:['ignore','pipe','pipe']});
    assert.equal(run(observed).trim(),'validated');
    for(const change of [{pid:101},{startTicks:'43'},{parentPid:1},{state:'Z'},{marker:'b'.repeat(32)},{executable:'/other/firefox-bin'},{executable:'/owned/firefox/not-firefox'},{caught:'0'}])assert.throws(()=>run({...observed,...change}));
    assert.match(FIREFOX_SIGNAL_PYTHON,/pidfd_send_signal\(fd, signal\.SIGRTMIN, None, 0\)/);assert.doesNotMatch(FIREFOX_SIGNAL_PYTHON,/SIGRTMIN\s*\+|SIGKILL|SIGTERM/);
});

test('native temp report records flushed intents and removes only unchanged owned bytes after process closure',async()=>{
    const {nativeReportDirectory}=await import('./browser/firefox-native-signal-report.mjs'),events=[],temp=await nativeReportDirectory({log:async e=>{await buildEvent(e);events.push(e);}}),file=path.join(temp.directory,'unified-memory-report-public-100.json.gz'),bytes=gzipSync(JSON.stringify(fixture()));
    assert.deepEqual(events.map(e=>e.event),['create_intent','created']);await temp.prepare(100);assert.equal(events.at(-1).event,'create_intent');await writeFile(file,bytes,{flag:'wx'});const r=await temp.readCompleted(100);assert.equal(r.compressedSHA256,sha256(bytes));
    await assert.rejects(temp.cleanup({browserClosed:false,processCleanup:{allReaped:true}}));assert.deepEqual(await readFile(file),bytes);await temp.cleanup({browserClosed:true,processCleanup:{allReaped:true,remaining:[]}});await temp.cleanup({browserClosed:true,processCleanup:{allReaped:true,remaining:[]}});assert.equal(temp.record.directoryRemoved,true);assert.equal(temp.record.status,'removed');await assert.rejects(readFile(file),{code:'ENOENT'});
    assert.deepEqual(events.map(e=>e.event),['create_intent','created','create_intent','created','delete_intent','removed','delete_intent','removed']);
});

test('native temp cleanup retains changed files and refuses nonempty directories',async()=>{
    const {nativeReportDirectory}=await import('./browser/firefox-native-signal-report.mjs'),temp=await nativeReportDirectory({log:buildEvent}),file=path.join(temp.directory,'unified-memory-report-public-100.json.gz'),bytes=gzipSync(JSON.stringify(fixture()));await temp.prepare(100);await writeFile(file,bytes,{flag:'wx'});await temp.readCompleted(100);await writeFile(file,Buffer.concat([bytes,Buffer.from('changed')]));await assert.rejects(temp.cleanup({browserClosed:true,processCleanup:{allReaped:true,remaining:[]}}),/identity|changed/);
    // Restore the unique test-owned file for a separately documented test cleanup.
    await discardTestFile(file,Buffer.concat([bytes,Buffer.from('changed')]),temp.directory);
    const other=await nativeReportDirectory({log:buildEvent}),unknown=path.join(other.directory,'unknown.txt');await writeFile(unknown,'retain',{flag:'wx'});await assert.rejects(other.cleanup({browserClosed:true,processCleanup:{allReaped:true,remaining:[]}}));assert.equal(await readFile(unknown,'utf8'),'retain');await discardTestFile(unknown,Buffer.from('retain'),other.directory);
});

async function discardTestFile(file,expected,directory){
    const s=await lstat(file);assert.ok(s.isFile()&&!s.isSymbolicLink());assert.deepEqual(await readFile(file),expected);assert.equal(path.dirname(file),directory);
    const e={schema_version:1,task_id:'firefox-native-signal-test',operation_id:'test-cleanup-'+s.ino,artifact_id:'test-owned-'+s.ino,path:file,kind:'temporary',purpose:'Remove exact changed test fixture after refusal assertion',producer:'test/firefox-native-signal.test.mjs',cleanup_condition:'Exact bytes and identity were re-observed after test, no native consumers were launched',size_bytes:s.size,sha256:sha256(expected)};await buildEvent({...e,event:'delete_intent'});await unlink(file);await buildEvent({...e,event:'removed'});await buildEvent({...e,path:directory,event:'delete_intent'});await rmdir(directory);await buildEvent({...e,path:directory,event:'removed'});
}
