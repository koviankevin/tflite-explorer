import test from 'node:test';
import assert from 'node:assert/strict';
import {runtimeDiagnosticContext,runtimeFailureLocations,runtimeLocationSummary} from '../src/tflite-runtime-diagnostics.js';
import {runtimeFixture} from './runtime-fixture.mjs';
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
