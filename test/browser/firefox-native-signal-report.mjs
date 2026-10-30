// Hosted Linux diagnosis of an empty/public-only browser. Never attach to an
// application browser: the native signal report is complete but not anonymized.
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {randomBytes} from 'node:crypto';
import {mkdtemp,readdir,readFile,lstat,unlink,rmdir,realpath} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {gunzipSync} from 'node:zlib';
import {buildEvent,sha256} from '../../scripts/lib/release-artifact.mjs';

export const FIREFOX_SIGNAL_BASIS={playwright:'1.56.1',revision:'361373160356d92cb5cd4d67783a3806c776ee78',gitBlob:'9eff5c230e6ee9167266cd2c84875420e1b5fd33',url:'https://github.com/mozilla-firefox/firefox/blob/361373160356d92cb5cd4d67783a3806c776ee78/xpcom/base/nsMemoryInfoDumper.cpp',scope:'Pinned upstream ordinary SIGRTMIN handler; runtime handler and exact owned process are checked separately. Not a proof that the installed binary was independently rebuilt from this source.'};

// pidfd binds the send to the opened process. Recheck its identity, bundle,
// marker and caught-signal bit after opening, before the only permitted send.
export const FIREFOX_SIGNAL_PYTHON=`import sys,json,os,signal,pathlib,hashlib
def validate_target(e,o,s):
 assert 0<e['pid'] and 0<e['parentPid'] and len(e['marker'])==32
 assert o['pid']==e['pid'] and o['startTicks']==e['startTicks'] and o['parentPid']==e['parentPid'] and o['state']!='Z', 'Owned root identity changed'
 assert o['marker']==e['marker'], 'Launch marker mismatch'
 executable=pathlib.Path(o['executable'])
 assert executable.parent==pathlib.Path(e['bundle']) and executable.name in ['firefox','firefox-bin'], 'Unowned executable'
 assert int(o['caught'],16)&(1<<(s-1)), 'Native report signal is not caught'
def send_report(e):
 fd=os.pidfd_open(e['pid'],0)
 try:
  root=pathlib.Path('/proc')/str(e['pid']); stat=(root/'stat').read_text(); fields=stat[stat.rfind(')')+1:].split(); status=(root/'status').read_text(); env=(root/'environ').read_bytes().split(b'\\0')
  marker=('MODEL_LENS_PHYSICAL_OWNER='+e['marker']).encode()
  caught=next(line.split()[1] for line in status.splitlines() if line.startswith('SigCgt:'))
  executable=(root/'exe').resolve(strict=True)
  o={'pid':int(stat[:stat.find('(')].strip()),'startTicks':fields[19],'parentPid':int(fields[1]),'state':fields[0],'marker':e['marker'] if marker in env else None,'executable':str(executable),'caught':caught}
  validate_target(e,o,int(signal.SIGRTMIN))
  h=hashlib.sha256()
  with executable.open('rb') as f:
   for chunk in iter(lambda:f.read(1024*1024),b''): h.update(chunk)
  signal.pidfd_send_signal(fd, signal.SIGRTMIN, None, 0)
  return {**o,'signal':int(signal.SIGRTMIN),'signalName':'SIGRTMIN','pidfd':True,'executableSHA256':h.hexdigest(),'sent':True}
 finally: os.close(fd)
`;

export function parseFirefoxSignalReport(compressed,rootPid){
    assert.ok(Buffer.isBuffer(compressed)&&compressed.length>0&&compressed.length<=512*1024,'Native gzip exceeds bounded artifact capacity');
    assert.ok(Number.isSafeInteger(rootPid)&&rootPid>0);const raw=gunzipSync(compressed,{maxOutputLength:16*1024**2}),r=JSON.parse(raw.toString('utf8'));
    assert.equal(r.version,1);assert.equal(typeof r.hasMozMallocUsableSize,'boolean');assert.ok(Array.isArray(r.reports)&&r.reports.length>0&&r.reports.length<=65536,'Invalid native report count');const byProcess=new Map();
    for(const row of r.reports){
        assert.ok(typeof row.process==='string'&&row.process.length<=1024&&typeof row.path==='string'&&row.path.length<=8192&&typeof row.description==='string'&&Number.isSafeInteger(row.amount)&&[0,1,2].includes(row.kind)&&[0,1,2,3].includes(row.units),'Malformed native measurement');
        // The IDL defines a process name, not a mandatory PID grammar. Keep
        // label-only groups intact and never assign them an invented OS PID.
        const match=/\bpid (\d+)\b/.exec(row.process),pid=match?Number(match[1]):null;assert.ok(pid===null||Number.isSafeInteger(pid)&&pid>0,'Native process PID invalid');
        let value=byProcess.get(row.process);if(!value){assert.ok(byProcess.size<128);value={process:row.process,pid,reportCount:0,explicitBytes:0,explicitCategories:{},otherBytes:{}};byProcess.set(row.process,value);}value.reportCount++;
        if(row.units!==0||row.amount<0)continue;
        if(row.path.startsWith('explicit/')){const category=row.path.split('/')[1];value.explicitBytes+=row.amount;value.explicitCategories[category]=(value.explicitCategories[category]||0)+row.amount;}
        else if(!row.path.includes('/'))value.otherBytes[row.path]=(value.otherBytes[row.path]||0)+row.amount;
    }
    assert.ok([...byProcess.values()].some(p=>p.pid===rootPid&&/Main Process/.test(p.process)),'Native report does not contain the owned root');
    return {format:'model-lens-firefox-native-signal',version:1,status:'passed',basis:FIREFOX_SIGNAL_BASIS,forcedGC:false,anonymized:false,nativeRequests:1,compressedBytes:compressed.length,compressedSHA256:sha256(compressed),uncompressedBytes:raw.length,uncompressedSHA256:sha256(raw),gzipBase64:compressed.toString('base64'),reportCount:r.reports.length,processes:[...byProcess.values()],scope:'Complete native gzip from separate empty/public IO browser. Category sums are diagnostic, not original RSS acceptance, isolate heap or attribution.'};
}

const identity=s=>({dev:s.dev,ino:s.ino,size:s.size,mtimeMs:s.mtimeMs});
export async function checkpointNativeEvidence(report,persist){
    if(!report.nativeMemory&&!report.nativeRawReport)return;
    assert.equal(typeof persist,'function','Native evidence must be durably checkpointed before temporary cleanup');
    await persist(report);report.nativeEvidenceCheckpoint='retained-before-file-cleanup';
}
export async function nativeReportDirectory({parent=process.env.RUNNER_TEMP||os.tmpdir(),log=buildEvent}={}){
    const id='native-memory-'+randomBytes(8).toString('hex'),prefix=path.join(path.resolve(parent),'model-lens-native-memory-'),record={id,directory:null,path:null,status:'planned',directoryRemoved:false,events:[]};let directory,file,fileIdentity,expectedSHA,removed=false,directoryRemoved=false,preparedPid;
    const event=async(kind,target,extra={})=>{const e={schema_version:1,task_id:'firefox-native-signal',operation_id:id+'-'+target+'-'+kind,artifact_id:id+'-'+target,event:kind,path:target==='directory'?directory??prefix+'<unique>':file??directory,kind:'temporary',purpose:'One complete non-anonymized native memory report from owned empty/public-only Firefox',producer:'test/browser/firefox-native-signal-report.mjs',inputs:{pid:preparedPid??null},cleanup_condition:'Exact unchanged file identity and SHA after normal browser close and all observed consumers reaped; empty directory only',retain_until:'diagnostic report retained in provider evidence',...extra};await log(e);record.events.push({...e,timestamp:new Date().toISOString()});};
    await event('create_intent','directory');directory=path.resolve(await mkdtemp(prefix));record.directory=directory;await event('created','directory');
    return {directory,record,
        async prepare(pid){assert.ok(!preparedPid&&Number.isSafeInteger(pid)&&pid>0);preparedPid=pid;const initial=await readdir(directory);assert.ok(initial.length<=128&&!initial.some(n=>/^(?:incomplete-)?unified-memory-report-/.test(n)),'Native temp directory already contains reports');record.initialEntries=initial;await event('create_intent','report',{expected_name:`unified-memory-report-<identifier>-${pid}.json.gz`});},
        async readCompleted(pid){
            assert.equal(pid,preparedPid);const names=await readdir(directory);assert.ok(names.length<=128);const matches=names.filter(n=>new RegExp('^unified-memory-report-[a-zA-Z0-9_.-]+-'+pid+'\\.json\\.gz$').test(n));assert.ok(matches.length<=1,'Ambiguous native reports');if(!matches.length)return null;
            file=path.resolve(directory,matches[0]);assert.equal(path.dirname(file),directory);const before=await lstat(file);assert.ok(before.isFile()&&!before.isSymbolicLink()&&before.size>0&&before.size<=512*1024,'Native report file size/kind invalid');const bytes=await readFile(file),after=await lstat(file);assert.deepEqual(identity(after),identity(before),'Native report changed while reading');assert.equal(bytes.length,before.size);fileIdentity=identity(before);expectedSHA=sha256(bytes);record.path=file;record.identity={...fileIdentity};record.bytes=bytes.length;record.sha256=expectedSHA;record.status='captured';await event('created','report',{size_bytes:bytes.length,sha256:expectedSHA});
            try{return parseFirefoxSignalReport(bytes,pid);}catch(error){throw Object.assign(error,{firefoxNativeRawReport:{format:'model-lens-firefox-native-raw',version:1,status:'unverified',compressedBytes:bytes.length,compressedSHA256:expectedSHA,gzipBase64:bytes.toString('base64'),error:String(error.message),scope:'Complete bounded original retained after parser failure; no valid native measurements claimed.'}});}
        },
        async cleanup({browserClosed,processCleanup}={}){
            assert.equal(browserClosed,true);assert.equal(processCleanup?.allReaped,true);assert.deepEqual(processCleanup.remaining,[]);
            if(file&&!removed){const s=await lstat(file);assert.ok(s.isFile()&&!s.isSymbolicLink());assert.deepEqual(identity(s),fileIdentity,'Native report identity changed; retained');assert.equal(sha256(await readFile(file)),expectedSHA,'Native report bytes changed; retained');await event('delete_intent','report');await unlink(file);removed=true;record.status='removed';await event('removed','report');}
            if(!directoryRemoved){await event('delete_intent','directory');await rmdir(directory);directoryRemoved=true;record.directoryRemoved=true;await event('removed','directory');}
        }
    };
}

export async function captureFirefoxSignalReport({root,parentPid,marker,executable,temp,publicOnly,browserVersion}){
    assert.equal(process.platform,'linux');assert.equal(process.env.GITHUB_ACTIONS,'true');assert.equal(publicOnly,true);assert.equal(browserVersion,'142.0.1','Native signal source basis requires the pinned Firefox version');assert.ok(Number.isSafeInteger(root.pid)&&/^\d+$/.test(root.startTicks)&&/^[a-f0-9]{32}$/.test(marker));
    const bundle=path.dirname(await realpath(executable));await temp.prepare(root.pid);
    const proof=JSON.parse(execFileSync('python3',['-I','-c',FIREFOX_SIGNAL_PYTHON+'\nprint(json.dumps(send_report(json.loads(sys.argv[1]))))',JSON.stringify({...root,parentPid,marker,bundle})],{encoding:'utf8',windowsHide:true,maxBuffer:64*1024,timeout:15000}));assert.equal(proof.signalName,'SIGRTMIN');assert.equal(proof.sent,true);temp.record.signal=proof;
    const started=Date.now();while(Date.now()-started<30000){const report=await temp.readCompleted(root.pid);if(report)return {...report,signal:proof,temp:temp.record};await new Promise(r=>setTimeout(r,100));}throw Error('Native signal report did not complete within 30 seconds');
}
