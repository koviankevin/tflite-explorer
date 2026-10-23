import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {parseMLIR} from '../src/mlir-engine.js';
import {exportMLIR} from '../src/mlir-export.js';
import {captureMLIRPattern,findMLIRPatterns,mlirMatchSnapshot,mlirSliceSnapshot} from '../src/mlir-pattern.js';
import {validateMLIR} from '../src/mlir-validate.js';
import {MLIR_CFG_DIAMOND,MLIR_CFG_LOOP} from './mlir-fixture.mjs';
const metadata=await readFile(new URL('../vendor/netron/mlir-metadata.json',import.meta.url),'utf8');
const parse=text=>parseMLIR(new TextEncoder().encode(text),{metadata});
const mixed=MLIR_CFG_DIAMOND.replace('    %result = "company.finish"(%merged) : (i32) -> i32\n    "func.return"(%result) : (i32) -> ()',`    "cf.br"(%merged)[^loop] : (i32) -> ()
  ^loop(%iteration: i32):
    %next = "company.step"(%iteration) : (i32) -> i32
    "cf.cond_br"(%cond, %next, %next)[^loop, ^exit] <{operandSegmentSizes = array<i32: 1, 1, 1>}> : (i1, i32, i32) -> ()
  ^exit(%answer: i32):
    "func.return"(%answer) : (i32) -> ()`);
const selection=[{graph:0,nodes:[0]},{graph:1,nodes:[0]},{graph:2,nodes:[0]},{graph:3,nodes:[0]},{graph:4,nodes:[0,1]}];
async function exported(index,selected) {
    const result=await exportMLIR(index,selected[0].graph,selected[0].nodes,{scope:'slice',selections:selected});
    const text=await result.blob.text();return {text,index:await parse(text)};
}
test('reopening a slice shows exactly the six captured OPs and contracts branch/join/loop routes',async()=>{
    const original=await parse(mixed),pattern=captureMLIRPattern(original,selection);
    const {index}=await exported(original,selection),dto=mlirSliceSnapshot(index,0);
    assert.deepEqual(validateMLIR(index).diagnostics,[]);
    assert.equal(dto.compactSlice,true);assert.equal(dto.graph.nodes.length,6);
    assert.ok(dto.graph.nodes.every(n=>n.diagramKind==='operator'));
    assert.deepEqual(dto.graph.inputs,[]);assert.deepEqual(dto.graph.outputs,[]);
    for(const [from,to] of [['b1:n0','b2:n0'],['b1:n0','b3:n0'],['b2:n0','b4:n0'],['b3:n0','b4:n0'],['b4:n0','b5:n0'],['b5:n1','b5:n0']])assert.ok(dto.links.some(e=>e.from===from && e.to===to && e.kind==='control'),`${from}>${to}`);
    assert.ok(dto.links.some(e=>e.from==='b5:n0' && e.to==='b5:n0' && e.kind==='ssa'),'loop-carried SSA survives argument contraction');
    assert.ok(dto.links.some(e=>e.from==='b2:n0' && e.to==='b4:n0' && e.kind==='ssa'),'left merge input');
    assert.ok(dto.links.some(e=>e.from==='b3:n0' && e.to==='b4:n0' && e.kind==='ssa'),'right merge input');
    const detail=mlirSliceSnapshot(index,0,{sliceDetails:true});
    assert.ok(detail.graph.nodes.some(n=>n.type.name==='arith.constant'));
    assert.ok(detail.graph.nodes.some(n=>n.diagramKind==='argument'));
    const found=await findMLIRPatterns(index,pattern);assert.equal(found.items.length,1);
    assert.equal(mlirMatchSnapshot(index,found.items[0]).graph.nodes.length,6);
    assert.deepEqual(captureMLIRPattern(index,found.items[0].blocks.map(b=>({graph:b.graph,nodes:b.path}))),pattern);
    assert.equal(mlirSliceSnapshot(index,0).graph.nodes.length,6,'detail expansion does not mutate compact view');
});
test('single selected loop op keeps a self-loop while ordinary non-slice graphs stay unchanged',async()=>{
    const original=await parse(MLIR_CFG_LOOP);assert.equal(mlirSliceSnapshot(original,0),null);
    const {index}=await exported(original,[{graph:1,nodes:[0]}]),dto=mlirSliceSnapshot(index,0);
    assert.equal(dto.graph.nodes.length,1);assert.ok(dto.links.some(e=>e.from===e.to && e.kind==='control'));
    assert.ok(dto.links.some(e=>e.from===e.to && e.kind==='ssa'));
});
test('capture markers survive another export and edits invalidate the sealed display projection',async()=>{
    const {index,text}=await exported(await parse(mixed),selection),dto=mlirSliceSnapshot(index,0);
    const chosen=dto.item.blocks.map(b=>({graph:b.graph,nodes:b.path}));
    const again=await exported(index,chosen);assert.equal(mlirSliceSnapshot(again.index,0).graph.nodes.length,6);
    const tampered=text.replace('\\"selected\\":true','\\"selected\\":false');assert.notEqual(tampered,text);
    assert.equal(mlirSliceSnapshot(await parse(tampered),0),null);
});
