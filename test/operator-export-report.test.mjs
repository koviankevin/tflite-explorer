import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {operandFixture} from './operand-fixture.mjs';
import {editTfliteModel} from '../src/tflite-model-edit.js';
import {parseModel} from '../src/model-engine.js';
import {validateTfliteConstants} from '../src/tflite-constant-checks.js';
import {createModelEditReport} from '../src/model-edit-report.js';
import {attachRuntimeReport} from '../src/tflite-runtime-report.js';
import {runtimeSkipped} from '../src/tflite-runtime-policy.js';
import {physicalFixtureHeader} from './physical-tflite-fixture.mjs';
const metadata=JSON.parse(await readFile(new URL('../vendor/netron/tflite-metadata.json',import.meta.url),'utf8'));
test('actual edit/export/reopen report lists checked and dynamic operators; no weights or runtime claims',async()=>{
    for(const constant of [true,false]){
        const c=await operandFixture('PAD',[{shape:[2],type:0},{shape:[1,2],type:2,...(constant?{values:[1,2]}:{})}],[{shape:[5],type:0}]);
        c.file.arrayBuffer=()=>assert.fail('must never read the whole original File');
        const result=editTfliteModel(c.index,c.file,[{graph:0,operators:[{template:0,inputs:[0,1]}]}]);
        const raw=new Uint8Array(await result.blob.arrayBuffer()),candidate=await parseModel((o,n)=>raw.subarray(o,o+n),raw.length,metadata);
        result.semanticValidation=[validateTfliteConstants(candidate.raw,0,(o,n)=>raw.subarray(o,o+n))];result.roundTrip=true;
        const built=createModelEditReport(c.index,c.file,result,candidate,{graph:0,node:0,mode:'replace'},{outputName:'edited.tflite'}),report=JSON.parse(await built.blob.text());
        assert.equal(report.operatorValidation.length,1);assert.equal(report.operatorValidation[0].status,constant?'passed':'not-run');
        assert.equal(report.operatorSummary.checked,constant?1:0);assert.equal(report.operatorSummary.unchecked,constant?0:1);
        assert.deepEqual(report.operatorValidation[0].inputs,[0,1]);assert.deepEqual(report.operatorValidation[0].outputs,[2]);
        assert.match(report.operatorValidation[0].reason,constant?/靜態/:/輸入|動態/);
        assert.ok(report.checks.filter(c=>c.id.startsWith('runtime')).every(c=>c.status==='not-run'));
        assert.deepEqual(built.summary.operatorValidation,report.operatorValidation);assert.ok(!JSON.stringify(report).includes('"values"'));
        assert.match(report.operatorSummary.scope,/其他 subgraphs 未重新/);
        // The browser's physical-file audit forbids unbounded Blob.text reads
        // in the main realm, even when this is a large generated JSON report.
        built.blob.text=()=>assert.fail('main thread must not re-read the report Blob');
        const attached=await attachRuntimeReport(built,runtimeSkipped('manual only'));
        const decoded=JSON.parse(await attached.blob.text());
        assert.deepEqual(decoded.operatorValidation,report.operatorValidation);
        assert.equal(decoded.runtimeValidation.invoked,false);
    }
});

test('21,005-OP report survives repeated status attachment without body reads or duplicate verdicts',async()=>{
    // Same full OP/tensor structure as the physical gate; small public payload
    // isolates report assembly. The real 1.25 GiB gate remains required.
    const f=await physicalFixtureHeader({weightBytes:64}),bytes=new Uint8Array(f.payloadOffset+64);bytes.set(f.header);
    const index=await parseModel((o,n)=>bytes.subarray(o,o+n),bytes.length,metadata),file=new File([bytes],'report-scale.tflite');
    file.arrayBuffer=()=>assert.fail('no full original File read');
    const result=editTfliteModel(index,file,[{graph:0}]),raw=new Uint8Array(await result.blob.arrayBuffer()),candidate=await parseModel((o,n)=>raw.subarray(o,o+n),raw.length,metadata);
    result.semanticValidation=[validateTfliteConstants(candidate.raw,0,(o,n)=>raw.subarray(o,o+n))];result.roundTrip=true;
    let report=createModelEditReport(index,file,result,candidate,{graph:0,node:0,mode:'replace'},{outputName:'report-scale-edited.tflite'});
    assert.ok(report.blob.size>1024**2);const prefix=report.runtimePrefix;
    for(const key of ['text','arrayBuffer','stream'])prefix[key]=()=>assert.fail('immutable report prefix must never be read');
    for(let i=0;i<3;i++){
        report.blob.text=()=>assert.fail('main report body must never be re-read');
        report=await attachRuntimeReport(report,runtimeSkipped(`manual only ${i}`));
        assert.equal(report.runtimePrefix,prefix);
    }
    const document=JSON.parse(await report.blob.text());assert.equal(document.operatorValidation.length,21005);
    assert.equal(document.operatorSummary.checked,21000);assert.equal(document.operatorSummary.unchecked,5);
    assert.equal(document.checks.filter(c=>c.id==='runtime-load').length,1);assert.equal(document.checks.filter(c=>c.id==='runtime-smoke').length,1);
    assert.equal(document.runtimeValidation.invoked,false);
    console.log(JSON.stringify({reportOperators:document.operatorValidation.length,reportBytes:report.blob.size,statusAttachments:3,reportBodyReads:0}));
});
