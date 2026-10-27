import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {operationEditInfo,operationValueChoices,editModelOperation} from '../src/model-operation-edit.js';
import {parseModel} from '../src/model-engine.js';
import {parseMLIR,parseMLIRFile} from '../src/mlir-engine.js';
import {validateMLIR} from '../src/mlir-validate.js';
import {customFixture} from './custom-fixture.mjs';
import {fixture} from './fixture.mjs';
import {MLIR_BRANCH} from './mlir-fixture.mjs';
const tfMetadata=JSON.parse(await readFile(new URL('../vendor/netron/tflite-metadata.json',import.meta.url)));
const mlMetadata=await readFile(new URL('../vendor/netron/mlir-metadata.json',import.meta.url),'utf8');
const ml=text=>parseMLIR(new TextEncoder().encode(text),{metadata:mlMetadata});
const tf=bytes=>parseModel((offset,length)=>bytes.subarray(offset,offset+length),bytes.length,tfMetadata);

test('generic MLIR form changes only name/SSA tokens; add auto-renames multi-results and preserves attributes',async()=>{
    const text=MLIR_BRANCH.replace('custom op','custom op %split %left'),index=await ml(text),info=operationEditInfo(index,{graph:0,node:0});
    assert.equal(info.name,'acme.split');assert.equal(info.outputs.length,2);assert.equal(info.operands[0].value,'%input');assert.equal(info.generic,true);
    const result=await editModelOperation(index,new File([text],'a.mlir'),{graph:0,node:0,mode:'add-after',name:'company.new_split',operands:['%input']}),after=await parseMLIRFile(result.blob,{metadata:mlMetadata}),out=await result.blob.text();
    assert.equal(after.mlir.graphs[0].operations.length,6);assert.ok(out.includes('%model_lens_new_0:2 = "company.new_split"'));
    assert.ok(out.includes('tag = "custom op %split %left"'));assert.deepEqual(validateMLIR(after).diagnostics,[]);
    const replaced=await editModelOperation(index,null,{graph:0,node:1,mode:'replace',name:'company.new_left',operands:['%split#1']});
    assert.ok((await replaced.blob.text()).includes('%left = "company.new_left"(%split#1)'));
});

test('MLIR removal rewires every external consumer by definition identity, including large fanout',async()=>{
    const index=await ml(MLIR_BRANCH),result=await editModelOperation(index,null,{graph:0,node:1,mode:'remove',replacements:['%split#0']}),after=await parseMLIRFile(result.blob,{metadata:mlMetadata});
    assert.equal(after.mlir.graphs[0].operations.length,4);assert.ok((await result.blob.text()).includes('"acme.join"(%split#0, %right)'));
    const text='%input = "company.input"() : () -> i32\n%pass = "company.pass"(%input) : (i32) -> i32\n'+Array.from({length:200},()=> '"company.sink"(%pass) : (i32) -> ()').join('\n'),large=await ml(text);
    const rewritten=await editModelOperation(large,null,{graph:0,node:1,mode:'remove',replacements:['%input']});assert.equal((await rewritten.blob.text()).match(/"company.sink"\(%input\)/g).length,200);
    await assert.rejects(editModelOperation(index,null,{graph:0,node:1,mode:'remove',replacements:[]}),e=>e.validation?.total>0);
});

test('TFLite form copies OPs into the real graph with new outputs; deletion can expose exact typed boundary inputs',async()=>{
    const {bytes}=await customFixture({external:true}),index=await tf(bytes),file=new File([bytes],'a.tflite'),info=operationEditInfo(index,{graph:0,node:1});
    assert.equal(info.name,'InternalSplitFoo');assert.equal(info.outputs.length,2);assert.deepEqual(info.operands.map(p=>p.value),[4,5,-1]);assert.ok(!JSON.stringify(info).includes('custom_options'));
    const added=await editModelOperation(index,file,{graph:0,node:1,mode:'add-after',operands:[4,5,-1],exposeOutputs:true}),after=await tf(new Uint8Array(await added.blob.arrayBuffer()));
    assert.equal(after.raw.subgraphs[0].operators.length,4);assert.deepEqual([...after.raw.subgraphs[0].operators[2].outputs],[10,11]);assert.deepEqual([...after.raw.subgraphs[0].outputs],[9,10,11]);
    const removed=await editModelOperation(index,file,{graph:0,node:1,mode:'remove',deleteMode:'boundary'}),cut=await tf(new Uint8Array(await removed.blob.arrayBuffer()));
    assert.equal(cut.raw.subgraphs[0].operators.length,2);assert.deepEqual([...cut.raw.subgraphs[0].inputs],[1,2,7,8]);assert.equal(cut.raw.subgraphs[0].tensors[7].type,9);
});

test('TFLite replacement validates metadata and required ports; OP removal reconnects consumers and scalar options retain type',async()=>{
    const {bytes}=await customFixture(),index=await tf(bytes),file=new File([bytes],'a.tflite');
    const info=operationEditInfo(index,{graph:0,node:0});assert.ok(info.fields.some(f=>f.key==='fused_activation_function'&&f.kind==='int8_'));
    const changed=await editModelOperation(index,file,{graph:0,node:0,mode:'replace',operands:[1,5],options:{fused_activation_function:3}}),after=await tf(new Uint8Array(await changed.blob.arrayBuffer()));
    assert.deepEqual([...after.raw.subgraphs[0].operators[0].inputs],[1,5]);assert.equal(after.raw.subgraphs[0].operators[0].builtin_options.fused_activation_function,3);
    const removed=await editModelOperation(index,file,{graph:0,node:0,mode:'remove',replacements:[1]}),cut=await tf(new Uint8Array(await removed.blob.arrayBuffer()));assert.deepEqual([...cut.raw.subgraphs[0].operators[0].inputs],[1,5,-1]);
    await assert.rejects(editModelOperation(index,file,{graph:0,node:0,mode:'replace',operands:[7,2]}),/dtype/);
    await assert.rejects(editModelOperation(index,file,{graph:0,node:0,mode:'replace',operands:[-1,2]}),/optional/);
    await assert.rejects(editModelOperation(index,file,{graph:0,node:1,mode:'remove',replacements:[4,5]}),/dtype/);
});

test('value search bounds choice metadata before transfer and never includes payload bytes',async()=>{
    const f=fixture({repeats:100}),bytes=new Uint8Array(f.totalBytes);bytes.set(f.data);const index=await tf(bytes);
    const choices=operationValueChoices(index,{graph:0,node:0});assert.equal(choices.length,50);assert.ok(choices.every(c=>Object.keys(c).sort().join(',')==='label,value'));
    const exact=operationValueChoices(index,{graph:0,node:0,query:'tensor_150'});assert.equal(exact.length,1);assert.equal(exact[0].value,150);
    const branch=await ml(MLIR_BRANCH),values=operationValueChoices(branch,{graph:0,node:3,query:'%split#1'});assert.equal(values.length,1);assert.equal(values[0].value,'%split#1');
});
