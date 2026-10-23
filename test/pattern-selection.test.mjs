import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {layerLocation,updateLayerSelection} from '../src/pattern-selection.js';
import {parseMLIR} from '../src/mlir-engine.js';
import {captureMLIRPattern,findMLIRPatterns,mlirMatchSnapshot} from '../src/mlir-pattern.js';
import {exportPatterns,parsePatternFile} from '../src/pattern-library.js';
import {MLIR_CFG_DIAMOND,MLIR_CFG_LOOP} from './mlir-fixture.mjs';
const metadata=await readFile(new URL('../vendor/netron/mlir-metadata.json',import.meta.url),'utf8');

for(const [name,source,count] of [['diamond',MLIR_CFG_DIAMOND,7],['loop',MLIR_CFG_LOOP,4]])test(`direct combined ${name} selection captures original operators and round trips through pattern JSON`,async()=>{
    const index=await parseMLIR(new TextEncoder().encode(source),{metadata});
    const original=captureMLIRPattern(index,index.graphs.map((g,graph)=>({graph,nodes:g.graph.nodes.map((_,n)=>n)})));
    const match=(await findMLIRPatterns(index,original)).items[0],dto=mlirMatchSnapshot(index,match);
    const locations=dto.graph.nodes.map((node,n)=>layerLocation({node,index:dto.nodes[n]},99)),selected=new Map();
    assert.equal(locations.filter(Boolean).length,count);
    assert.ok(locations.some(location=>location===null),'synthetic headers/routes/arguments cannot be selected');
    assert.ok(updateLayerSelection(selected,locations.filter(Boolean)));
    const selections=[...selected].map(([graph,nodes])=>({graph,nodes:[...nodes]}));
    assert.equal(selections.reduce((n,b)=>n+b.nodes.length,0),count);
    assert.ok(selections.every(b=>b.nodes.includes(0)),'each block keeps its own layer #0');
    const captured=captureMLIRPattern(index,selections),[imported]=parsePatternFile(exportPatterns([{name:'直接圈選',...captured}]));
    assert.deepEqual(captured,original);
    assert.equal((await findMLIRPatterns(index,imported)).items.length,1);
    const first=locations.find(Boolean);updateLayerSelection(selected,[first],{toggle:true});
    assert.equal(selected.get(first.graph).has(first.node),false);
    for(const b of selections.filter(b=>b.graph!==first.graph))assert.equal(selected.get(b.graph).has(0),true,'toggling #0 must not affect other blocks');
});

test('bulk selection is atomic at 32 operators, deduplicates and can remove at the limit',()=>{
    const selected=new Map([[0,new Set([0])]]),originalSet=selected.get(0);
    const all=Array.from({length:32},(_,node)=>({graph:1,node}));
    assert.equal(updateLayerSelection(selected,all),false);
    assert.deepEqual([...selected],[[0,new Set([0])]]);
    assert.ok(updateLayerSelection(selected,[...all.slice(0,31),all[0]]));
    assert.equal([...selected.values()].reduce((n,s)=>n+s.size,0),32);
    assert.equal(selected.get(0),originalSet);
    assert.ok(updateLayerSelection(selected,[{graph:0,node:0}],{toggle:true}));
    assert.equal(originalSet.size,0);
    assert.throws(()=>updateLayerSelection(selected,[{graph:1,node:NaN}]),/位置無效/);
});

test('ordinary TFLite and single-block MLIR nodes retain their local selection indexes',()=>{
    assert.deepEqual(layerLocation({node:{identifier:'12'},index:12},3),{graph:3,node:12});
    assert.equal(layerLocation({node:{identifier:'bad'},index:NaN},0),null);
    assert.equal(layerLocation({node:{diagramKind:'operator',sourceGraph:1},index:'b1:n0'},0),null);
});
