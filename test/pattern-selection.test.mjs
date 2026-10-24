import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {layerLocation,updateLayerSelection,selectionRectangle,layersInRectangle} from '../src/pattern-selection.js';
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

test('rectangle selection works in every drag direction and clips to the visible graph viewport',()=>{
    const bounds={left:100,top:150,right:700,bottom:600},expected={left:120,top:180,right:650,bottom:580};
    for(const [start,end] of [[{x:120,y:180},{x:650,y:580}],[{x:650,y:580},{x:120,y:180}],[{x:120,y:580},{x:650,y:180}],[{x:650,y:180},{x:120,y:580}]])assert.deepEqual(selectionRectangle(start,end,bounds),expected);
    assert.deepEqual(selectionRectangle({x:120,y:180},{x:1000,y:10},bounds),{left:120,top:150,right:700,bottom:180});
    const nodes=[{location:{graph:0,node:0},rect:{left:110,top:170,right:160,bottom:200}},{location:{graph:1,node:0},rect:{left:620,top:550,right:690,bottom:610}},{location:{graph:2,node:0},rect:{left:650,top:180,right:680,bottom:210}}];
    assert.deepEqual(layersInRectangle(nodes,expected).map(c=>c.location),[{graph:0,node:0},{graph:1,node:0}],'overlap selects across blocks; mere boundary contact does not');
    assert.deepEqual(layersInRectangle(nodes,{left:120,right:120,top:180,bottom:580}),[]);
});

test('rectangle-selected layers are added once and never replace an existing block selection',()=>{
    const selected=new Map([[4,new Set([9])]]),candidates=[{location:{graph:0,node:0},rect:{left:10,top:10,right:30,bottom:30}},{location:{graph:1,node:0},rect:{left:40,top:40,right:70,bottom:60}}];
    const hits=layersInRectangle(candidates,{left:0,top:0,right:100,bottom:100}).map(c=>c.location);
    updateLayerSelection(selected,hits);updateLayerSelection(selected,hits);
    assert.deepEqual([...selected],[[4,new Set([9])],[0,new Set([0])],[1,new Set([0])]]);
});

test('Canvas scope checks preserve selection atomically across regions and TFLite subgraphs',()=>{
    const selected=new Map([[1,new Set([0])]]),first=selected.get(1),scopeForGraph=g=>g===1 || g===2?'function-a':g===3?'function-b':undefined;
    assert.equal(updateLayerSelection(selected,[{graph:2,node:4}],{scopeForGraph}),true);
    assert.throws(()=>updateLayerSelection(selected,[{graph:3,node:0}],{scopeForGraph}),/同一個 function/);
    assert.deepEqual([...selected],[[1,new Set([0])],[2,new Set([4])]]);assert.equal(selected.get(1),first);
    assert.throws(()=>updateLayerSelection(selected,[{graph:9,node:0}],{scopeForGraph}),/保留原選取/);assert.equal(selected.has(9),false);
    assert.equal(updateLayerSelection(selected,[{graph:1,node:0},{graph:2,node:4},{graph:3,node:0}],{toggle:true,scopeForGraph}),true);
    assert.deepEqual([...selected.get(3)],[0]);assert.equal(selected.get(1).size,0);assert.equal(selected.get(2).size,0);
    const tf=new Map([[0,new Set([5])]]);assert.throws(()=>updateLayerSelection(tf,[{graph:1,node:8}],{scopeForGraph:g=>g}),/TFLite subgraph/);assert.deepEqual([...tf],[[0,new Set([5])]]);
});
