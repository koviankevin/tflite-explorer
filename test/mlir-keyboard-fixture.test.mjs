import test from 'node:test';
import assert from 'node:assert/strict';
import {mlirKeyboardFixture,invalidKeyboardMLIR,parseKeyboardMLIR} from './mlir-keyboard-fixture.mjs';
import {exportMLIR} from '../src/mlir-export.js';
import {validateMLIR} from '../src/mlir-validate.js';
import {findMLIRPatterns} from '../src/mlir-pattern.js';
for(const kind of ['diamond','loop'])test(`keyboard ${kind} fixture really exceeds Canvas threshold and original cross-block pattern survives a slice`,async()=>{
    const f=await mlirKeyboardFixture(kind);assert.ok(f.layers>1500);assert.ok(f.blocks>=3);assert.equal(f.ids.length,f.pattern.nodes.filter(n=>n.kind==='operator').length);
    const selections=f.match.blocks.map(b=>({graph:b.graph,nodes:b.path})),result=await exportMLIR(f.index,selections[0].graph,selections[0].nodes,{scope:'slice',selections}),text=await result.blob.text(),reopened=await parseKeyboardMLIR(text);
    assert.deepEqual(validateMLIR(reopened).diagnostics,[]);assert.equal((await findMLIRPatterns(reopened,f.pattern)).items.length,1);assert.ok(!text.includes('"public.padding"'));
});
test('keyboard modal negative fixture preserves a precise undefined SSA error before any download',async()=>{
    const index=await parseKeyboardMLIR(invalidKeyboardMLIR),diagnostic=validateMLIR(index).diagnostics.find(d=>d.code==='SSA_UNDEFINED');assert.ok(diagnostic.line>0&&diagnostic.column>0&&diagnostic.excerpt.includes('%missing'));
    await assert.rejects(exportMLIR(index,0,[1]),e=>e.validation?.diagnostics.some(d=>d.code==='SSA_UNDEFINED'));
});
