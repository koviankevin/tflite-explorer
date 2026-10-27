import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdir,mkdtemp,readFile,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {createModelEditReport} from '../src/model-edit-report.js';
import {editModelOperation} from '../src/model-operation-edit.js';
import {parseModel} from '../src/model-engine.js';
import {parseMLIRFile} from '../src/mlir-engine.js';
import {verifyExportFiles} from '../scripts/verify-export.mjs';
import {root,buildEvent} from '../scripts/lib/release-artifact.mjs';
import {customFixture} from './custom-fixture.mjs';
const tfMetadata=JSON.parse(await readFile(new URL('../vendor/netron/tflite-metadata.json',import.meta.url))),mlMetadata=await readFile(new URL('../vendor/netron/mlir-metadata.json',import.meta.url),'utf8');
const tf=bytes=>parseModel((o,n)=>bytes.subarray(o,o+n),bytes.length,tfMetadata);
await mkdir(path.join(root,'test-results'),{recursive:true});await buildEvent({event:'create_intent',operation:'model-edit-report-tests',path:'test-results/model-edit-report-*',kind:'temporary',producer:'test/model-edit-report.test.mjs',purpose:'Full-model byte range verification and mutation negatives',cleanup_condition:'Regenerable synthetic fixtures; retain until the test evidence is no longer needed.'});
const directory=await mkdtemp(path.join(root,'test-results','model-edit-report-'));

test('actual TFLite edit report names modified target, preserves interface metadata and verifies weights/options on disk',async()=>{
    const {bytes}=await customFixture({external:true}),file=new File([bytes],'original.tflite'),index=await tf(bytes),args={mode:'add-after',graph:0,node:0,operands:[1,2]},result=await editModelOperation(index,file,args),outputBytes=new Uint8Array(await result.blob.arrayBuffer()),candidate=await tf(outputBytes);
    const built=createModelEditReport(index,file,{...result,roundTrip:true},candidate,args,{outputName:'edited.tflite',buildId:'0123456789abcdef'}),report=JSON.parse(await built.blob.text());
    assert.equal(report.provenance.mode,'model-edit');assert.equal(report.modification.before.layers,3);assert.equal(report.modification.after.layers,4);assert.equal(report.provenance.operators[0].role,'cloned');
    assert.deepEqual(report.interface.outputs.map(v=>v.id),['9','10']);assert.equal(report.interface.outputs[0].quantization.scale[0],.25);
    assert.equal(report.checks.find(c=>c.id==='serialized-roundtrip').status,'passed');assert.equal(report.checks.find(c=>c.id==='tflite-structure').status,'passed');assert.equal(report.checks.find(c=>c.id==='runtime-load').status,'not-run');
    const source=path.join(directory,'original.tflite'),output=path.join(directory,'edited.tflite');await writeFile(source,bytes);await writeFile(output,outputBytes);
    const receipt=await verifyExportFiles({report,source,output});assert.equal(receipt.byteComparison.status,'passed');assert.match(receipt.outputSHA256,/^[a-f0-9]{64}$/);
    const r=report.provenance.ranges.find(r=>r.kind==='custom-options-external');assert.ok(r);outputBytes[r.outputOffset]^=1;await writeFile(output,outputBytes);await assert.rejects(verifyExportFiles({report,source,output}),/原始資料不一致/);
});

test('actual MLIR edit report preserves deferred data, identifies mapping scope and never claims native or numerical equivalence',async()=>{
    const hex='01'.repeat(6000),text=`%weight = "company.weight"() {value = dense<"0x${hex}"> : tensor<6000xi8>} : () -> tensor<6000xi8>\n%use = "company.use"(%weight) : (tensor<6000xi8>) -> tensor<6000xi8>`,file=new File([text],'original.mlir'),index=await parseMLIRFile(file,{metadata:mlMetadata}),args={mode:'replace',graph:0,node:1,name:'company.changed',operands:['%weight']};
    const result=await editModelOperation(index,file,args),candidate=await parseMLIRFile(result.blob,{metadata:mlMetadata});
    file.arrayBuffer=()=>{throw Error('report must not read source');};file.text=file.arrayBuffer;
    const report=JSON.parse(await createModelEditReport(index,file,{...result,roundTrip:true},candidate,args,{outputName:'edited.mlir'}).blob.text());
    assert.equal(report.modification.output.type,'company.changed');assert.equal(report.provenance.operators[0].role,'modified');assert.equal(report.provenance.ranges.length,1);
    assert.match(report.modification.mappingScope,/未提供其他 OP/);assert.match(report.modification.interfaceScope,/不等同/);
    for(const id of ['native-compiler','runtime-equivalence','dense-values','payload-byte-comparison'])assert.equal(report.checks.find(c=>c.id===id).status,'not-run');
    const source=path.join(directory,'original.mlir'),output=path.join(directory,'edited.mlir');await writeFile(source,text);await writeFile(output,new Uint8Array(await result.blob.arrayBuffer()));assert.equal((await verifyExportFiles({report,source,output})).byteComparison.status,'passed');
    const advanced={...args,advanced:true},unknown=JSON.parse(await createModelEditReport(index,file,{...result,roundTrip:true},candidate,advanced,{outputName:'edited.mlir'}).blob.text());assert.equal(unknown.modification.output,null);assert.deepEqual(unknown.provenance.operators,[]);
});

test('oversized model-edit interface metadata is refused before materializing it',()=>{
    const value={identifier:'v',name:'x'.repeat(4097),type:{dataType:'i32',shape:{dimensions:[]}}},candidate={graphs:[{graph:{inputs:[{value:[value]}],outputs:[],nodes:[]}}]};
    assert.throws(()=>createModelEditReport(candidate,new File(['x'],'a.mlir'),{ranges:[]},candidate,{graph:0,node:0}),/介面文字過多/);
});
