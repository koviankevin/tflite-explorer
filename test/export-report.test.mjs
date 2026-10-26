import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdir,mkdtemp,readFile,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {parseModel} from '../src/model-engine.js';
import {parseMLIR,parseMLIRFile} from '../src/mlir-engine.js';
import {exportTflite} from '../src/tflite-export.js';
import {exportMLIR} from '../src/mlir-export.js';
import {createExportReport} from '../src/export-report.js';
import {mlirProvenance} from '../src/mlir-export-provenance.js';
import {verifyExportFiles} from '../scripts/verify-export.mjs';
import {customFixture} from './custom-fixture.mjs';
import {MLIR_CFG_DIAMOND,MLIR_CFG_LOOP,MLIR_SCOPES} from './mlir-fixture.mjs';
import {root,buildEvent} from '../scripts/lib/release-artifact.mjs';
const tfMetadata=JSON.parse(await readFile(new URL('../vendor/netron/tflite-metadata.json',import.meta.url)));
const mlMetadata=await readFile(new URL('../vendor/netron/mlir-metadata.json',import.meta.url),'utf8');
const parse=text=>parseMLIR(new TextEncoder().encode(text),{metadata:mlMetadata});
await mkdir(path.join(root,'test-results'),{recursive:true});
await buildEvent({event:'create_intent',operation:'export-report-tests',path:'test-results/export-report-*',kind:'temporary',producer:'test/export-report.test.mjs',purpose:'Streamed byte verification, compiler connection and mutation-negative fixtures',cleanup_condition:'Regenerable test artifacts; retain until verification evidence is no longer needed.'});
const directory=await mkdtemp(path.join(root,'test-results','export-report-'));
async function verifyOnDisk(report,sourceBlob,outputBlob,id) {
    const source=path.join(directory,id+'-source.'+report.source.format),output=path.join(directory,id+'-output.'+report.output.format);
    await writeFile(source,new Uint8Array(await sourceBlob.arrayBuffer()));await writeFile(output,new Uint8Array(await outputBlob.arrayBuffer()));
    return {source,output,result:await verifyExportFiles({report,source,output})};
}
function assertMappings(index,provenance) {
    for(const mapping of [...provenance.operators,...provenance.generated]) {
        const target=mapping.output;
        let op=index.mlir.graphs.find(g=>g.cfgFunction)?.cfgFunction?.regions[0]?.blocks[target.block]?.operations[target.operation];
        if(!op)op=index.mlir.graphs[target.block]?.block.operations[target.operation];
        for(const p of target.nested || [])op=op?.regions[p.region]?.blocks[p.block]?.operations[p.operation];
        assert.equal(op?.name.getStringRef(),mapping.type,JSON.stringify(mapping));
    }
}

for(const external of [false,true])test(`TFLite report and streamed receipt cover weights, ${external?'external':'inline'} custom options and quantized boundaries`,async()=>{
    const {bytes,options}=await customFixture({external}),file=new File([bytes],'company.tflite');
    const index=await parseModel((o,n)=>bytes.subarray(o,o+n),bytes.length,tfMetadata);
    // Report/export must use Blob slices, never materialize the source File.
    file.arrayBuffer=()=>{throw new Error('whole-file read forbidden');};file.text=file.arrayBuffer;
    const result=exportTflite(index,0,[1],file),built=createExportReport(index,file,result,{graph:0,nodes:[1,1],outputName:'cut.tflite',buildId:'0123456789abcdef'});
    const report=JSON.parse(await built.blob.text());
    assert.equal(report.selection.length,1);assert.equal(report.preservation.preservedTensorBufferIds,true);
    assert.deepEqual(report.interface.outputs[0].quantization.scale,[.25]);
    assert.ok(report.provenance.ranges.some(r=>r.kind===`custom-options-${external?'external':'inline'}` && r.bytes===options.length));
    assert.equal(report.provenance.operators[0].output.node,0);
    assert.ok(report.checks.filter(c=>/runtime|compiler|byte-comparison/.test(c.id)).every(c=>c.status==='not-run'));
    const receipt=await verifyOnDisk(report,new Blob([bytes]),result.blob,'custom-'+external);
    assert.equal(receipt.result.byteComparison.status,'passed');assert.match(receipt.result.outputSHA256,/^[a-f0-9]{64}$/);
    const modified=new Uint8Array(await result.blob.arrayBuffer()),r=report.provenance.ranges.find(r=>r.kind.includes('custom-options'));
    modified[r.outputOffset]^=1;await writeFile(receipt.output,modified);
    await assert.rejects(verifyExportFiles({report,...receipt}),/原始資料不一致/);
    await writeFile(receipt.output,new Uint8Array(await result.blob.arrayBuffer()));
    const original=bytes.slice();original[r.sourceOffset]^=1;await writeFile(receipt.source,original);
    await assert.rejects(verifyExportFiles({report,...receipt}),/原始資料不一致/);
});

test('MLIR UTF-8 byte ranges verify original deferred dense and resource payloads after export/reopen',async()=>{
    const hex='aB0123'.repeat(3000),text=`// 中文😀\n%x = "company.weight"() {value = dense<"0x${hex}"> : tensor<9000xi8>, resource = dense_resource<w> : tensor<9000xi8>} : () -> tensor<9000xi8>\n%y = "company.use"(%x) : (tensor<9000xi8>) -> tensor<9000xi8>\n{-# dialect_resources: {builtin: {w: "0x01000000${hex}"}} #-}`;
    const file=new File([text],'權重.mlir'),index=await parseMLIRFile(file,{metadata:mlMetadata});
    assert.equal(index.mlir.payloads.length,2);
    const result=await exportMLIR(index,0,[0,1]),built=createExportReport(index,file,result,{graph:0,nodes:[0,1],outputName:'cut.mlir'}),report=JSON.parse(await built.blob.text());
    assert.equal(report.provenance.ranges.length,2);assert.ok(built.blob.size<12000);
    assert.equal(report.checks.find(c=>c.id==='mlir-structure').status,'passed');assert.equal(report.checks.find(c=>c.id==='dense-values').status,'not-run');
    assert.ok(!(await built.blob.text()).includes(hex));
    const reopened=await parseMLIRFile(result.blob,{metadata:mlMetadata});assertMappings(reopened,result.provenance);
    const checked=await verifyOnDisk(report,file,result.blob,'dense');assert.equal(checked.result.byteComparison.ranges.length,2);
    const reportPath=path.join(directory,'dense.report.json');await writeFile(reportPath,await built.blob.text());
    const cli=spawnSync(process.execPath,['scripts/verify-export.mjs','--report',reportPath,'--source',checked.source,'--output',checked.output],{cwd:root,encoding:'utf8',windowsHide:true});
    assert.equal(cli.status,0,cli.stderr);assert.equal(JSON.parse(cli.stdout).outputSHA256,checked.result.outputSHA256);
    const native=process.env.MLIR_OPT;
    if(native) {
        const receipt=await verifyExportFiles({report,...checked,compiler:native,compilerArgs:['--allow-unregistered-dialect']});
        assert.equal(receipt.nativeCompiler.status,'passed',receipt.nativeCompiler.diagnostic);
        await writeFile(path.join(directory,'native-passed.verification.json'),JSON.stringify(receipt,null,2));
        const broken=(await result.blob.text()).replace('%y =','%q =');
        await writeFile(checked.output,broken);
        const rejected=await verifyExportFiles({report,...checked,compiler:native,compilerArgs:['--allow-unregistered-dialect']});
        assert.equal(rejected.byteComparison.status,'passed');
        assert.equal(rejected.nativeCompiler.status,'failed');assert.match(rejected.nativeCompiler.diagnostic,/undeclared|undefined/);
        const badCLI=spawnSync(process.execPath,['scripts/verify-export.mjs','--report',reportPath,'--source',checked.source,'--output',checked.output,'--compiler',native,'--compiler-arg','--allow-unregistered-dialect'],{cwd:root,encoding:'utf8',windowsHide:true});
        assert.equal(badCLI.status,1,badCLI.stderr);assert.equal(JSON.parse(badCLI.stdout).nativeCompiler.status,'failed');
        await writeFile(path.join(directory,'native-failed.verification.json'),JSON.stringify(rejected,null,2));
    }
});

for(const [name,source,selections] of [['branch',MLIR_CFG_DIAMOND,[{graph:1,nodes:[0]},{graph:2,nodes:[0]}]],['loop',MLIR_CFG_LOOP,[{graph:1,nodes:[0]}]]])test(`${name} report maps retained and generated control operations to reopened MLIR`,async()=>{
    const file=new File([source],name+'.mlir'),index=await parse(source),result=await exportMLIR(index,selections[0].graph,selections[0].nodes,{scope:'slice',selections});
    const report=JSON.parse(await createExportReport(index,file,result,{...selections[0],selections,outputName:name+'-cut.mlir'}).blob.text());
    assert.equal(report.selection.length,selections.length);assert.equal(report.provenance.mode,'cfg-slice');
    assertMappings(await parse(await result.blob.text()),report.provenance);
    assert.equal(report.interface.conditionalOutputs,result.slice.conditionalOutputs);
    const full=await exportMLIR(index,selections[0].graph,selections[0].nodes,{scope:'function'});
    assertMappings(await parse(await full.blob.text()),full.provenance);
    assert.ok(full.inputs.every(p=>typeof p.type==='string'));assert.ok(full.outputs.every(p=>typeof p.type==='string'));
});

test('nested region OP mapping uses coordinates inside its retained parent',async()=>{
    const index=await parse(MLIR_SCOPES),result=await exportMLIR(index,0,[1]);
    const reopened=await parse(await result.blob.text());assertMappings(reopened,result.provenance);
    assert.ok(result.provenance.operators.some(m=>m.output.nested?.length));
});

test('invalid, missing, out-of-bounds, overlapping reports and wrong files fail closed',async()=>{
    await assert.rejects(verifyExportFiles({report:{},source:'missing',output:'missing'}),/不支援/);
    const file=new File(['%x = "company.input"() : () -> i32'],'a.mlir'),index=await parse(await file.text()),result=await exportMLIR(index,0,[0]);
    const report=JSON.parse(await createExportReport(index,file,result,{graph:0,nodes:[0],outputName:'b.mlir'}).blob.text()),checked=await verifyOnDisk(report,file,result.blob,'invalid');
    assert.equal(checked.result.byteComparison.status,'not-applicable');
    const changed=structuredClone(report);changed.provenance.ranges=[{sourceOffset:0,outputOffset:0,bytes:file.size+1}];
    await assert.rejects(verifyExportFiles({report:changed,...checked}),/超出/);
    changed.provenance.ranges=[{sourceOffset:0,outputOffset:0,bytes:2},{sourceOffset:0,outputOffset:1,bytes:2}];
    await assert.rejects(verifyExportFiles({report:changed,...checked}),/重疊/);
    await writeFile(checked.output,'truncated');await assert.rejects(verifyExportFiles({report,...checked}),/大小/);
});

test('an oversized nested report is refused without walking or buffering its entire body',()=>{
    const child={name:{getStringRef:()=>{throw new Error('oversized body must not be walked');}}};
    const op={name:{getStringRef:()=> 'company.region'},regions:[{blocks:[{operations:Array(50001).fill(child)}]}]};
    const index={mlir:{ir:{byOp:new Map([[op,{block:{name:'^entry'},position:0}]])},graphs:[]}};
    const provenance=mlirProvenance(index,{mode:'ssa-slice',operators:new Map([[op,{block:0,operation:0}]])});
    assert.match(provenance.error,/50,000/);
    assert.throws(()=>createExportReport(index,new File(['x'],'x.mlir'),{provenance,blob:new Blob(['x'])}),/無法提供完整/);
});
