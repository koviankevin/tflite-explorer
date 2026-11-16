import {test} from 'node:test';
import assert from 'node:assert/strict';
import {assertValueShapeProof,VALUE_SHAPE_EXPECTATIONS} from './browser/value-shape-proof.mjs';
import {valueShapeRuntimeRequired} from './browser/release-features.mjs';
import {RUNTIME_ENGINE,RUNTIME_INTERPRETER_ENGINE} from '../src/tflite-runtime-policy.js';
const valid=()=>({status:'passed',modelWorkers:8,runtimeWorkers:8,downloads:8,cases:VALUE_SHAPE_EXPECTATIONS.map(([name,modelSHA256,output,outputShape,interpreter])=>({name,modelSHA256,expected:[...output],output:[...output],outputShape:[...outputShape],engine:interpreter?RUNTIME_INTERPRETER_ENGINE:RUNTIME_ENGINE,status:'passed',inputsMatch:true,numericMatches:true,automaticRuntime:false,zipSHA256:'a'.repeat(64)}))});
test('value-dependent shape numerical proof is required from 1.12.3 including release suffixes and later versions',()=>{
    for(const version of ['0.2.0-preview.34','1.12.1','1.12.2'])assert.equal(valueShapeRuntimeRequired(version),false);
    for(const version of ['1.12.3','1.12.3+company.1','1.12.3-rc.1','1.13.0','2.0.0'])assert.equal(valueShapeRuntimeRequired(version),true);
    for(const version of [null,'v1.12.3','1.12'])assert.throws(()=>valueShapeRuntimeRequired(version));
});
test('passed status cannot hide incorrect output values, stale engines, altered fixture bytes, missing IO or automatic invocation',()=>{
    assert.doesNotThrow(()=>assertValueShapeProof(valid()));
    for(const change of [r=>r.cases.pop(),r=>r.modelWorkers--,r=>r.runtimeWorkers--,r=>r.downloads--,r=>r.cases[0].engine=RUNTIME_ENGINE,r=>r.cases[0].modelSHA256='0'.repeat(64),r=>r.cases[0].inputsMatch=false,r=>r.cases[0].output[0]=0,r=>r.cases[0].expected[0]=0,r=>r.cases[0].outputShape=[2,3],r=>r.cases[1].automaticRuntime=true,r=>r.cases[2].zipSHA256='pending',r=>r.cases[3].status='not-verified']){
        const report=valid();change(report);assert.throws(()=>assertValueShapeProof(report));
    }
});
