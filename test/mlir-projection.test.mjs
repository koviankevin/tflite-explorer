import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {spawnSync} from 'node:child_process';
import {parseMLIR} from '../src/mlir-engine.js';
import {exportMLIR} from '../src/mlir-export.js';
import {captureMLIRPattern,findMLIRPatterns,mlirMatchSnapshot} from '../src/mlir-pattern.js';
import {MLIR_CFG_DIAMOND,MLIR_CFG_LOOP,MLIR_BRANCH} from './mlir-fixture.mjs';
import {exportPatterns,parsePatternFile} from '../src/pattern-library.js';
import {validateMLIR} from '../src/mlir-validate.js';
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
    assert.equal(dto.selected.length,5);assert.ok(dto.links.some(e=>e.from==='b5:n0' && e.to==='b5:n0' && e.kind==='control'));
    assert.ok(mlirMatchSnapshot(reopened,matches.items[0],{sliceDetails:true}).links.some(e=>e.from==='route:5:0' && e.to==='b5'));
    assert.equal(dto.graph.nodes.filter(n=>n.diagramKind==='operator' && dto.selected.includes(n.identifier)).some(n=>n.type.name==='arith.constant'),false);
});
test('pruned unused original arguments and their branch bindings remain available to old patterns without phantom operators',async()=>{
    const original=await parse(MLIR_CFG_DIAMOND),selected=[{graph:0,nodes:[0]},{graph:1,nodes:[0,1]},{graph:2,nodes:[0,1]},{graph:3,nodes:[1]}];
    const pattern=captureMLIRPattern(original,selected),{reopened}=await slice(original,selected);
    assert.equal((await findMLIRPatterns(reopened,pattern)).items.length,1);
    const all=captureMLIRPattern(original,original.graphs.map((g,graph)=>({graph,nodes:g.graph.nodes.map((_,n)=>n)})));
    assert.equal((await findMLIRPatterns(reopened,all)).items.length,0,'deleted company.finish must not be a candidate');
});
test('an unchanged loop interface still produces only one physical match through its source projection',async()=>{
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
test('synthetic seed constants and entry operations never become original-layer pattern candidates',async()=>{
    const constant=await parse('"func.func"() <{sym_name = "constant", function_type = (i32, i1, i32) -> i1}> ({\n^entry(%a: i32, %b: i1, %c: i32):\n%value = "arith.constant"() <{value = false}> : () -> i1\n"func.return"(%value) : (i1) -> ()\n}) : () -> ()');
    const pattern=captureMLIRPattern(constant,[{graph:0,nodes:[0]}]);
    const {reopened}=await slice(MLIR_CFG_DIAMOND,[{graph:1,nodes:[0]}]);
    assert.equal(reopened.mlir.graphs[0].block.arguments.length,3);
    assert.ok(reopened.graphs[0].graph.nodes.some(n=>n.type.name==='arith.constant'));
    assert.equal((await findMLIRPatterns(reopened,pattern)).items.length,0);
    assert.throws(()=>captureMLIRPattern(reopened,[{graph:0,nodes:[0]}]),/新增的介面節點/);
});
test('added ABI arguments cannot enable a new match that is absent from the original source structure',async()=>{
    const {text,reopened}=await slice(mixed,mixedSelection);
    const plainText=text.replace(/\s+\{model_lens\.slice_pattern = "(?:\\.|[^"\\])*"\}/,'');assert.notEqual(plainText,text);
    const plain=await parse(plainText),abiPattern=captureMLIRPattern(plain,[{graph:5,nodes:[0]}]);
    assert.equal((await findMLIRPatterns(plain,abiPattern)).items.length,1);
    assert.equal((await findMLIRPatterns(reopened,abiPattern)).items.length,0,'do not union added ABI structure with source matching');
});

const changedConnections=[
    ['swapped branch destinations',s=>s.replace('[^left, ^right]','[^right, ^left]'),s=>s.replace('[^ml_slice_b1, ^ml_slice_b2]','[^ml_slice_b2, ^ml_slice_b1]')],
    ['a different merge input',s=>s.replace('"cf.br"(%left_value)','"cf.br"(%input)'),s=>s.replace('"cf.br"(%left_value,','"cf.br"(%input,')],
    ['a removed loop backedge',s=>s.replace('[^loop, ^exit]','[^exit, ^exit]'),s=>s.replace(/^.*"cf\.cond_br".*\[\^ml_slice_b4, \^ml_slice_b5\].*$/m,line=>line.replace('(%cond, %next,','(%cond,').replace('[^ml_slice_b4, ^ml_slice_b5]','[^ml_slice_b5, ^ml_slice_b5]').replace('array<i32: 1, 5, 4>','array<i32: 1, 4, 4>').replace(': (i1, i32,',': (i1,'))],
    ['a different loop-carried value',s=>s.replace('(%cond, %next, %next)','(%cond, %iteration, %next)'),s=>s.replace('"cf.cond_br"(%cond, %next,','"cf.cond_br"(%cond, %iteration,')]
];
async function checkedCount(index,pattern,expected) {
    assert.deepEqual(validateMLIR(index).diagnostics,[]);
    const result=await findMLIRPatterns(index,pattern);
    assert.equal(result.items.length,expected);
    const signatures=result.items.map(item=>JSON.stringify(item.blocks.map(b=>[b.graph,[...b.path].sort((a,b)=>a-b)]).sort((a,b)=>a[0]-b[0])));
    assert.equal(new Set(signatures).size,expected,'each physical occurrence must be returned exactly once');
    if(process.env.MLIR_OPT) {
        const opt=spawnSync(process.env.MLIR_OPT,['--allow-unregistered-dialect','--mlir-print-op-generic'],{input:index.mlir.source,encoding:'utf8',windowsHide:true,timeout:30000,maxBuffer:8*1024*1024});
        if(opt.error)throw opt.error;assert.equal(opt.status,0,opt.stderr);
        assert.equal((await findMLIRPatterns(await parse(opt.stdout),pattern)).items.length,expected);
    }
    return result;
}
for(const [label,mutate,mutateExport] of changedConnections)test(`portable mixed pattern rejects ${label} before and after a newly sealed slice`,async()=>{
    const original=await parse(mixed);
    const [pattern]=parsePatternFile(exportPatterns([{name:'saved before slicing',...captureMLIRPattern(original,mixedSelection)}]));
    await checkedCount(original,pattern,1);
    const changed=mutate(mixed);assert.notEqual(changed,mixed);
    const changedIndex=await parse(changed);await checkedCount(changedIndex,pattern,0);
    const fresh=await slice(changedIndex,mixedSelection);
    assert.equal(fresh.reopened.mlir.slicePatterns.size,1,'negative must have valid new provenance, not merely an invalid annotation');
    await checkedCount(fresh.reopened,pattern,0);
    const good=await slice(original,mixedSelection),stale=mutateExport(good.text);assert.ok(stale!==good.text,'exported body mutation must change the IR');
    const staleIndex=await parse(stale);assert.equal(staleIndex.mlir.slicePatterns.size,0);
    await checkedCount(staleIndex,pattern,0);
});

test('two mixed occurrences and four connected near-misses retain exact counts across portable import, slicing and compiler printing',async()=>{
    const original=await parse(mixed);
    const [pattern]=parsePatternFile(exportPatterns([{name:'old mixed structure',...captureMLIRPattern(original,mixedSelection)}]));
    const copies=[mixed,mixed,...changedConnections.map(([,mutate])=>mutate(mixed))].map((source,i)=>source.replace('sym_name = "diamond"',`sym_name = "case_${i}"`));
    const combined=await parse(copies.join('\n'));await checkedCount(combined,pattern,2);
    const parts=[];
    for(const [i,source] of copies.entries()) {
        const part=await slice(source,mixedSelection);await checkedCount(part.reopened,pattern,i<2?1:0);
        parts.push(part.text.replace('sym_name = "extracted"',`sym_name = "slice_${i}"`));
    }
    const reopened=await parse(parts.join('\n'));
    assert.equal(reopened.mlir.slicePatterns.size,6);
    const result=await checkedCount(reopened,pattern,2);
    assert.ok(result.items.every(item=>item.sourceProjection && item.operatorCount===5 && item.blocks.length===5));
    for(const item of result.items)for(const block of item.blocks)assert.equal((await findMLIRPatterns(reopened,pattern,String(block.graph))).items.length,1);
    const again=[];
    for(const item of result.items)again.push((await slice(reopened,selections(item))).text);
    await checkedCount(await parse(again.join('\n')),pattern,2);
});

test('identical branch operator types do not duplicate a physical mixed loop occurrence after slicing',async()=>{
    const original=await parse(mixed.replaceAll('company.custom_long_name_with_attributes','company.custom'));
    const [pattern]=parsePatternFile(exportPatterns([{name:'symmetric branch types',...captureMLIRPattern(original,mixedSelection)}]));
    await checkedCount(original,pattern,1);
    await checkedCount((await slice(original,mixedSelection)).reopened,pattern,1);
});
