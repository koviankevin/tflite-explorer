// Optional acceptance against a real, file-backed fixture. Requires no browser
// automation and never calls Blob.text()/arrayBuffer() on the complete model.
import {openAsBlob,createWriteStream} from 'node:fs';
import {readFile,writeFile,open} from 'node:fs/promises';
import {Readable} from 'node:stream';
import {pipeline} from 'node:stream/promises';
import {createHash} from 'node:crypto';
import path from 'node:path';
import assert from 'node:assert/strict';
import {parseMLIRFile} from '../src/mlir-engine.js';
import {exportMLIR} from '../src/mlir-export.js';
import {assertValidMLIR} from '../src/mlir-validate.js';
import {captureMLIRPattern,findMLIRPatterns} from '../src/mlir-pattern.js';
import {exportPatterns} from '../src/pattern-library.js';
const directory=path.resolve(process.argv[2] || 'test-results/large-mlir');
const fixture=JSON.parse(await readFile(path.join(directory,'fixture.json'),'utf8'));
const source=process.argv[3]?path.resolve(process.argv[3]):fixture.file;
const metadata=await readFile(new URL('../vendor/netron/mlir-metadata.json',import.meta.url),'utf8');
const events=await open(path.join(directory,'events.jsonl'),'a');
const event=async data=>{await events.writeFile(JSON.stringify({timestamp:new Date().toISOString(),...data})+'\n');await events.sync();};
const started=performance.now(),samples=[];
const sample=()=>samples.push({ms:performance.now()-started,...process.memoryUsage()});
sample();const timer=setInterval(sample,100);
try {
    const blob=await openAsBlob(source);
    const index=await parseMLIRFile(blob,{identifier:'large.mlir',metadata});
    const opened=performance.now();assertValidMLIR(index);
    const selections=[{graph:0,nodes:[0]},{graph:1,nodes:[0]},{graph:2,nodes:[0]},{graph:3,nodes:[0]},{graph:4,nodes:[0]}];
    const original=process.argv[3]?await parseMLIRFile(await openAsBlob(fixture.small),{identifier:'large.mlir',metadata}):index;
    const pattern={name:'大型權重分支迴圈',...captureMLIRPattern(original,selections)};
    assert.equal((await findMLIRPatterns(index,pattern)).items.length,1);
    let output=source,reopened=index,outputBytes=blob.size;
    if(!process.argv[3]) {
        const result=await exportMLIR(index,0,[0],{scope:'slice',selections});
        output=path.join(directory,'node-export.mlir');outputBytes=result.blob.size;
        await event({event:'create_intent',operation_id:'export',kind:'temporary',path:output,purpose:'Verify streamed MLIR export and original dense bytes',producer:'scripts/verify-large-mlir.mjs',inputs:[source],cleanup_condition:'Retain one verified export and report; current scope does not delete source files.'});
        await pipeline(Readable.fromWeb(result.blob.stream()),createWriteStream(output,{flags:'wx'}));
        reopened=await parseMLIRFile(await openAsBlob(output),{identifier:'large.mlir',metadata});
    }
    assertValidMLIR(reopened);assert.equal((await findMLIRPatterns(reopened,pattern)).items.length,1);
    const p=reopened.mlir.payloads[0],hash=createHash('sha256');
    for await(const chunk of p.file.slice(p.start,p.end).stream())hash.update(chunk);
    const sha256=hash.digest('hex');assert.equal(sha256,fixture.payloadSha256);
    sample();
    const report={source,sourceBytes:blob.size,output,outputBytes,stats:index.stats,openMs:opened-started,totalMs:performance.now()-started,patternMatches:1,reopenedPatternMatches:1,ssaDominance:true,payloadSha256:sha256,originalPayloadSha256:fixture.payloadSha256,peakRSS:Math.max(...samples.map(s=>s.rss)),peakHeap:Math.max(...samples.map(s=>s.heapUsed)),maxRSS:process.resourceUsage().maxRSS*1024,node:process.version};
    await writeFile(path.join(directory,process.argv[3]?'browser-export-report.json':'node-report.json'),JSON.stringify(report,null,2));
    await writeFile(path.join(directory,'branch-loop-pattern.json'),exportPatterns([pattern]));
    await event({event:'verified',operation_id:'export',path:output,...report});console.log(JSON.stringify(report));
} finally {clearInterval(timer);await events.close();}
