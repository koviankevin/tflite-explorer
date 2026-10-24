import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {parseMLIR} from '../src/mlir-engine.js';
import {exportMLIR} from '../src/mlir-export.js';
import {mlirSliceSnapshot,captureMLIRPattern,findMLIRPatterns} from '../src/mlir-pattern.js';
import {validateMLIR} from '../src/mlir-validate.js';
import {layerLocation,updateLayerSelection} from '../src/pattern-selection.js';
import {MLIR_CFG_LOOP} from './mlir-fixture.mjs';
import {SLICE_PATTERN_ATTRIBUTE,SLICE_PATTERN_LIMIT} from '../src/mlir-pattern-projection.js';
const metadata=await readFile(new URL('../vendor/netron/mlir-metadata.json',import.meta.url),'utf8');
const parse=text=>parseMLIR(new TextEncoder().encode(text),{metadata});
async function fixture(count) {
    let chain='';for(let i=0;i<count;i++)chain+=`  %hidden${i} = "company.hidden"(${i?'%hidden'+(i-1):'%next'}) : (i32) -> i32\n`;
    chain+=`  %continue = "company.test"(%hidden${count-1}) : (i32) -> i1\n`;
    const source=await parse(MLIR_CFG_LOOP.replace('  "cf.cond_br"(%condition, %next, %next)',chain+'  "cf.cond_br"(%continue, %next, %next)'));
    const exported=await exportMLIR(source,1,[0],{scope:'slice'}),text=await exported.blob.text();return parse(text);
}
function assertOwners(dto) {
    const owners=new Map();
    for(const n of dto.graph.nodes)for(const v of n.outputs.flatMap(a=>a.value)){assert.ok(!owners.has(v.name) || owners.get(v.name)===n.identifier,`unique producer: ${v.name}`);owners.set(v.name,n.identifier);}
    assert.equal(new Set(dto.nodes).size,dto.nodes.length);
    assert.ok(dto.graph.nodes.filter(n=>n.sliceHelper).every(n=>layerLocation({node:n,index:n.identifier},0)===null));
}
test('5,000 hidden loop OPs page before cloning, cache exact paths and leave export/pattern untouched',async()=>{
    const index=await fixture(5000),base=mlirSliceSnapshot(index,0),key=base.sliceConnections[0].key,source=index.mlir.source;
    const chosen=base.item.blocks.map(b=>({graph:b.graph,nodes:b.path})),pattern=captureMLIRPattern(index,chosen),selected=new Map();
    updateLayerSelection(selected,[layerLocation({node:base.graph.nodes[0],index:base.nodes[0]},0)]);
    const before=await (await exportMLIR(index,chosen[0].graph,chosen[0].nodes,{scope:'slice',selections:chosen})).blob.text();
    let first;
    for(let i=0;i<20;i++){first=mlirSliceSnapshot(index,0,{expandedConnections:[key]});assert.ok(first.slicePathStats.work<=50000);if(!first.sliceConnections[0].pending)break;assert.equal(first.sliceHelperCount,0);}
    const c=first.sliceConnections[0];assert.equal(c.pending,false);assert.ok(c.pages>40);assert.equal(c.shown,96);assert.ok(first.sliceHelperCount<=512);assert.ok(first.nodes.some(id=>id.startsWith('slice-page:')));assertOwners(first);
    const actual=[...index.mlir.connectionIndexes.values()][0];assert.ok(actual.materializations<=96,'only visible helper templates are created');
    const covered=new Set();
    for(const page of [0,1,c.pages-1,1,0]) {
        const dto=mlirSliceSnapshot(index,0,{expandedConnections:[key],connectionPages:{[key]:page}});
        assert.equal(dto.sliceConnections[0].page,page);assert.equal(dto.slicePathStats.work,0);assert.equal(dto.slicePathStats.cacheHits,1);assert.ok(dto.sliceHelperCount<=512);assertOwners(dto);
        for(const id of dto.nodes)if(!id.startsWith('slice-page:'))covered.add(id);
        assert.deepEqual([...selected.get(chosen[0].graph)],chosen[0].nodes);
    }
    assert.ok(covered.size>180);assert.equal(index.mlir.source,source);
    assert.equal((await findMLIRPatterns(index,pattern)).items.length,1);
    const after=await (await exportMLIR(index,chosen[0].graph,chosen[0].nodes,{scope:'slice',selections:chosen})).blob.text();assert.equal(after,before);
    const reopened=await parse(after);assert.deepEqual(validateMLIR(reopened).diagnostics,[]);assert.equal((await findMLIRPatterns(reopened,pattern)).items.length,1);
});
test('small work budgets resume discovery without displaying an incomplete corridor or skipping helpers',async()=>{
    const index=await fixture(30),base=mlirSliceSnapshot(index,0),key=base.sliceConnections[0].key;let dto,attempts=0;
    do {dto=mlirSliceSnapshot(index,0,{expandedConnections:[key],maxPathWork:10,pageSize:4});assert.ok(dto.slicePathStats.work<=10);if(dto.sliceConnections[0].pending)assert.equal(dto.sliceHelperCount,0);assert.ok(++attempts<1000);}while(dto.sliceConnections[0].pending);
    assert.ok(attempts>5);const c=dto.sliceConnections[0],covered=new Set();
    for(let page=0;page<c.pages;page++) {
        const part=mlirSliceSnapshot(index,0,{expandedConnections:[key],connectionPages:{[key]:page},pageSize:4});
        assert.ok(part.sliceConnections[0].shown<=4);assertOwners(part);
        for(const n of part.graph.nodes)if(n.sliceHelper && n.diagramKind!=='slice-page')covered.add(n.identifier);
    }
    assert.equal(covered.size,c.helpers,'every helper appears on a page');
    assert.equal(mlirSliceSnapshot(index,0,{expandedConnections:[key],connectionPages:{[key]:1e9},pageSize:4}).sliceConnections[0].page,c.pages-1);
    assert.deepEqual(mlirSliceSnapshot(index,0).graph,base.graph);
});
test('a cyclic slice above 20,000 OPs exports and reopens its checked mapping beyond the old 2 MiB cap',async()=>{
    const index=await fixture(21000),base=mlirSliceSnapshot(index,0);
    assert.ok(index.graphs.reduce((n,g)=>n+g.graph.nodes.length,0)>20000);
    const annotation=index.mlir.ir.regions.map(r=>r.owner?.op.getAttr(SLICE_PATTERN_ATTRIBUTE)?.value).find(v=>typeof v==='string');
    assert.ok(annotation.length>2*1024*1024 && annotation.length<=SLICE_PATTERN_LIMIT);
    assert.equal(base.nodes.length,1,'the sealed mapping is recognized instead of falling back to a huge full graph');
    assert.deepEqual(validateMLIR(index).diagnostics,[]);
    const chosen=base.item.blocks.map(b=>({graph:b.graph,nodes:b.path})),pattern=captureMLIRPattern(index,chosen);
    const result=await exportMLIR(index,chosen[0].graph,chosen[0].nodes,{scope:'slice',selections:chosen});
    const reopened=await parse(await result.blob.text());assert.equal(mlirSliceSnapshot(reopened,0).nodes.length,1);
    assert.equal((await findMLIRPatterns(reopened,pattern)).items.length,1);
});
