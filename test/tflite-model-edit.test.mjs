import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {tflite as schema} from '../vendor/netron/tflite-schema.js';
import {FlatbufferWriter} from '../src/flatbuffer-writer.js';
import {parseModel} from '../src/model-engine.js';
import {editTfliteModel,validateTfliteModelGraph} from '../src/tflite-model-edit.js';
import {customFixture} from './custom-fixture.mjs';
import {fixture} from './fixture.mjs';
const metadata=JSON.parse(await readFile(new URL('../vendor/netron/tflite-metadata.json',import.meta.url)));
const parse=bytes=>parseModel((offset,length)=>bytes.subarray(offset,offset+length),bytes.length,metadata);
const reopen=async result=>parse(new Uint8Array(await result.blob.arrayBuffer()));
const originals=index=>index.raw.subgraphs[0].operators.map((_,template)=>({template}));
const fixtureBytes=options=>{const f=fixture(options),bytes=new Uint8Array(f.totalBytes);bytes.set(f.data);return bytes;};
async function source(options){const fixture=await customFixture(options),file=new File([fixture.bytes],'model.tflite'),index=await parse(fixture.bytes);return {...fixture,file,index};}

for(const external of [false,true])test(`actual OP insertion/rewiring preserves ${external?'external':'inline'} custom options, weights and all IDs`,async()=>{
    const {file,index,options,weight}=await source({external}),before=index.raw.subgraphs[0];
    file.arrayBuffer=()=>{throw Error('whole source read forbidden');};file.text=file.arrayBuffer;
    const result=editTfliteModel(index,file,[{graph:0,tensors:[{like:4,name:'new_result'}],operators:[{template:0},{template:0,inputs:[4,2],outputs:[10]},{template:1,inputs:[10,5,-1]},{template:2}]}]),after=await reopen(result),g=after.raw.subgraphs[0];
    assert.equal(g.operators.length,4);assert.equal(g.tensors.length,11);assert.deepEqual([...g.operators[2].inputs],[10,5,-1]);
    assert.equal(g.tensors[10].buffer,0);assert.equal(g.tensors[10].name,'new_result');assert.equal(g.tensors[5].buffer,3);
    assert.equal(after.raw.buffers.length,index.raw.buffers.length);assert.deepEqual(after.raw.metadata,index.raw.metadata);assert.deepEqual(after.raw.metadata_buffer,index.raw.metadata_buffer);
    const bytes=new Uint8Array(await result.blob.arrayBuffer()),buffer=after.raw.buffers[3];
    assert.deepEqual(bytes.subarray(Number(buffer.offset),Number(buffer.offset+buffer.size)),weight);
    const op=g.operators[2];assert.deepEqual(external?bytes.subarray(Number(op.large_custom_options_offset),Number(op.large_custom_options_offset+op.large_custom_options_size)):op.custom_options,options);
    for(const r of result.ranges)assert.deepEqual(bytes.subarray(r.outputOffset,r.outputOffset+r.bytes),new Uint8Array(await file.slice(r.sourceOffset,r.sourceOffset+r.bytes).arrayBuffer()));
    assert.equal(before.operators.length,3);assert.deepEqual([...before.operators[1].inputs],[4,5,-1]);assert.equal(before.tensors.length,10);assert.equal(result.validation.passed,true);
});

test('actual custom OP deletion requires explicit reconnection; quantized result clones retain metadata and edited parameters reopen',async()=>{
    const {file,index}=await source();
    assert.throws(()=>editTfliteModel(index,file,[{graph:0,operators:[{template:1},{template:2}]}]),/缺少先前/);
    const cut=await reopen(editTfliteModel(index,file,[{graph:0,operators:[{template:1,inputs:[1,5,-1]},{template:2}]}]));
    assert.equal(cut.raw.subgraphs[0].operators.length,2);assert.deepEqual([...cut.raw.subgraphs[0].operators[0].inputs],[1,5,-1]);
    const result=editTfliteModel(index,file,[{graph:0,tensors:[{like:9,name:'quantized_result'}],operators:[...originals(index),{template:2,outputs:[10],options:{fused_activation_function:3}}],outputs:[10]}]),after=await reopen(result);
    assert.equal(after.raw.subgraphs[0].operators[3].builtin_options.fused_activation_function,3);
    assert.deepEqual(after.raw.subgraphs[0].tensors[10].quantization,index.raw.subgraphs[0].tensors[9].quantization);
    assert.deepEqual([...after.raw.subgraphs[0].outputs],[10]);assert.equal(index.raw.subgraphs[0].operators[2].builtin_options.fused_activation_function,0);
});

test('full-model editing retains other subgraphs and their original tensor and buffer references',async()=>{
    const bytes=fixtureBytes({graphCount:2}),file=new File([bytes],'two.tflite'),index=await parse(bytes);
    const result=editTfliteModel(index,file,[{graph:0,operators:[{template:0},{template:1},{template:2}]}]),after=await reopen(result);
    assert.equal(after.raw.subgraphs.length,2);assert.equal(after.raw.subgraphs[0].operators.length,3);assert.equal(after.raw.subgraphs[1].operators.length,4);
    assert.deepEqual(after.raw.subgraphs[1],index.raw.subgraphs[1]);assert.deepEqual(after.raw.operator_codes,index.raw.operator_codes);
});

test('control-flow target graphs and signatures survive; invalid replacements stop export',async()=>{
    const {model}=await customFixture();model.signature_defs=[{signature_key:'serving_default',subgraph_index:0,inputs:[{name:'input',tensor_index:1}],outputs:[{name:'output',tensor_index:9}]}];
    let file=new File([new FlatbufferWriter().finish(model,new Blob())],'signature.tflite'),index=await parse(new Uint8Array(await file.arrayBuffer()));
    const after=await reopen(editTfliteModel(index,file,[{graph:0,operators:originals(index)}]));assert.deepEqual(after.raw.signature_defs,index.raw.signature_defs);
    assert.throws(()=>editTfliteModel(index,file,[{graph:0,outputs:[7]}]),/signature/i);
    const signatures=await reopen(editTfliteModel(index,file,[{graph:0,outputs:[7,8],updateSignatures:true}]));
    assert.deepEqual(signatures.raw.signature_defs[0].outputs.map(m=>[m.name,m.tensor_index]),[['tensor_7',7],['tensor_8',8]]);
    assert.deepEqual(signatures.raw.signature_defs[0].inputs,index.raw.signature_defs[0].inputs);
    assert.equal(index.raw.signature_defs[0].outputs[0].name,'output');
    const bytes=fixtureBytes({graphCount:3});index=await parse(bytes);
    index.raw.operator_codes.push({builtin_code:schema.BuiltinOperator.IF,deprecated_builtin_code:schema.BuiltinOperator.IF,version:1});
    index.raw.subgraphs[0].operators[0]={...index.raw.subgraphs[0].operators[0],opcode_index:index.raw.operator_codes.length-1,builtin_options:Object.assign(new schema.IfOptions(),{then_subgraph_index:1,else_subgraph_index:2})};
    // The edited raw model above still refers to the original source buffers.
    const result=editTfliteModel(index,new File([bytes],'source.tflite'),[{graph:0,operators:originals(index)}]),cfg=await reopen(result);
    assert.equal(cfg.raw.subgraphs.length,3);assert.equal(cfg.raw.subgraphs[0].operators[0].builtin_options.then_subgraph_index,1);
    assert.throws(()=>editTfliteModel(index,new File([bytes],'source.tflite'),[{graph:0,operators:[{template:0,options:{then_subgraph_index:999}},...originals(index).slice(1)]}]),/subgraph #999/);
});

test('invalid producer order, duplicate producers, constant writes, tensor indices, flags and parameter types reject atomically',async()=>{
    const {file,index}=await source(),base=originals(index),bad=[
        [{template:1},{template:0},{template:2}],
        [{template:0},{template:0},...base.slice(1)],
        [{template:0,outputs:[0]},...base.slice(1)],
        [{template:0,inputs:[999]},...base.slice(1)],
        [base[0],{template:1,inputs:[4,5]},base[2]],
        [{template:0,options:{unknown_parameter:1}},...base.slice(1)],
        [{template:0,options:{fused_activation_function:1.5}},...base.slice(1)],
        [{template:0,options:{pot_scale_int16:1}},...base.slice(1)]
    ];
    for(const operators of bad)assert.throws(()=>editTfliteModel(index,file,[{graph:0,operators}]));
    assert.throws(()=>editTfliteModel(index,file,[{graph:0,operators:base.slice(0,2)}]),/輸出 tensor #9/);
    assert.throws(()=>editTfliteModel(index,file,[{graph:0},{graph:0}]),/有效的模型修改|重複/);
    assert.equal(index.raw.subgraphs[0].operators.length,3);assert.equal(validateTfliteModelGraph(index.raw,0).passed,true);
});
