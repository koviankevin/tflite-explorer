import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {PATTERN_LIMITS} from '../src/pattern-limits.js';
import {parseModel} from '../src/model-engine.js';
import {parseMLIR} from '../src/mlir-engine.js';
import {captureGraphPattern,prepareGraphPattern,findSubgraphPatterns} from '../src/subgraph-pattern.js';
import {captureMLIRPattern,findMLIRPatterns} from '../src/mlir-pattern.js';
import {exportPatterns,parsePatternFile} from '../src/pattern-library.js';
import {exportTflite} from '../src/tflite-export.js';
import {exportMLIR} from '../src/mlir-export.js';
import {validateMLIR} from '../src/mlir-validate.js';
import {fixture} from './fixture.mjs';
import {MLIR_CFG_LOOP} from './mlir-fixture.mjs';
const tfMetadata=JSON.parse(await readFile(new URL('../vendor/netron/tflite-metadata.json',import.meta.url)));
const mlMetadata=await readFile(new URL('../vendor/netron/mlir-metadata.json',import.meta.url),'utf8');
const parseTF=bytes=>parseModel((o,n)=>bytes.subarray(o,o+n),bytes.length,tfMetadata);
const parseML=text=>parseMLIR(new TextEncoder().encode(text),{metadata:mlMetadata});
const roundtrip=structure=>parsePatternFile(exportPatterns([{name:'large selection',...structure}]))[0];

test('256 selected TFLite OPs preserve topology through pattern JSON and submodel export/reopen',async()=>{
    const f=fixture({graphCount:1,repeats:86}),bytes=new Uint8Array(f.totalBytes);bytes.set(f.data);
    const index=await parseTF(bytes),selected=Array.from({length:256},(_,i)=>i);
    const pattern=roundtrip(captureGraphPattern(index.graphs[0],selected));
    assert.equal(pattern.nodes.length,256);assert.equal(pattern.edges.length,255);
    const spec={...prepareGraphPattern(pattern.nodes,pattern.edges),induced:true};
    const first=await findSubgraphPatterns(index,spec);assert.ok(first.items.some(i=>i.path.join(',')===selected.join(',')));
    const result=exportTflite(index,0,selected,new Blob([bytes]));
    const reopened=await parseTF(new Uint8Array(await result.blob.arrayBuffer()));
    assert.equal(reopened.graphs[0].graph.nodes.length,256);
    const matches=await findSubgraphPatterns(reopened,spec);assert.equal(matches.items.length,1);assert.equal(matches.truncated,false);
    assert.throws(()=>captureGraphPattern(index.graphs[0],[...selected,256]),/256/);
    reopened.graphs[0].next[120].clear();reopened.graphs[0].previous[121].clear();
    assert.equal((await findSubgraphPatterns(reopened,spec)).items.length,0);
});

test('256 same-scope custom MLIR OPs export with original attributes and valid SSA',async()=>{
    const text=Array.from({length:257},(_,i)=>`%v${i} = "company.op${i}"(${i?'%v'+(i-1):''}) {tag = "original"} : (${i?'i32':''}) -> i32`).join('\n');
    const index=await parseML(text),selected=Array.from({length:256},(_,i)=>i),pattern=roundtrip(captureGraphPattern(index.graphs[0],selected));
    const result=await exportMLIR(index,0,selected),source=await result.blob.text(),reopened=await parseML(source);
    assert.deepEqual(validateMLIR(reopened).diagnostics,[]);assert.equal((source.match(/tag = "original"/g)||[]).length,256);
    assert.equal((await findSubgraphPatterns(reopened,{...prepareGraphPattern(pattern.nodes,pattern.edges),induced:true})).items.length,1);
    await assert.rejects(exportMLIR(index,0,[...selected,256]),/256/);
});

test('cross-block loop patterns above 32 OPs retain routing, search and SSA after a slice roundtrip',async()=>{
    const extra=Array.from({length:64},(_,i)=>`  %extra${i} = "company.custom${i}"(%${i?'extra'+(i-1):'iteration'}) : (i32) -> i32`).join('\n');
    const text=MLIR_CFG_LOOP.replace('  %next =',extra+'\n  %next =').replace('"company.step"(%iteration)','"company.step"(%extra63)');
    const index=await parseML(text),selections=index.graphs.map((g,graph)=>({graph,nodes:g.graph.nodes.map((_,i)=>i)}));
    const pattern=roundtrip(captureMLIRPattern(index,selections));assert.equal(pattern.nodes.filter(n=>n.kind==='operator').length,68);
    assert.equal((await findMLIRPatterns(index,pattern)).items.length,1);
    const result=await exportMLIR(index,0,selections[0].nodes,{scope:'slice',selections}),reopened=await parseML(await result.blob.text());
    assert.deepEqual(validateMLIR(reopened).diagnostics,[]);
    const matches=await findMLIRPatterns(reopened,pattern);assert.equal(matches.items.length,1);assert.equal(matches.truncated,false);
    const negative=structuredClone(pattern),edge=negative.edges.find(e=>e.kind==='control');edge.port='9';
    assert.equal((await findMLIRPatterns(reopened,negative)).items.length,0);
    assert.equal(PATTERN_LIMITS.operators,256);
});
