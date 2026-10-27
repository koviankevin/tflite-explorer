import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {parseMLIR,parseMLIRFile} from '../src/mlir-engine.js';
import {editMLIRModel} from '../src/mlir-model-edit.js';
import {exportMLIR} from '../src/mlir-export.js';
import {captureMLIRPattern,findMLIRPatterns} from '../src/mlir-pattern.js';
import {validateMLIR} from '../src/mlir-validate.js';
import {MLIR_BRANCH,MLIR_EXPORT_BRANCH,MLIR_CFG_DIAMOND,MLIR_CFG_LOOP,MLIR_SCOPES} from './mlir-fixture.mjs';
const metadata=await readFile(new URL('../vendor/netron/mlir-metadata.json',import.meta.url),'utf8');
const parse=text=>parseMLIR(new TextEncoder().encode(text),{metadata});
const reopen=result=>parseMLIRFile(new File([result.blob],'edited.mlir'),{metadata});
const names=index=>index.graphs.flatMap(g=>g.graph.nodes.map(n=>n.type.name));

test('actual custom OP replacement preserves the complete module, types, attributes and source model',async()=>{
    const index=await parse(MLIR_EXPORT_BRANCH),span=index.mlir.info.operations.get(index.mlir.graphs[0].operations[1]);
    const result=await editMLIRModel(index,[{kind:'replace',graph:0,node:1,text:index.mlir.source.slice(...span).replace('acme.reshape','acme.new_reshape')}]);
    const after=await reopen(result);assert.ok(names(after).includes('acme.new_reshape'));assert.equal(names(after).filter(n=>n==='acme.reshape').length,1);
    assert.deepEqual(validateMLIR(after).diagnostics,[]);assert.equal(index.mlir.source,MLIR_EXPORT_BRANCH);
    assert.ok((await result.blob.text()).includes('9223372036854775807 : i64'));assert.ok((await result.blob.text()).includes('#internal.layout<packed>'));
    assert.equal(after.mlir.graphs.length,index.mlir.graphs.length);assert.equal(result.validation.passed,true);
});

test('actual OP deletion and explicit multi-result SSA rewiring preserve attributes containing SSA-looking text',async()=>{
    const original=MLIR_BRANCH.replace('tag = "custom op"','tag = "custom %left %split#0"'),index=await parse(original);
    const result=await editMLIRModel(index,[{kind:'remove',graph:0,node:1},{kind:'rewire',graph:0,node:3,operand:0,value:{graph:0,node:0,result:0}}]);
    const after=await reopen(result),text=await result.blob.text();
    assert.equal(names(after).filter(n=>n==='acme.reshape').length,1);assert.ok(text.includes('"acme.join"(%split#0, %right)'));
    assert.ok(text.includes('tag = "custom %left %split#0"'));assert.deepEqual(validateMLIR(after).diagnostics,[]);
    assert.equal(index.mlir.source,original);
});

test('insert a new custom OP and connect its new SSA result in the same transaction',async()=>{
    const index=await parse(MLIR_BRANCH),result=await editMLIRModel(index,[
        {kind:'insert-before',graph:0,node:4,text:'%new_result = "company.new_op"(%joined) {mode = "kept"} : (tensor<2xf32>) -> tensor<2xf32>'},
        {kind:'rewire',graph:0,node:4,operand:0,value:{name:'%new_result'}}
    ]),after=await reopen(result);
    assert.equal(names(after).filter(n=>n==='company.new_op').length,1);assert.deepEqual(validateMLIR(after).diagnostics,[]);
    assert.ok((await result.blob.text()).includes('"func.return"(%new_result)'));assert.equal(index.mlir.graphs[0].operations.length,5);
});

test('dangling uses, duplicate definitions, type mismatch, cross-branch dominance and missing terminators stop actual-model export',async()=>{
    const branch=await parse(MLIR_BRANCH),cfg=await parse(MLIR_CFG_DIAMOND);
    await assert.rejects(editMLIRModel(branch,[{kind:'remove',graph:0,node:1}]),e=>e.validation?.total>0);
    await assert.rejects(editMLIRModel(branch,[{kind:'insert-before',graph:0,node:4,text:'%left = "company.op"() : () -> tensor<2xf32>'}]),e=>e.validation?.total>0);
    await assert.rejects(editMLIRModel(cfg,[{kind:'rewire',graph:0,node:0,operand:0,value:{graph:0,argument:1}}]),/型別不同/);
    await assert.rejects(editMLIRModel(cfg,[{kind:'rewire',graph:2,node:0,operand:0,value:{graph:1,node:0,result:0}}]),e=>e.validation?.total>0);
    await assert.rejects(editMLIRModel(cfg,[{kind:'remove',graph:1,node:1}]),e=>e.validation?.total>0);
    await assert.rejects(editMLIRModel(branch,[{kind:'replace',graph:0,node:1,text:'garbage syntax'}]),e=>e.validation?.total>0);
    await assert.rejects(editMLIRModel(branch,[{kind:'remove',graph:0,node:3},{kind:'rewire',graph:0,node:3,operand:0,value:{graph:0,argument:0}}]),/範圍重疊/);
    assert.deepEqual(validateMLIR(cfg).diagnostics,[]);assert.deepEqual(validateMLIR(branch).diagnostics,[]);
});

test('large dense weights remain file-backed and byte-identical through actual-model edits',async()=>{
    const hex='Ab0123'.repeat(5000),text=`%weight = "company.weight"() {value = dense<"0x${hex}"> : tensor<15000xi8>} : () -> tensor<15000xi8>\n%use = "company.use"(%weight) : (tensor<15000xi8>) -> tensor<15000xi8>`;
    const file=new File([text],'dense.mlir'),index=await parseMLIRFile(file,{metadata});assert.equal(index.mlir.payloads.length,1);
    file.arrayBuffer=()=>{throw Error('whole source read forbidden');};file.text=file.arrayBuffer;
    const span=index.mlir.info.operations.get(index.mlir.graphs[0].operations[1]);
    const result=await editMLIRModel(index,[{kind:'replace',graph:0,node:1,text:index.mlir.source.slice(...span).replace('company.use','company.new_use')}]);
    assert.equal(result.ranges.length,1);assert.ok((await result.blob.text()).includes(hex));assert.equal(result.validation.deferredPayloads,1);
    const after=await reopen(result);assert.ok(names(after).includes('company.new_use'));assert.equal(after.mlir.payloads.length,1);
});

test('a same-spelled SSA value in another function cannot silently rewire to the local definition',async()=>{
    const index=await parse(MLIR_SCOPES);
    const a=index.mlir.graphs.findIndex(g=>g.operations.some(op=>op.name.getStringRef()==='other.input'));
    const b=index.mlir.graphs.findIndex(g=>g.operations.some(op=>op.name.getStringRef()==='acme.input'));
    // Both functions have a %x definition. A location refers to identity, not
    // merely that spelling; otherwise a "rewire" could silently do nothing.
    assert.ok(a>=0&&b>=0);
    const consumer=index.mlir.graphs[a].operations.findIndex(op=>op.name.getStringRef()==='other.custom');
    await assert.rejects(editMLIRModel(index,[{kind:'rewire',graph:a,node:consumer,operand:0,value:{graph:b,node:0,result:0}}]),/scope|SSA 定義/);
});

test('actual topology edits cannot reuse stale submodel annotations to hide changed OPs',async()=>{
    const index=await parse(MLIR_CFG_LOOP),slice=await exportMLIR(index,1,[0],{scope:'slice'}),before=await reopen(slice),pattern=captureMLIRPattern(index,[{graph:1,nodes:[0]}]);
    assert.equal(before.mlir.slicePatterns.size,1);
    const graph=before.mlir.graphs.findIndex(g=>g.operations.some(op=>op.name.getStringRef()==='company.step')),node=before.mlir.graphs[graph].operations.findIndex(op=>op.name.getStringRef()==='company.step'),span=before.mlir.info.operations.get(before.mlir.graphs[graph].operations[node]);
    const result=await editMLIRModel(before,[{kind:'replace',graph,node,text:before.mlir.source.slice(...span).replace('company.step','company.changed_step')}]),after=await reopen(result);
    assert.equal(after.mlir.slicePatterns.size,0);assert.equal((await findMLIRPatterns(after,pattern)).items.length,0);assert.ok(names(after).includes('company.changed_step'));
});
