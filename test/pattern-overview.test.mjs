import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {preparePatternOverview,patternOverviewSnapshot} from '../src/pattern-overview.js';
import {parseModel,indexModel,findPatterns} from '../src/model-engine.js';
import {parseMLIR} from '../src/mlir-engine.js';
import {captureMLIRPattern,findMLIRPatterns} from '../src/mlir-pattern.js';
import {fixture} from './fixture.mjs';
import {MLIR_CFG_LOOP} from './mlir-fixture.mjs';
const metadata=await readFile(new URL('../vendor/netron/mlir-metadata.json',import.meta.url),'utf8');
async function tflite(options={}) {
    const f=fixture(options);
    return parseModel((o,l)=>{const bytes=new Uint8Array(l);bytes.set(f.data.subarray(o,o+l));return bytes;},f.totalBytes,JSON.parse(await readFile(new URL('../vendor/netron/tflite-metadata.json',import.meta.url),'utf8')));
}
const capsules=dto=>dto.graph.nodes.filter(n=>n.diagramKind==='pattern');
function assertConnections(plan,dto) {
    const shown=new Map();
    for(const match of dto.overviewMatches)if(match.foldable && match.collapsed)for(const n of plan.matches[match.index].hidden)shown.set(n,`pattern:match:${match.index}`);
    const owner=new Map();for(const n of plan.graph.nodes)for(const a of n.outputs)for(const v of a.value)owner.set(v,n);
    const visible=new Map(dto.graph.nodes.map(n=>[n.identifier,n]));
    for(const n of plan.graph.nodes)for(const [kind,values] of [['ssa',n.inputs.flatMap(a=>a.value)],['control',n.controlDependencies || []]])for(const v of values) {
        const from=owner.get(v);if(!from)continue;
        const a=shown.get(from) || from.identifier,b=shown.get(n) || n.identifier;
        if(a===b)continue;
        assert.ok(visible.get(a).outputs.some(a=>a.value.includes(v)),v.name);
        assert.ok((kind==='control'?visible.get(b).controlDependencies:visible.get(b).inputs.flatMap(a=>a.value)).includes(v),v.name);
        assert.ok(dto.links.some(e=>e.from===a && e.to===b && e.kind===kind && e.value===v.identifier));
    }
    assert.deepEqual(dto.graph.inputs,plan.graph.inputs);assert.deepEqual(dto.graph.outputs,plan.graph.outputs);
}

test('whole TFLite model folds every occurrence across subgraphs and expands exactly one without changing source/results',async()=>{
    const index=await tflite({graphCount:2,repeats:4}),items=(await findPatterns(index,['Reshape','Transpose','Reshape'])).items,source=JSON.stringify(index.model);
    const plan=await preparePatternOverview(index,items),folded=patternOverviewSnapshot(plan);
    assert.equal(capsules(folded).length,8);assert.equal(folded.overlapCount,0);assertConnections(plan,folded);
    const expanded=patternOverviewSnapshot(plan,{expanded:[2],active:2});
    assert.equal(capsules(expanded).length,7);assert.equal(expanded.overviewMatches[2].collapsed,false);
    for(const n of plan.matches[2].nodes)assert.ok(expanded.graph.nodes.includes(n));
    assertConnections(plan,expanded);assert.equal(capsules(patternOverviewSnapshot(plan)).length,8);
    assert.equal(JSON.stringify(index.model),source);assert.equal((await findPatterns(index,['Reshape','Transpose','Reshape'])).items.length,8);
    const names=plan.graph.nodes.flatMap(n=>n.outputs.flatMap(a=>a.value.map(v=>v.name)));
    assert.equal(new Set(names).size,names.length,'subgraph tensor numbers must stay distinct');
});

test('overview uses all results beyond the first 100 and preserves unmatched subgraph contents',async()=>{
    const index=await tflite({graphCount:2,repeats:120}),items=(await findPatterns(index,['Reshape','Transpose','Reshape'])).items;
    const plan=await preparePatternOverview(index,items),dto=patternOverviewSnapshot(plan);
    assert.equal(capsules(dto).length,240);assert.equal(dto.overviewMatches.length,240);
    assertConnections(plan,dto);
    const limited=await preparePatternOverview(index,items.filter(m=>m.graph===0));
    const visible=patternOverviewSnapshot(limited);
    assert.equal(visible.graph.nodes.filter(n=>n.diagramKind==='operator' && n.sourceGraph===1).length,index.graphs[1].graph.nodes.length);
});

test('overlapping matches claim each OP once and are reported consistently after an individual expansion',async()=>{
    const values=Array.from({length:5},(_,i)=>({identifier:String(i),name:String(i),type:{dataType:'float32',shape:{dimensions:[]}}}));
    const argument=v=>({name:v.name,value:[v]});
    const graph={name:'chain',nodes:values.slice(0,-1).map((v,i)=>({identifier:String(i),name:'X',type:{name:'X'},inputs:[argument(v)],outputs:[argument(values[i+1])],attributes:[],metadata:[],blocks:[]})),inputs:[argument(values[0])],outputs:[argument(values[4])],metadata:[]};
    const index=indexModel({modules:[graph]}),items=(await findPatterns(index,['X','X'])).items;
    assert.equal(items.length,3);
    const plan=await preparePatternOverview(index,items),dto=patternOverviewSnapshot(plan);
    assert.equal(capsules(dto).length,2);assert.equal(dto.overlapCount,1);assert.deepEqual(dto.overviewMatches[1].overlaps,[0]);assertConnections(plan,dto);
    const expanded=patternOverviewSnapshot(plan,{expanded:[0]});assert.equal(capsules(expanded).length,1);assert.equal(expanded.overlapCount,1);assertConnections(plan,expanded);
});

const sameBlock=`"func.func"() <{sym_name = "parallel", function_type = (i32) -> i32}> ({
^entry(%input: i32):
%a = "company.a"(%input) : (i32) -> i32
%b = "company.b"(%a) : (i32) -> i32
%c = "company.a"(%input) : (i32) -> i32
%d = "company.b"(%c) : (i32) -> i32
%sum = "company.merge"(%b, %d) : (i32, i32) -> i32
"func.return"(%sum) : (i32) -> ()
}) : () -> ()`;
test('two matches sharing a block keep shared scaffolding and the unmatched join outside both capsules',async()=>{
    const index=await parseMLIR(new TextEncoder().encode(sameBlock),{metadata}),pattern=captureMLIRPattern(index,[{graph:0,nodes:[0,1]}]);
    const items=(await findMLIRPatterns(index,pattern)).items;assert.equal(items.length,2);
    const plan=await preparePatternOverview(index,items),dto=patternOverviewSnapshot(plan);assertConnections(plan,dto);
    assert.equal(capsules(dto).length,2);assert.equal(dto.graph.nodes.filter(n=>n.diagramKind==='block').length,1);
    assert.equal(dto.graph.nodes.filter(n=>n.type.name==='company.merge').length,1);
    const expanded=patternOverviewSnapshot(plan,{expanded:[1]});assertConnections(plan,expanded);assert.equal(capsules(expanded).length,1);
});

test('whole MLIR model preserves external branches, backedges and SSA for each occurrence without linking functions',async()=>{
    const text=MLIR_CFG_LOOP+'\n'+MLIR_CFG_LOOP.replace('sym_name = "loop"','sym_name = "other"');
    const index=await parseMLIR(new TextEncoder().encode(text),{metadata}),pattern=captureMLIRPattern(index,[{graph:1,nodes:[0]}]);
    const items=(await findMLIRPatterns(index,pattern)).items;assert.equal(items.length,2);
    const plan=await preparePatternOverview(index,items),dto=patternOverviewSnapshot(plan);assertConnections(plan,dto);
    assert.equal(capsules(dto).length,2);assert.equal(dto.overlapCount,0);
    const expanded=patternOverviewSnapshot(plan,{expanded:[0],active:0});assertConnections(plan,expanded);
    assert.equal(capsules(expanded).length,1);assert.ok(expanded.graph.nodes.some(n=>n.diagramKind==='route' && n.sourceGraph===1 && n.targetGraph===1));
    for(const link of dto.links)if(!link.from.startsWith('pattern:') && !link.to.startsWith('pattern:'))assert.equal(link.from.split(':')[1],link.to.split(':')[1]);
});

test('expansion limits fail explicitly and preserve the prepared collapsed view',async()=>{
    const index=await tflite({graphCount:1,repeats:510}),items=(await findPatterns(index,['Reshape','Transpose','Reshape'])).items;
    const plan=await preparePatternOverview(index,items);assert.equal(capsules(patternOverviewSnapshot(plan)).length,510);
    assert.throws(()=>patternOverviewSnapshot(plan,{expanded:items.map((_,i)=>i)}),/1,500/);
    assert.equal(capsules(patternOverviewSnapshot(plan)).length,510);
});
