import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {runtimeFixture} from './runtime-fixture.mjs';
import {FlatbufferWriter} from '../src/flatbuffer-writer.js';
import {parseModel} from '../src/model-engine.js';
import {editTfliteModel,validateTfliteModelGraph} from '../src/tflite-model-edit.js';
import {checkBuiltinPorts} from '../src/tflite-new-ops.js';
import {validateTfliteConstants} from '../src/tflite-constant-checks.js';

const metadata=JSON.parse(await readFile(new URL('../vendor/netron/tflite-metadata.json',import.meta.url),'utf8'));
const parse=bytes=>parseModel((o,n)=>bytes.subarray(o,o+n),bytes.length,metadata);
const noRead=()=>assert.fail('ADD metadata validation must not read tensor data.');

async function candidate(inputShapes,outputShape,signatures=[]){
    const {model}=await runtimeFixture({inputShapes,outputShape});
    for(const [i,signature]of signatures.entries()){
        if(signature)model.subgraphs[0].tensors[i].shape_signature=Int32Array.from(signature);
    }
    const original=new FlatbufferWriter().finish(model,new Blob());
    const file=new File([original],'broadcast.tflite');
    const index=await parse(new Uint8Array(await original.arrayBuffer()));
    const edit=editTfliteModel(index,file,[{graph:0}]);
    return (await parse(new Uint8Array(await edit.blob.arrayBuffer()))).raw;
}

test('serialized ADD rejects incompatible inputs and stale declared output shape',async()=>{
    for(const [inputs,output,reason]of [
        [[[2,2],[3]],[2,3],/無法 broadcast/],
        [[[2,1],[1,3]],[6],/輸出 shape/],
        [[[2,1],[1,3]],[3,2],/輸出 shape/]
    ]){
        const model=await candidate(inputs,output);
        assert.equal(validateTfliteModelGraph(model,0).passed,true);
        assert.throws(()=>validateTfliteConstants(model,0,noRead),e=>
            /Subgraph #0.*OP #0 ADD.*inputs tensor \[0, 1\].*outputs tensor \[2\]/.test(e.message)&&reason.test(e.message));
    }
});

test('serialized ADD reports supported static broadcasts without payload reads',async()=>{
    for(const [inputs,output]of [
        [[[2,1],[1,3]],[2,3]],
        [[[],[2,3]],[2,3]],
        [[[0,3],[1,3]],[0,3]]
    ]){
        const proof=validateTfliteConstants(await candidate(inputs,output),0,noRead,{budget:0});
        assert.equal(proof.operators[0].status,'passed');
        assert.match(proof.operators[0].reason,/broadcast/);
        assert.equal(proof.checked,1);
        assert.equal(proof.bytesRead,0);
        assert.equal(proof.inspectedBytes,0);
    }
});

test('ADD keeps unknown dimensions unverified and rejects contradictory known dimensions',async()=>{
    // Allocated size 2 can become 1 or 3 at runtime.
    const model=await candidate([[2,2],[1,3]],[2,3],[[2,-1]]);
    const proof=validateTfliteConstants(model,0,noRead);
    assert.equal(proof.operators[0].status,'not-run');
    assert.match(proof.operators[0].reason,/動態|未知/);
    const [a,b,out]=model.subgraphs[0].tensors;
    assert.doesNotThrow(()=>checkBuiltinPorts(0,[a,b],[out],model.subgraphs[0].operators[0].builtin_options));
    const bad=await candidate([[2,2],[3,3]],[2,3],[[2,-1]]);
    assert.throws(()=>validateTfliteConstants(bad,0,noRead),/ADD.*無法 broadcast/);
});

test('ADD distinguishes an unknown rank from a scalar and keeps other dtype kernels unverified',async()=>{
    const model=await candidate([[2],[2]],[2]);
    const [a,b,out]=model.subgraphs[0].tensors;
    for(const tensor of [a,b,out])tensor.type=2;
    let proof=validateTfliteConstants(model,0,noRead);
    assert.equal(proof.operators[0].status,'not-run');
    assert.match(proof.operators[0].reason,/dtype/);
    b.type=0;
    assert.throws(()=>validateTfliteConstants(model,0,noRead),/ADD.*dtype/);
    for(const tensor of [a,b,out])tensor.type=0;
    a.shape=new Int32Array();
    a.has_rank=false;
    out.shape=Int32Array.of(2,2);
    proof=validateTfliteConstants(model,0,noRead);
    assert.equal(proof.operators[0].status,'not-run');
    assert.match(proof.operators[0].reason,/未知/);
});
