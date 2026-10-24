import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {parseModel} from '../src/model-engine.js';
import {parseMLIR} from '../src/mlir-engine.js';
import {captureGraphPattern,prepareGraphPattern,findSubgraphPatterns} from '../src/subgraph-pattern.js';
import {captureMLIRPattern,findMLIRPatterns} from '../src/mlir-pattern.js';
import {normalizeConditions,parseShape,matchesConditions} from '../src/pattern-conditions.js';
import {exportPatterns,parsePatternFile,planPatternImport,loadPatterns,savePattern,PATTERN_LIBRARY_KEY} from '../src/pattern-library.js';
import {exportMLIR} from '../src/mlir-export.js';
import {fixture} from './fixture.mjs';
import {MLIR_CFG_LOOP,MLIR_BRANCH} from './mlir-fixture.mjs';
const metadata=JSON.parse(await readFile(new URL('../vendor/netron/tflite-metadata.json',import.meta.url)));
const mlirMetadata=await readFile(new URL('../vendor/netron/mlir-metadata.json',import.meta.url),'utf8');
const parse=text=>parseMLIR(new TextEncoder().encode(text),{metadata:mlirMetadata});
const shape=(value,side='output',port=0)=>({kind:'shape',side,port,value});
const dtype=(value,side='output',port=0)=>({kind:'dtype',side,port,value});
test('conditional library uses independent v3 storage and reads v2 without rewriting it',()=>{
    const p={name:'existing',nodes:[{alias:'N1',type:'Reshape'}],edges:[],induced:false},values=new Map([['model-lens.patterns.v2',JSON.stringify([p])]]);
    const storage={getItem:key=>values.get(key)??null,setItem:(key,value)=>values.set(key,value)};
    const loaded=loadPatterns(storage);assert.equal(loaded.length,1);
    loaded[0].nodes[0].conditions=[dtype('float32')];savePattern(storage,loaded,loaded[0]);
    assert.equal(JSON.parse(values.get('model-lens.patterns.v2'))[0].nodes[0].conditions,undefined);
    values.set('model-lens.patterns.v2','[]');assert.equal(loadPatterns(storage)[0].nodes[0].conditions[0].value,'float32');assert.equal(PATTERN_LIBRARY_KEY,'model-lens.patterns.v3');
});

test('TFLite pattern constraints prune the exact alias/port, preserve topology and survive JSON v3',async()=>{
    const f=fixture({graphCount:1,repeats:3}),bytes=new Uint8Array(f.totalBytes);bytes.set(f.data);
    const index=await parseModel((o,n)=>bytes.subarray(o,o+n),bytes.length,metadata);
    const p={name:'有條件',...captureGraphPattern(index.graphs[0],[0,1,2])};
    p.nodes[1].conditions=[shape([1,null]),dtype('float32')];
    const find=pattern=>findSubgraphPatterns(index,prepareGraphPattern(pattern.nodes,pattern.edges));
    assert.equal((await find(p)).items.length,3);
    const text=exportPatterns([p]);assert.equal(JSON.parse(text).version,3);
    const imported=parsePatternFile(text)[0];assert.deepEqual(imported.nodes[1].conditions,p.nodes[1].conditions);
    assert.equal((await find(imported)).items.length,3);
    const negative=structuredClone(p);negative.nodes[1].conditions=[shape([2,null])];assert.equal((await find(negative)).items.length,0);
    negative.nodes[1].conditions=[dtype('int8')];assert.equal((await find(negative)).items.length,0);
    negative.nodes[1].conditions=[dtype('float32','output',1)];assert.equal((await find(negative)).items.length,0);
    assert.equal(planPatternImport([p],[negative]).renamed,1,'different constraints are not silently deduplicated');
    const legacy=structuredClone(p);delete legacy.nodes[1].conditions;assert.equal(JSON.parse(exportPatterns([legacy])).version,1);
});

test('MLIR custom attributes and multi-output ports compare displayed metadata, not names or weights',async()=>{
    const index=await parse(MLIR_BRANCH),graph=index.graphs.findIndex(g=>g.graph.nodes.some(n=>n.type.name==='acme.split'));
    const p=captureGraphPattern(index.graphs[graph],[0,1,2,3]);
    p.nodes[0].conditions=[{kind:'attribute',name:'tag',value:'custom op'},dtype('f32','output',1),shape([2],'input')];
    assert.equal((await findSubgraphPatterns(index,prepareGraphPattern(p.nodes,p.edges))).items.length,1);
    p.nodes[0].conditions[0].value='wrong';assert.equal((await findSubgraphPatterns(index,prepareGraphPattern(p.nodes,p.edges))).items.length,0);
    p.nodes[0].conditions=[dtype('float32')];assert.equal((await findSubgraphPatterns(index,prepareGraphPattern(p.nodes,p.edges))).items.length,0,'MLIR f32 and TFLite display names are explicit');
});

test('cross-block loop constraints survive export/reopen and reject a changed attribute',async()=>{
    const source=MLIR_CFG_LOOP.replace('"company.step"','"company.step"');
    const index=await parse(source),selections=index.graphs.map((g,graph)=>({graph,nodes:g.graph.nodes.map((_,n)=>n)}));
    const p=captureMLIRPattern(index,selections),op=p.nodes.find(n=>n.type==='company.step');assert.ok(op);
    op.conditions=[dtype('i32'),shape([])];
    assert.equal((await findMLIRPatterns(index,p)).items.length,1);
    const json=parsePatternFile(exportPatterns([{name:'迴圈條件',...p}]))[0];
    const result=await exportMLIR(index,selections[0].graph,selections[0].nodes,{selections});
    const reopened=await parse(await result.blob.text());assert.equal((await findMLIRPatterns(reopened,json)).items.length,1);
    op.conditions=[{kind:'attribute',name:'missing',value:'x'}];assert.equal((await findMLIRPatterns(index,p)).items.length,0);
});

test('shape wildcards/dynamic/scalars, unavailable attributes, malformed imports and lazy weights',()=>{
    assert.deepEqual(parseShape('1, *, ?, -1'),[1,null,'?','?']);assert.deepEqual(parseShape('[]'),[]);
    assert.throws(()=>parseShape('1,,2'));assert.throws(()=>normalizeConditions([{kind:'shape',side:'output',port:0,value:[-2]}]));
    const value={type:{dataType:'f32',shape:{dimensions:['?',4]}}};Object.defineProperty(value,'initializer',{get(){throw Error('weight read');}});
    const node={inputs:[],outputs:[{value:[value]}],attributes:[{name:'layout',value:'packed'},{name:'truncated',value:'x…（屬性預覽已截短；匯出保留完整原文）'}]};
    assert.equal(matchesConditions(node,[shape(['?',4]),dtype('f32')]),true);
    assert.equal(matchesConditions(node,[shape([2,4])]),false);
    assert.equal(matchesConditions(node,[{kind:'attribute',name:'truncated',value:node.attributes[1].value}]),false);
    value.type.spelling='tensor<*xf32>';assert.equal(matchesConditions(node,[shape([null])]),false);
    for(const rule of [{kind:'unknown'},{kind:'dtype',side:'output',port:-1,value:'f32'},{kind:'attribute',name:'x',value:'x'.repeat(2049)}])assert.throws(()=>normalizeConditions([rule]));
});
