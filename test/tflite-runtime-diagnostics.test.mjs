import test from 'node:test';
import assert from 'node:assert/strict';
import {runtimeDiagnosticContext,runtimeFailureLocations,runtimeLocationSummary} from '../src/tflite-runtime-diagnostics.js';
import {runtimeFixture} from './runtime-fixture.mjs';
import {executeRuntime} from '../src/tflite-runtime-execute.js';
import {runtimePlan} from '../src/tflite-runtime-policy.js';

test('actual tensor quantization errors list referring OPs without claiming the OP caused the failure',async()=>{
    const f=await runtimeFixture(),context=runtimeDiagnosticContext(f.model);
    const line='ERROR: Tensor 1 has invalid quantization parameters.';
    const locations=runtimeFailureLocations([line,line],context);
    assert.equal(locations.length,1);assert.equal(locations[0].kind,'tensor');assert.equal(locations[0].tensor,1);
    assert.equal(locations[0].unique,false);
    assert.deepEqual(locations[0].candidates.map(c=>({graph:c.graph,node:c.node,kernel:c.kernel,roles:c.roles})),[{graph:0,node:0,kernel:'ADD',roles:['input']}]);
    assert.match(runtimeLocationSummary(locations),/tensor #1.*使用者.*Subgraph #0 · OP #0/s);
    const output=runtimeFailureLocations(['Tensor #2 is invalidly specified in schema.'],context);
    assert.deepEqual(output[0].candidates[0].roles,['output']);assert.match(runtimeLocationSummary(output),/定義來源/);
    assert.deepEqual(runtimeFailureLocations(['Tensor 1 loaded successfully.','Tensor 9999999999999999999999 has invalid quantization parameters.'],context),[]);
});

test('tensor references remain candidates across subgraphs, port truncation and capped consumer lists',async()=>{
    const f=await runtimeFixture();f.model.subgraphs.push(structuredClone(f.model.subgraphs[0]));
    const line='ERROR: Tensor 1 has invalid quantization parameters.';
    const all=runtimeFailureLocations([line],runtimeDiagnosticContext(f.model))[0];assert.equal(all.candidates.length,2);assert.equal(all.unique,false);
    f.model.subgraphs[0].operators=Array.from({length:10},()=>f.model.subgraphs[0].operators[0]);
    const capped=runtimeFailureLocations([line],runtimeDiagnosticContext(f.model))[0];assert.equal(capped.candidates.length,8);assert.equal(capped.candidatesTruncated,true);assert.match(runtimeLocationSummary([capped]),/前 8/);
    const op=f.model.subgraphs[0].operators[0];op.inputs=Int32Array.from([...Array(32).fill(0),1]);
    const missing=runtimeFailureLocations([line],runtimeDiagnosticContext(f.model))[0];assert.equal(missing.contextComplete,false);assert.equal(missing.unique,false);
    assert.equal(missing.candidates.length,1);assert.match(runtimeLocationSummary([missing]),/metadata|前 32/);
});

test('pre-input compile failures retain tensor references and explain why changing input data does not repair them',async()=>{
    const f=await runtimeFixture(),plan=runtimePlan(f.model,f.blob.size);let deleted=0;
    const rt={Environment:{create:async()=>({delete(){deleted++;}})},loadAndCompile:async()=>{throw Error('Failed to build TFL interpreter');}};
    const result=await executeRuntime({blob:f.blob,plan,rt,diagnostics:()=>['ERROR: Tensor 1 has invalid quantization parameters.']});
    assert.equal(result.status,'failed');assert.equal(result.stage,'compile');assert.equal(result.compiled,false);assert.equal(result.invoked,false);
    assert.equal(result.failureLocations[0].tensor,1);assert.match(result.reason,/套用測試輸入之前/);assert.equal(deleted,1);
});
test('native node diagnostics map by both builtin and local index; repeated, delegate and unknown logs remain honest',async()=>{
    const f=await runtimeFixture(),context=runtimeDiagnosticContext(f.model),line='ERROR: Node number 0 (ADD) failed to prepare.';
    const matches=runtimeFailureLocations([line,line],context);assert.equal(matches.length,1);assert.equal(matches[0].unique,true);assert.deepEqual(matches[0].candidates[0].inputs,[0,1]);assert.match(runtimeLocationSummary(matches),/Subgraph #0 · OP #0.*inputs \[0, 1\]/);
    const delegated=runtimeFailureLocations(['Node number 0 (DELEGATE) failed to invoke.'],context);assert.equal(delegated[0].unique,false);assert.equal(delegated[0].candidates.length,0);assert.match(runtimeLocationSummary(delegated),/尚無可確認/);
    assert.deepEqual(runtimeFailureLocations(['generic failure'],context),[]);assert.deepEqual(runtimeFailureLocations(['Node number 99999999999999999999999 (ADD) failed to prepare.'],context),[]);
});
test('multiple subgraphs and truncated metadata never turn a possible match into a unique location',async()=>{
    const f=await runtimeFixture();f.model.subgraphs.push(structuredClone(f.model.subgraphs[0]));const line='Node number 0 (ADD) failed to prepare.';
    const multiple=runtimeFailureLocations([line],runtimeDiagnosticContext(f.model));assert.equal(multiple[0].unique,false);assert.equal(multiple[0].candidates.length,2);assert.match(runtimeLocationSummary(multiple),/尚未唯一定位/);
    f.model.subgraphs[0].operators=Array.from({length:513},()=>f.model.subgraphs[0].operators[0]);const context=runtimeDiagnosticContext(f.model);assert.equal(context.complete,false);assert.equal(context.total,514);assert.equal(context.operators.length,512);assert.equal(runtimeFailureLocations([line],context)[0].unique,false);
});
