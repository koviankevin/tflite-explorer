import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {readFile} from 'node:fs/promises';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
import vm from 'node:vm';
import {runtimeFixture} from './runtime-fixture.mjs';
import {affineQuantization} from './quantization-fixture.mjs';
import {tflite as schema} from '../vendor/netron/tflite-schema.js';
import {Archive} from '../vendor/netron/zip.js';
import {FlatbufferWriter} from '../src/flatbuffer-writer.js';
import {parseModel} from '../src/model-engine.js';
import {editTfliteModel,validateTfliteModelGraph} from '../src/tflite-model-edit.js';
import {createModelEditReport} from '../src/model-edit-report.js';
import {checkBuiltinPorts} from '../src/tflite-new-ops.js';
import {validateTfliteConstants} from '../src/tflite-constant-checks.js';
import {runtimePlan} from '../src/tflite-runtime-policy.js';
import {executeRuntime} from '../src/tflite-runtime-execute.js';

const metadata=JSON.parse(await readFile(new URL('../vendor/netron/tflite-metadata.json',import.meta.url),'utf8'));
const parse=bytes=>parseModel((o,n)=>bytes.subarray(o,o+n),bytes.length,metadata);
const noRead=()=>assert.fail('Broadcast metadata validation must not read tensor data.');
const optionsByOperator={MUL:schema.MulOptions,SUB:schema.SubOptions,DIV:schema.DivOptions};
const comparisonOperators=['MAXIMUM','MINIMUM'];

async function candidate(inputShapes,outputShape,{signature,outputType,operator='MUL',type}={}){
    const {model}=await runtimeFixture({inputShapes,outputShape});
    const graph=model.subgraphs[0],code=model.operator_codes[0];
    code.builtin_code=code.deprecated_builtin_code=schema.BuiltinOperator[operator];
    graph.operators[0].builtin_options=comparisonOperators.includes(operator)?new schema.MaximumMinimumOptions():
        Object.assign(new optionsByOperator[operator](),{fused_activation_function:0});
    if(signature)graph.tensors[0].shape_signature=Int32Array.from(signature);
    if(type!==undefined)for(const tensor of graph.tensors)tensor.type=type;
    if(outputType!==undefined){
        code.version=4;
        for(const tensor of graph.tensors.slice(0,2)){
            tensor.type=schema.TensorType.INT16;
            tensor.quantization=affineQuantization([1/32768]);
        }
        const output=graph.tensors[2];
        output.type=outputType;
        output.quantization=affineQuantization([1/128]);
        if(outputType===schema.TensorType.UINT8)output.quantization.zero_point=BigInt64Array.of(128n);
    }
    const original=new FlatbufferWriter().finish(model,new Blob()),file=new File([original],'mul.tflite');
    const source=await parse(new Uint8Array(await original.arrayBuffer()));
    const edit=editTfliteModel(source,file,[{graph:0}]);
    const bytes=new Uint8Array(await edit.blob.arrayBuffer());
    const reopened=await parse(bytes);
    assert.equal(validateTfliteModelGraph(reopened.raw,0).passed,true);
    return {raw:reopened.raw,blob:edit.blob,bytes,source,file,edit,reopened};
}

function checkPorts(model){
    const graph=model.subgraphs[0];
    const [left,right,output]=graph.tensors;
    return checkBuiltinPorts(model.operator_codes[0].builtin_code,[left,right],[output],graph.operators[0].builtin_options);
}

test('serialized MUL rejects incompatible broadcast, stale output shape and mixed paths that require broadcasting',async()=>{
    for(const [input,output,options,reason]of [
        [[[2,2],[3]],[2,3],{},/無法 broadcast/],
        [[[2,1],[1,3]],[6],{},/輸出 shape/],
        [[[2,1],[1,3]],[2,3],{outputType:schema.TensorType.INT8},/元素數/]
    ]){
        const {raw}=await candidate(input,output,options);
        assert.throws(()=>validateTfliteConstants(raw,0,noRead),error=>
            /Subgraph #0.*OP #0 MUL.*inputs tensor \[0, 1\].*outputs tensor \[2\]/.test(error.message)&&reason.test(error.message));
    }
});

test('MUL handles scalars and zero extents and keeps unknown dimensions unverified',async()=>{
    for(const [input,output]of [[[[2,1],[1,3]],[2,3]],[[[],[2]],[2]],[[[0,3],[1,3]],[0,3]]]){
        const {raw}=await candidate(input,output);
        assert.equal(validateTfliteConstants(raw,0,noRead).operators[0].status,'passed');
    }
    const {raw}=await candidate([[2,2],[1,3]],[2,3],{signature:[2,-1]});
    const proof=validateTfliteConstants(raw,0,noRead);
    assert.match(proof.operators[0].reason,/動態或未知/);
    assert.equal(proof.operators[0].status,'not-run');
    assert.doesNotThrow(()=>checkPorts(raw));
    const {raw:bad}=await candidate([[2,2],[3,3]],[2,3],{signature:[2,-1]});
    assert.throws(()=>validateTfliteConstants(bad,0,noRead),/MUL.*無法 broadcast/);
});

for(const operator of ['SUB','DIV',...comparisonOperators]){
    test(operator+' rejects incompatible input and output metadata before export',async()=>{
        for(const [inputs,output,options,reason]of [
            [[[2,2],[3]],[2,3],{},/無法 broadcast/],
            [[[2,1],[1,3]],[6],{},/輸出 shape/],
            [[[2,2],[3,3]],[2,3],{signature:[2,-1]},/無法 broadcast/]
        ]){
            const {raw}=await candidate(inputs,output,{...options,operator});
            const location=new RegExp('Subgraph #0.*OP #0 '+operator+'.*inputs tensor \\[0, 1\\].*outputs tensor \\[2\\]');
            assert.throws(()=>validateTfliteConstants(raw,0,noRead),error=>location.test(error.message)&&reason.test(error.message));
            assert.throws(()=>checkPorts(raw),reason);
        }
        const {raw}=await candidate([[2,1],[1,3]],[2,3],{operator});
        raw.subgraphs[0].tensors[2].type=schema.TensorType.INT32;
        assert.throws(()=>validateTfliteConstants(raw,0,noRead),/dtype 不符/);
        assert.throws(()=>checkPorts(raw),/dtype 不符/);
    });

    test(operator+' reports static broadcast and preserves dynamic and other dtype templates',async()=>{
        for(const [inputs,output]of [[[[2,1],[1,3]],[2,3]],[[[],[2]],[2]],[[[0,3],[1,3]],[0,3]]]){
            const {raw,source,file,edit,reopened}=await candidate(inputs,output,{operator});
            const validation=validateTfliteConstants(raw,0,noRead);
            assert.equal(validation.operators[0].status,'passed');
            assert.doesNotThrow(()=>checkPorts(raw));
            const exported=createModelEditReport(source,file,{...edit,roundTrip:true,semanticValidation:[validation]},reopened,{graph:0,node:0,mode:'replace'});
            const report=JSON.parse(await exported.blob.text());
            assert.deepEqual(report.operatorValidation.map(({type,status})=>[type,status]),[[operator,'passed']]);
            assert.equal(report.operatorSummary.checked,1);
            assert.ok(report.checks.filter(c=>c.id.startsWith('runtime')).every(c=>c.status==='not-run'));
        }
        for(const [inputs,options,reason]of [
            [[[2,2],[3]],{signature:[2,-1]},/動態或未知/],
            [[[2,1],[1,3]],{type:schema.TensorType.INT32},/dtype 或量化/]
        ]){
            const {raw}=await candidate(inputs,[2,3],{...options,operator});
            const report=validateTfliteConstants(raw,0,noRead);
            assert.equal(report.operators[0].status,'not-run');
            assert.match(report.operators[0].reason,reason);
            assert.doesNotThrow(()=>checkPorts(raw));
        }
    });
}

test('pinned LiteRT CPU confirms float broadcast and mixed quantized MUL interfaces',async()=>{
    const base=new URL('../vendor/litert/2.6.0/',import.meta.url),messages=[];
    globalThis.self=globalThis;
    globalThis.require=createRequire(import.meta.url);
    globalThis.__dirname=fileURLToPath(base);
    globalThis.importScripts=url=>vm.runInThisContext(readFileSync(new URL(url),'utf8'),{filename:fileURLToPath(url)});
    globalThis.Module={locateFile:name=>fileURLToPath(new URL(name,base)),printErr:line=>{
        messages.push(String(line));
        if(messages.length>16)messages.shift();
    }};
    const rt=await import('../vendor/litert/2.6.0/core.js');
    await rt.loadLiteRt(new URL('litert_wasm_compat_internal.js',base).href);
    try{
        for(const operator of ['MUL','SUB','DIV',...comparisonOperators]){
            messages.length=0;
            const invalid=await candidate([[2,2],[3]],[2,3],{operator});
            const result=await executeRuntime({blob:invalid.blob,plan:runtimePlan(invalid.raw,invalid.bytes.length),rt,
                specs:[[1,2,3,4],[10,20,30]].map(values=>({mode:'bin',file:new File([Float32Array.from(values)],'input.bin')})),diagnostics:()=>messages});
            assert.equal(result.status,'failed',operator);
            assert.equal(result.invoked,false,operator);
            assert.match(result.diagnostics.join('\n'),/broadcast|XNNPack delegate failed to reshape runtime/i,operator);
        }
        const cases=[
            {inputShapes:[[2,1],[1,3]],outputShape:[2,3],input:Float32Array,output:Float32Array,values:[[1,2],[10,20,30]],expected:[10,20,30,20,40,60]},
            {operator:'SUB',inputShapes:[[2,1],[1,3]],outputShape:[2,3],input:Float32Array,output:Float32Array,values:[[12,24],[2,3,4]],expected:[10,9,8,22,21,20]},
            {operator:'DIV',inputShapes:[[2,1],[1,3]],outputShape:[2,3],input:Float32Array,output:Float32Array,values:[[12,24],[2,3,4]],expected:[6,4,3,12,8,6]},
            {operator:'MAXIMUM',inputShapes:[[2,1],[1,3]],outputShape:[2,3],input:Float32Array,output:Float32Array,values:[[12,24],[2,18,30]],expected:[12,18,30,24,24,30]},
            {operator:'MINIMUM',inputShapes:[[2,1],[1,3]],outputShape:[2,3],input:Float32Array,output:Float32Array,values:[[12,24],[2,18,30]],expected:[2,12,12,2,18,24]},
            {inputShapes:[[2],[2]],outputShape:[2],input:Int16Array,output:Int8Array,type:schema.TensorType.INT8,values:[[16384,-16384],[16384,8192]],expected:[32,-16]},
            {inputShapes:[[2],[2]],outputShape:[2],input:Int16Array,output:Uint8Array,type:schema.TensorType.UINT8,values:[[16384,-16384],[16384,8192]],expected:[160,112]}
        ];
        for(const c of cases){
            const edited=await candidate(c.inputShapes,c.outputShape,{outputType:c.type,operator:c.operator});
            const actual=editTfliteModel(edited.source,edited.file,[{graph:0,operators:[{template:0,inputs:[0,1],outputs:[2]}]}]);
            assert.deepEqual(new Uint8Array(await actual.blob.arrayBuffer()),edited.bytes);
            messages.length=0;
            const result=await executeRuntime({blob:actual.blob,plan:runtimePlan(edited.raw,edited.bytes.length),rt,
                specs:c.values.map(values=>({mode:'bin',file:new File([c.input.from(values)],'input.bin')})),diagnostics:()=>messages});
            assert.equal(result.status,'passed',JSON.stringify(result));
            const archive=result.io.archive instanceof Uint8Array?result.io.archive:new Uint8Array(await result.io.archive.arrayBuffer());
            const body=Archive.open(archive,'zip').entries.get('outputs-0.bin').peek().slice();
            assert.deepEqual(Array.from(new c.output(body.buffer)),c.expected);
            if(c.type!==undefined){
                // The report keeps quantitative kernel contracts separate from
                // known shape errors and must allow editing the valid template.
                assert.equal(validateTfliteConstants(edited.raw,0,noRead).operators[0].status,'not-run');
                assert.doesNotThrow(()=>checkPorts(edited.raw));
            }
        }
    }finally{await rt.unloadLiteRt();}
});
