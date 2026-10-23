import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {spawnSync} from 'node:child_process';
import {parseMLIR} from '../src/mlir-engine.js';
import {exportMLIR} from '../src/mlir-export.js';
import {captureMLIRPattern,findMLIRPatterns,mlirMatchSnapshot} from '../src/mlir-pattern.js';
import {MLIR_CFG_DIAMOND,MLIR_CFG_LOOP,MLIR_BRANCH} from './mlir-fixture.mjs';
import {exportPatterns,parsePatternFile} from '../src/pattern-library.js';
const metadata=await readFile(new URL('../vendor/netron/mlir-metadata.json',import.meta.url),'utf8');
const parse=text=>parseMLIR(new TextEncoder().encode(text),{metadata});
const selections=item=>item.blocks.map(b=>({graph:b.graph,nodes:b.path}));
const mixed=MLIR_CFG_DIAMOND.replace('    %result = "company.finish"(%merged) : (i32) -> i32\n    "func.return"(%result) : (i32) -> ()',`    "cf.br"(%merged)[^loop] : (i32) -> ()
  ^loop(%iteration: i32):
    %next = "company.step"(%iteration) : (i32) -> i32
    "cf.cond_br"(%cond, %next, %next)[^loop, ^exit] <{operandSegmentSizes = array<i32: 1, 1, 1>}> : (i1, i32, i32) -> ()
  ^exit(%answer: i32):
    "func.return"(%answer) : (i32) -> ()`);
const mixedSelection=[{graph:0,nodes:[0]},{graph:1,nodes:[0]},{graph:2,nodes:[0]},{graph:3,nodes:[0]},{graph:4,nodes:[0]}];
async function slice(source,selected) {
    const index=typeof source==='string'?await parse(source):source;
    const result=await exportMLIR(index,selected[0].graph,selected[0].nodes,{scope:'slice',selections:selected});
    const text=await result.blob.text();return {index,result,text,reopened:await parse(text)};
}
test('an existing portable branch pattern ignores only added slice ABI arguments and matches its real custom op',async()=>{
    const original=await parse(MLIR_CFG_DIAMOND),selected=[{graph:1,nodes:[0]}];
    const [pattern]=parsePatternFile(exportPatterns([{name:'already saved',...captureMLIRPattern(original,selected)}]));
    const {reopened}=await slice(original,selected),result=await findMLIRPatterns(reopened,pattern);
    assert.equal(reopened.mlir.slicePatterns.size,1);assert.equal(result.items.length,1);
    assert.equal(result.items[0].sourceProjection,true);assert.equal(result.items[0].operatorCount,1);
    assert.deepEqual(captureMLIRPattern(reopened,selections(result.items[0])),captureMLIRPattern(original,selected));
    const dto=mlirMatchSnapshot(reopened,result.items[0]);
    assert.equal(dto.selected.length,1);assert.ok(dto.graph.nodes.some(n=>n.type.name==='company.custom_long_name_with_attributes'));
});
test('existing branch/join/loop pattern keeps exact original ports and excludes seed/entry/output nodes',async()=>{
    const original=await parse(mixed),pattern=captureMLIRPattern(original,mixedSelection);
    const {reopened,result}=await slice(original,mixedSelection);
    assert.equal(result.slice.conditionalOutputs,2);
    const matches=await findMLIRPatterns(reopened,pattern);assert.equal(matches.items.length,1);
    assert.equal(matches.items[0].sourceProjection,true);assert.equal(matches.items[0].operatorCount,5);
    assert.deepEqual(captureMLIRPattern(reopened,selections(matches.items[0])),pattern);
    const dto=mlirMatchSnapshot(reopened,matches.items[0]);
    assert.equal(dto.selected.length,5);assert.ok(dto.links.some(e=>e.from==='route:5:0' && e.to==='b5'));
    assert.equal(dto.graph.nodes.filter(n=>n.diagramKind==='operator' && dto.selected.includes(n.identifier)).some(n=>n.type.name==='arith.constant'),false);
});
test('pruned unused original arguments and their branch bindings remain available to old patterns without phantom operators',async()=>{
    const original=await parse(MLIR_CFG_DIAMOND),selected=[{graph:0,nodes:[0]},{graph:1,nodes:[0,1]},{graph:2,nodes:[0,1]},{graph:3,nodes:[1]}];
    const pattern=captureMLIRPattern(original,selected),{reopened}=await slice(original,selected);
    assert.equal((await findMLIRPatterns(reopened,pattern)).items.length,1);
    const all=captureMLIRPattern(original,original.graphs.map((g,graph)=>({graph,nodes:g.graph.nodes.map((_,n)=>n)})));
    assert.equal((await findMLIRPatterns(reopened,all)).items.length,0,'deleted company.finish must not be a candidate');
});
test('matching both actual and source views does not duplicate the same physical loop match',async()=>{
    const original=await parse(MLIR_CFG_LOOP),selected=[{graph:1,nodes:[0]}],pattern=captureMLIRPattern(original,selected);
    const {reopened}=await slice(original,selected);
    assert.equal((await findMLIRPatterns(reopened,pattern)).items.length,1);
});
test('source structure survives a second slice without treating older synthetic entry/seed nodes as originals',async()=>{
    const original=await parse(mixed),pattern=captureMLIRPattern(original,mixedSelection),first=await slice(original,mixedSelection);
    const firstMatch=(await findMLIRPatterns(first.reopened,pattern)).items[0];
    const second=await slice(first.reopened,selections(firstMatch));
    const result=await findMLIRPatterns(second.reopened,pattern);assert.equal(result.items.length,1);
    assert.deepEqual(captureMLIRPattern(second.reopened,selections(result.items[0])),pattern);
});
test('a single-block SSA extraction also preserves its original block argument shape for saved patterns',async()=>{
    const original=await parse(MLIR_BRANCH),selected=[{graph:0,nodes:[1,2]}],pattern=captureMLIRPattern(original,selected);
    const {reopened}=await slice(original,selected);
    const matches=await findMLIRPatterns(reopened,pattern);assert.equal(matches.items.length,1);
    assert.equal(matches.items[0].sourceProjection,true);
});
test('changed actual SSA routing or a changed source annotation invalidates the projection instead of loosening matching',async()=>{
    const original=await parse(mixed),pattern=captureMLIRPattern(original,mixedSelection),{text}=await slice(original,mixedSelection);
    const changed=text.replace('"cf.cond_br"(%cond, %next,','"cf.cond_br"(%cond, %iteration,');
    assert.notEqual(changed,text);
    const reparse=await parse(changed);assert.equal(reparse.mlir.slicePatterns.size,0);
    assert.equal((await findMLIRPatterns(reparse,pattern)).items.length,0);
    const corrupt=text.replace(/(\\"seal\\":\\")[a-f0-9]/,'$1z');assert.notEqual(corrupt,text);
    const invalid=await parse(corrupt);assert.equal(invalid.mlir.slicePatterns.size,0);
    assert.equal((await findMLIRPatterns(invalid,pattern)).items.length,0);
});
test('compiler print/parse and SSA renaming preserve the checked projection', {skip:!process.env.MLIR_OPT},async()=>{
    const original=await parse(mixed),pattern=captureMLIRPattern(original,mixedSelection),{text}=await slice(original,mixedSelection);
    const opt=spawnSync(process.env.MLIR_OPT,['--allow-unregistered-dialect','--mlir-print-op-generic'],{input:text,encoding:'utf8',windowsHide:true,timeout:30000,maxBuffer:8*1024*1024});
    if(opt.error)throw opt.error;assert.equal(opt.status,0,opt.stderr);
    const printed=await parse(opt.stdout);assert.equal(printed.mlir.slicePatterns.size,1);
    assert.equal((await findMLIRPatterns(printed,pattern)).items.length,1);
});
