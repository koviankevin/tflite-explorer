// Raw public IO only, not a TFLite model or inference result. Reuse the app's
// byte-ownership helpers in an independent document without loading the app.
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {RUNTIME_LIMITS} from '../../src/tflite-runtime-policy.js';
import {gitSource,sha256} from '../../scripts/lib/release-artifact.mjs';
import {PAYLOAD_BYTES,firefoxPayloadMemoryControl} from './firefox-payload-memory-control.mjs';
import {installedFirefoxReporterProof} from './firefox-native-memory-report.mjs';
import {nativeReportDirectory,captureFirefoxSignalReport,checkpointNativeEvidence} from './firefox-native-signal-report.mjs';

export function ownedIOControlDocument(helperSource){
    const line="import {RUNTIME_LIMITS} from './tflite-runtime-policy.js';";
    assert.ok(helperSource.startsWith(line));const helper=helperSource.slice(line.length).replace(/\bexport (?=function|const)/g,'');assert.doesNotMatch(helper,/(?:^|\n)\s*(?:import|export)\s|<\/script/i);
    const code=`onmessage=async({data})=>{try{const model=new Uint8Array(await data.model.arrayBuffer()),input=new Uint8Array(await data.input.arrayBuffer());if(model.length!==${PAYLOAD_BYTES}||input.length!==${PAYLOAD_BYTES})throw Error('Unexpected public body size');const old=data.ioBuffer??null;if(old&&(!(old instanceof ArrayBuffer)||old.byteLength!==${2*PAYLOAD_BYTES}))throw Error('Invalid IO scratch');const zeroBefore=!old||new Uint8Array(old).every(n=>n===0);if(!zeroBefore)throw Error('IO scratch was not cleared');const io=new Uint8Array(old||new ArrayBuffer(${2*PAYLOAD_BYTES}));io.set(input);for(let i=0;i<input.length;i++)io[input.length+i]=(input[i]+1)&255;postMessage({modelBytes:model.length,inputBytes:input.length,modelFirst:model[0],inputFirst:input[0],io,zeroBefore,reused:!!old&&io.buffer===old},[io.buffer]);}catch(error){postMessage({error:String(error).slice(0,512)});}};`;
    return `<!doctype html><button id="choose-model">Choose public model-size File</button><input id="model" type="file" hidden><button id="choose-input">Choose public input</button><input id="input" type="file" hidden><button id="start">Start</button><button id="stop">Stop</button><button id="download" disabled>Download</button><button id="clear">Clear</button><pre id="result" data-phase="idle"></pre><pre id="meta"></pre><script>
const RUNTIME_LIMITS=${JSON.stringify(RUNTIME_LIMITS)};
${helper}
const $=id=>document.getElementById(id),rows=[],urls=[];let active=null,archive=null;
const publish=phase=>{$('result').dataset.phase=phase;$('result').textContent=JSON.stringify(rows);$('meta').textContent=JSON.stringify({urls,assetGETs:0});};
$('choose-model').onclick=()=>$('model').click();$('choose-input').onclick=()=>$('input').click();
$('start').onclick=()=>{
 if(active||rows.length>=24)throw Error('Invalid control sequence');for(const id of ['model','input'])if($(id).files.length!==1||$(id).files[0].size!==${PAYLOAD_BYTES})throw Error('Select verified public Files first');
 $('download').disabled=true;const ioBuffer=takeRuntimeIOBuffer(archive);archive=null;
 const scriptURL=URL.createObjectURL(new Blob([${JSON.stringify(code)}],{type:'text/javascript'})),worker=new Worker(scriptURL),row={id:rows.length+1,scriptURL,createdAt:Date.now(),readyAt:null,terminatedAt:null,revoked:false,error:null};rows.push(row);active={worker,row};
 worker.onmessage=({data})=>{row.readyAt=Date.now();row.error=data.error??null;for(const key of ['modelBytes','inputBytes','modelFirst','inputFirst'])row[key]=data[key]??null;row.zeroBefore=data.zeroBefore===true;row.reused=data.reused===true;if(!row.error){if(!(data.io instanceof Uint8Array)||!(data.io.buffer instanceof ArrayBuffer)||data.io.byteOffset!==0||data.io.byteLength!==${2*PAYLOAD_BYTES}||data.io.buffer.byteLength!==data.io.byteLength)row.error='Unexpected owned IO bytes';else{archive={archive:data.io};row.blobBytes=data.io.byteLength;}}publish(row.error?'error':'ready');};
 worker.onerror=event=>{event.preventDefault();row.error=String(event.message).slice(0,512);publish('error');};publish('starting');worker.postMessage({model:$('model').files[0],input:$('input').files[0],ioBuffer},ioBuffer?[ioBuffer]:[]);
};
$('stop').onclick=()=>{if(!active)return;const {worker,row}=active;active=null;worker.onmessage=worker.onerror=null;worker.terminate();row.terminatedAt=Date.now();URL.revokeObjectURL(row.scriptURL);row.revoked=true;$('input').value='';$('download').disabled=!archive;publish('terminated');};
$('clear').onclick=()=>{if(active)throw Error('Worker still active');releaseRuntimeIO(archive);archive=null;$('download').disabled=true;$('model').value='';$('input').value='';publish('idle');};
$('download').onclick=()=>{if(active||!archive||urls.length>=8)throw Error('No completed public IO');if(archive.archive instanceof Uint8Array){const blob=new Blob([archive.archive],{type:'application/octet-stream'});releaseRuntimeIO(archive);archive={archive:blob};}const blob=archive.archive,url=URL.createObjectURL(blob),row={url,bytes:blob.size,createdAt:Date.now(),revokedAt:null};urls.push(row);const a=document.createElement('a');a.href=url;a.download='public-payload-io.bin';a.click();setTimeout(()=>{URL.revokeObjectURL(url);row.revokedAt=Date.now();publish($('result').dataset.phase);},60000);publish($('result').dataset.phase);};publish('idle');
</script>`;
}

export async function firefoxOwnedIOMemoryControl({browserType,base,asset,persistDiagnostic}){
    let bundle,temp,result,failure;
    try{
        bundle=installedFirefoxReporterProof(browserType.executablePath());
        temp=await nativeReportDirectory();
        const helper=await readFile(new URL('../../src/runtime-io.js',import.meta.url),'utf8'),html=ownedIOControlDocument(helper),variant='owned-zeroed-transferable-io-native-signal';
        const report=await firefoxPayloadMemoryControl({browserType,base,asset,mode:'file-io',diagnosticTemp:temp.directory,documentBuilder:()=>html,afterFinal:async({report})=>{
            report.variant=variant;report.helperSHA256=sha256(Buffer.from(helper));report.documentSHA256=sha256(Buffer.from(html));report.nativeReportAfterMeasurement=true;
            assert.ok(report.rows.every((r,i)=>r.zeroBefore===true&&r.reused===(i%3>0)),'Owned IO control handoff mismatch');
            assert.equal(report.modelsLoaded,0);assert.equal(report.runtimeInvocations,0);assert.equal(report.wasmInstances,0);
            return captureFirefoxSignalReport({...report.nativeSignalTarget,temp,publicOnly:true,browserVersion:report.browserVersion});
        }});assert.equal(report.nativeMemory.status,'passed');result=report;
    }catch(error){failure=error;result=error.firefoxPayloadControl||{format:'model-lens-firefox-payload-control',version:1,status:'failed',source:gitSource(),phase:'native-source-preflight'};result.variant='owned-zeroed-transferable-io-native-signal';if(bundle)result.nativeSourceProof=bundle;if(error.firefoxNativeRawReport)result.nativeRawReport=error.firefoxNativeRawReport;result.error=error.stack||String(error);}
    finally{if(temp){result ||= {status:'failed'};result.errors ||= [];result.nativeTemp=temp.record;try{await checkpointNativeEvidence(result,persistDiagnostic);await temp.cleanup({browserClosed:result.browserClosed,processCleanup:result.processCleanup});}catch(error){failure ||= error;result.status='failed';result.nativeTemp.retainedReason=error.message;result.errors.push('Native report checkpoint/cleanup: '+error.message);}}}
    if(failure)throw Object.assign(failure,{firefoxNativeControl:result});return result;
}
