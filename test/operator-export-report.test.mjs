import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {operandFixture} from './operand-fixture.mjs';
import {editTfliteModel} from '../src/tflite-model-edit.js';
import {parseModel} from '../src/model-engine.js';
import {validateTfliteConstants} from '../src/tflite-constant-checks.js';
import {createModelEditReport} from '../src/model-edit-report.js';
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
    }
});
