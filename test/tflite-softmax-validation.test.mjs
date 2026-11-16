import test from 'node:test';
import assert from 'node:assert/strict';
import {softmaxFixture} from './softmax-fixture.mjs';
import {validateTfliteConstants} from '../src/tflite-constant-checks.js';
import {prepareTfliteModelEdit} from '../src/tflite-model-edit.js';
import {editTfliteModel} from '../src/tflite-model-edit.js';
import {checkSoftmaxMetadata} from '../src/tflite-softmax-checks.js';
import {checkOperatorMetadata} from '../src/tflite-semantic-checks.js';
import {runtimePlan} from '../src/tflite-runtime-policy.js';
import {runtimeClient} from '../src/tflite-runtime-client.js';
import {executeRuntime} from '../src/tflite-runtime-execute.js';
import {parseModel} from '../src/model-engine.js';
import {readFile} from 'node:fs/promises';
const metadata=JSON.parse(await readFile(new URL('../vendor/netron/tflite-metadata.json',import.meta.url),'utf8'));
const tensor=(shape,type=0,extra={})=>({shape,type,has_rank:true,...extra});
for(const name of ['SOFTMAX','LOG_SOFTMAX']){
    test(name+' rejects a serialized stale output shape before any payload read',async()=>{
        const f=await softmaxFixture({name,output:[6]});
        assert.throws(()=>validateTfliteConstants(f.model,0,()=>assert.fail('No payload read is needed.')),new RegExp('Subgraph #0.*OP #0 '+name+'.*(shape|rank)'));
    });
    test(name+' rejects a serialized float32 to int32 output',async()=>{
        const f=await softmaxFixture({name,outputType:2});
        assert.throws(()=>validateTfliteConstants(f.model,0,()=>assert.fail('No payload read is needed.')),new RegExp(name+'.*dtype'));
    });
    test(name+' editor rejects the serialized wrong output dtype',async()=>{
        const f=await softmaxFixture({name,outputType:2});
        assert.throws(()=>prepareTfliteModelEdit(f.index,f.file,[{graph:0,operators:[{template:0,inputs:[0],outputs:[1]}]}]),new RegExp(name+'.*dtype'));
    });
    test(name+' static float proof reads no payload and a copied edit reopens with the same shape',async()=>{
        const f=await softmaxFixture({name}),before=f.bytes.slice();
        const proof=validateTfliteConstants(f.model,0,()=>assert.fail('No weights may be read.'),{budget:0});
        assert.equal(proof.checked,1);assert.equal(proof.bytesRead,0);assert.equal(proof.inspectedBytes,0);assert.equal(proof.operators[0].status,'passed');
        const edit=editTfliteModel(f.index,f.file,[{graph:0,operators:[{template:0,inputs:[0],outputs:[1]}]}]),bytes=new Uint8Array(await edit.blob.arrayBuffer()),read=(o,n)=>bytes.subarray(o,o+n),index=await parseModel(read,bytes.length,metadata);
        assert.equal(validateTfliteConstants(index.raw,0,read).checked,1);assert.deepEqual(Array.from(index.raw.subgraphs[0].tensors[1].shape),[2,3]);assert.deepEqual(f.bytes,before);
    });
    test(name+' manual execution refuses malformed metadata before Worker, module preparation or model-body read',async()=>{
        for(const options of [{output:[6]},{outputType:2}]){
            const f=await softmaxFixture({name,...options}),plan=runtimePlan(f.model,f.blob.size);assert.equal(plan.eligible,false);assert.match(plan.reason,new RegExp('subgraph 0.*OP #0.*'+name));
            const client=runtimeClient({createWorker(){assert.fail('No Worker for invalid metadata.');},prepareModule(){assert.fail('No runtime download for invalid metadata.');}});
            const blob={size:f.blob.size,arrayBuffer(){assert.fail('No model read for invalid metadata.');}},result=await client.check(blob,plan);assert.equal(result.status,'not-verified');assert.equal(result.invoked,false);
            assert.equal((await executeRuntime({blob,plan,rt:null})).status,'not-verified');
        }
    });
}
test('dynamic known dimensions and ranks are checked without treating allocated placeholders as final dimensions',()=>{
    for(const name of ['SOFTMAX','LOG_SOFTMAX']){
        const input=tensor([2,3],0,{shape_signature:[-1,3]}),out=tensor([5,3],0,{shape_signature:[-1,3]});
        assert.equal(checkSoftmaxMetadata(name,[input],[out],{beta:1}).status,'not-run');
        assert.throws(()=>checkOperatorMetadata(name,[input],[tensor([5,4],0,{shape_signature:[-1,4]})],{beta:1}),/output shape.*axis 1/);
        assert.throws(()=>checkOperatorMetadata(name,[input],[tensor([6],0,{shape_signature:[-1]})],{beta:1}),/output rank/);
        assert.throws(()=>checkOperatorMetadata(name,[input],[tensor([5,3],2,{shape_signature:[-1,3]})],{beta:1}),/dtype/);
        assert.equal(checkSoftmaxMetadata(name,[tensor([],0,{has_rank:false})],[tensor([],0,{has_rank:false})],{beta:1}).status,'not-run');
    }
});
test('Softmax rank and dtype rules retain legal half and mixed CPU paths as explicitly unverified',async()=>{
    assert.throws(()=>checkOperatorMetadata('SOFTMAX',[tensor([])],[tensor([])],{beta:1}),/rank.*1/);
    assert.equal(checkSoftmaxMetadata('LOG_SOFTMAX',[tensor([])],[tensor([])]).status,'not-run');
    assert.equal(checkSoftmaxMetadata('SOFTMAX',[tensor([2,3],1)],[tensor([2,3],1)],{beta:1}).status,'not-run');
    for(const name of ['SOFTMAX','LOG_SOFTMAX'])for(const type of [2,4,5,6,10,15])assert.throws(()=>checkOperatorMetadata(name,[tensor([2,3],type)],[tensor([2,3],type)],{beta:1}),/dtype/);
    for(const type of [3,9]){
        const f=await softmaxFixture({inputType:type,outputType:7,inputQuantization:{scale:[0.125],zero_point:[type===3?128:0]},outputQuantization:{scale:[1/65536],zero_point:[-32768]}});
        const proof=validateTfliteConstants(f.model,0,()=>assert.fail('No quant payload reads.'));assert.equal(proof.operators[0].status,'not-run');assert.match(proof.operators[0].reason,/混合/);assert.equal(runtimePlan(f.model,f.blob.size).eligible,true);
        assert.doesNotThrow(()=>prepareTfliteModelEdit(f.index,f.file,[{graph:0,operators:[{template:0,inputs:[0],outputs:[1]}]}]));
    }
});
test('finite zero and negative float beta are legal; unverified coefficients never claim a complete static proof',async()=>{
    for(const beta of [0,-1,1]){
        const f=await softmaxFixture({beta});assert.equal(validateTfliteConstants(f.model,0,()=>assert.fail()).checked,1);
    }
    for(const beta of [NaN,Infinity,-Infinity,1e100,undefined])assert.equal(checkSoftmaxMetadata('SOFTMAX',[tensor([2,3])],[tensor([2,3])],{beta}).status,'not-run');
    assert.throws(()=>checkSoftmaxMetadata('SOFTMAX',[tensor([2,3])],[tensor([2,3])],{beta:'1'}),/beta/);
});
test('complete interfaces and runtime legacy codes are checked without interpreting opaque custom ops',async()=>{
    for(const name of ['SOFTMAX','LOG_SOFTMAX']){
        for(const [inputs,outputs]of [[[],[tensor([2])]],[[tensor([2]),tensor([2])],[tensor([2])]],[[tensor([2])],[]],[[null],[tensor([2])]]])assert.throws(()=>checkOperatorMetadata(name,inputs,outputs,{beta:1}),/1 個完整/);
        const f=await softmaxFixture({name,outputType:2});f.model.operator_codes[0].builtin_code=0;assert.equal(runtimePlan(f.model,f.blob.size).eligible,false);
        f.model.operator_codes[0].custom_code='company.opaque';assert.match(runtimePlan(f.model,f.blob.size).reason,/custom/);
    }
});
