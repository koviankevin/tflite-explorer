import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {parseMLIR} from '../src/mlir-engine.js';
import {captureMLIRPattern,findMLIRPatterns,mlirMatchSnapshot} from '../src/mlir-pattern.js';
import {foldPatternSnapshot} from '../src/pattern-fold.js';
import {layerLocation} from '../src/pattern-selection.js';
import {parseModel,selectionSnapshot,findPatterns} from '../src/model-engine.js';
import {fixture} from './fixture.mjs';
import {MLIR_CFG_DIAMOND,MLIR_CFG_LOOP,MLIR_CFG_SWITCH} from './mlir-fixture.mjs';
const metadata=await readFile(new URL('../vendor/netron/mlir-metadata.json',import.meta.url),'utf8');
async function match(text,selections) {
    const index=await parseMLIR(new TextEncoder().encode(text),{metadata});
    const pattern=captureMLIRPattern(index,selections),item=(await findMLIRPatterns(index,pattern)).items[0];
    return {index,pattern,item,dto:mlirMatchSnapshot(index,item,{boundaryContext:true})};
}
function capsule(dto) {const found=dto.graph.nodes.filter(n=>n.diagramKind==='pattern');assert.equal(found.length,1);return found[0];}
function assertExternalEdges(original,folded) {
    const c=capsule(folded),outside=new Set(folded.graph.nodes.filter(n=>n!==c));
    const hidden=new Set(original.graph.nodes.filter(n=>!outside.has(n)));
    const owner=new Map();for(const n of original.graph.nodes)for(const a of n.outputs)for(const v of a.value)owner.set(v,n);
    for(const n of original.graph.nodes)for(const [control,values] of [[false,n.inputs.flatMap(a=>a.value)],[true,n.controlDependencies || []]])for(const v of values) {
        const source=owner.get(v);
        if(hidden.has(n) && !hidden.has(source))assert.ok((control?c.controlDependencies:c.inputs.flatMap(a=>a.value)).includes(v),v.name);
        if(!hidden.has(n) && hidden.has(source))assert.ok(c.outputs.some(a=>a.value.includes(v)),v.name);
    }
    assert.deepEqual(folded.graph.inputs,original.graph.inputs);
    assert.deepEqual(folded.graph.outputs,original.graph.outputs);
}

test('a single loop operation folds with its internal backedge and preserves incoming/exit routes and carried SSA',async()=>{
    const {dto,index,item,pattern}=await match(MLIR_CFG_LOOP,[{graph:1,nodes:[0]}]),before=JSON.stringify(dto);
    const folded=foldPatternSnapshot(dto),c=capsule(folded);
    assertExternalEdges(dto,folded);
    assert.equal(folded.matchedOperatorCount,1);
    assert.ok(folded.graph.nodes.some(n=>n.identifier==='outside:b0'));
    assert.ok(folded.graph.nodes.some(n=>n.identifier==='outside:b2'));
    assert.ok(folded.links.some(e=>e.from==='route:0:0' && e.to===c.identifier && e.kind==='control'));
    assert.ok(folded.links.some(e=>e.from===c.identifier && e.to==='route:1:1' && e.kind==='control'));
    assert.ok(!folded.graph.nodes.some(n=>n.identifier==='route:1:0'),'wholly internal backedge is shown after expansion');
    assert.ok(c.outputs.some(a=>a.value[0].name.includes('%next')));
    assert.deepEqual(folded.focus[1],[c.identifier]);
    assert.equal(layerLocation({node:c,index:0},1),null);
    assert.equal(JSON.stringify(dto),before,'folding must not change the expanded snapshot');
    assert.deepEqual(mlirMatchSnapshot(index,item,{boundaryContext:true}),dto);
    assert.equal((await findMLIRPatterns(index,pattern)).items.length,1);
});

test('two distinct branch successors and their shared SSA keep separate outgoing routes',async()=>{
    const {dto}=await match(MLIR_CFG_DIAMOND,[{graph:0,nodes:[0]}]),folded=foldPatternSnapshot(dto),c=capsule(folded);
    assertExternalEdges(dto,folded);
    for(const s of [0,1])assert.ok(folded.links.some(e=>e.from===c.identifier && e.to===`route:0:${s}` && e.kind==='control'));
    assert.notEqual(c.outputs[0].value[0],c.outputs[1].value[0]);
    assert.ok(folded.graph.nodes.some(n=>n.diagramKind==='argument'),'function inputs remain external input nodes');
});

test('merging branches preserve both incoming routes and incoming SSA bindings without coalescing values',async()=>{
    const {dto}=await match(MLIR_CFG_DIAMOND,[{graph:3,nodes:[0]}]),folded=foldPatternSnapshot(dto),c=capsule(folded);
    assertExternalEdges(dto,folded);
    for(const from of [1,2]) {
        assert.ok(folded.links.some(e=>e.from===`route:${from}:0` && e.to===c.identifier && e.kind==='control'));
        assert.ok(c.inputs.some(a=>a.value[0].name.includes(from===1?'%left_value':'%right_value')));
    }
});

test('a cycle crossing the pattern boundary stays visible in both directions',async()=>{
    const source=MLIR_CFG_LOOP.replace('  "cf.cond_br"(%condition, %next, %next)[^loop, ^exit]',`  "cf.br"(%next)[^latch] : (i32) -> ()
^latch(%carried: i32):
  "cf.cond_br"(%condition, %carried, %carried)[^loop, ^exit]`);
    const {dto}=await match(source,[{graph:1,nodes:[0]}]),folded=foldPatternSnapshot(dto),c=capsule(folded);
    assertExternalEdges(dto,folded);
    assert.ok(folded.links.some(e=>e.from===c.identifier && e.to==='route:1:0' && e.kind==='control'));
    assert.ok(folded.links.some(e=>e.from==='route:2:0' && e.to===c.identifier && e.kind==='control'));
    assert.ok(folded.graph.nodes.some(n=>n.identifier==='outside:b2'));
});

test('switch successors retain distinct ports even when several target the same external block',async()=>{
    const {dto}=await match(MLIR_CFG_SWITCH,[{graph:0,nodes:[0]}]),folded=foldPatternSnapshot(dto),c=capsule(folded);
    assertExternalEdges(dto,folded);
    const expected=dto.graph.nodes.filter(n=>n.diagramKind==='route' && n.sourceGraph===0);
    assert.equal(folded.links.filter(e=>e.from===c.identifier && e.kind==='control').length,expected.length);
});

test('unselected data operations in full blocks remain outside the capsule',async()=>{
    const {index,item}=await match(MLIR_CFG_DIAMOND,[{graph:3,nodes:[0]}]);
    const dto=mlirMatchSnapshot(index,item,{boundaryContext:true,full:true}),folded=foldPatternSnapshot(dto);
    assertExternalEdges(dto,folded);
    assert.ok(folded.graph.nodes.some(n=>n.type.name==='func.return'));
    assert.ok(capsule(folded).outputs.some(a=>a.value[0].name.includes('%result')));
});

test('ordinary TFLite matches fold once while preserving context, tensor identities and original export selection',async()=>{
    const f=fixture({graphCount:1,repeats:2}),index=await parseModel((o,l)=>{const bytes=new Uint8Array(l);bytes.set(f.data.subarray(o,o+l));return bytes;},f.totalBytes,JSON.parse(await readFile(new URL('../vendor/netron/tflite-metadata.json',import.meta.url),'utf8')));
    const item=(await findPatterns(index,['Reshape','Transpose','Reshape'])).items[0],dto=selectionSnapshot(index,item,{full:true}),before=JSON.stringify(dto);
    const folded=foldPatternSnapshot(dto,{name:'已儲存範本'}),c=capsule(folded);
    assertExternalEdges(dto,folded);assert.equal(folded.matchedOperatorCount,3);
    assert.ok(c.name.startsWith('已儲存範本'));assert.deepEqual(item.path,[0,1,2]);
    assert.ok(folded.graph.nodes.length<dto.graph.nodes.length);assert.equal(JSON.stringify(dto),before);
    assert.deepEqual(foldPatternSnapshot({...dto,item:{kind:'layers'}}).graph,dto.graph);
});
