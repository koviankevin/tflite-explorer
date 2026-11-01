import test from 'node:test';
import assert from 'node:assert/strict';
import {prepareTfliteModelEdit,editTfliteModel,validateTfliteModelGraph} from '../src/tflite-model-edit.js';
import {validateTfliteConstants} from '../src/tflite-constant-checks.js';
import {checkOperatorMetadata} from '../src/tflite-semantic-checks.js';
import {parseModel} from '../src/model-engine.js';
import {readFile} from 'node:fs/promises';
import {createModelEditReport} from '../src/model-edit-report.js';
import {fullyConnectedFixture as fixture} from './fully-connected-fixture.mjs';
const plan=[{graph:0,operators:[{template:0,inputs:[0,1,3],outputs:[2]}]}];
const t=(shape,type=0,extra={})=>({shape,type,has_rank:true,...extra});
const dynamic=t([1,2],0,{shape_signature:[-1,2]}),unknownOutput=t([1,3],0,{shape_signature:[-1,3]});

test('actual FC edit refuses int32 output for floating input and weights',async()=>{
    const f=await fixture({output:{shape:[1,3],type:2}});
    assert.throws(()=>prepareTfliteModelEdit(f.index,f.file,plan),/FULLY_CONNECTED.*dtype/);
});

test('serialized FC report refuses int32 output before reading weight bytes',async()=>{
    const f=await fixture({output:{shape:[1,3],type:2}});
    assert.throws(()=>validateTfliteConstants(f.model,0,()=>assert.fail('Metadata validation must not read weights.')),/FULLY_CONNECTED.*dtype/);
});

test('valid floating FC is still editable as the control',async()=>{
    const f=await fixture();assert.doesNotThrow(()=>prepareTfliteModelEdit(f.index,f.file,plan));
});

for(const inputs of [[0,1],[0,1,-1]])test(`legal optional FC bias is accepted for input slots ${inputs.join(',')}`,async()=>{
    const f=await fixture({bias:null,omitBias:inputs.length===2});
    assert.doesNotThrow(()=>prepareTfliteModelEdit(f.index,f.file,[{graph:0,operators:[{template:0,inputs,outputs:[2]}]}]));
});

for(const [name,spec,error] of [
    ['dynamic-output-dtype',{input:dynamic,output:t([1,3],2,{shape_signature:[-1,3]})},/dtype/],
    ['dynamic-input-weight-rank',{input:dynamic,weights:{shape:[1,3,2],type:0,values:[1,0,0,1,1,1]},output:unknownOutput},/weights.*rank|weights.*二維/],
    ['dynamic-output-bias-size',{output:unknownOutput,bias:{shape:[4],type:0,values:[0,0,0,0]}},/bias.*units/],
    ['dynamic-output-input-size',{input:t([1,3]),output:unknownOutput},/input.*input_size/],
    ['dynamic-input-output-rank',{input:dynamic,output:t([1,1,3],0,{shape_signature:[-1,1,3]})},/output.*rank/],
    ['float-bias-int32',{bias:{shape:[3],type:2,values:[0,0,0]}},/bias.*dtype/],
    ['keep-num-dims-known-last-axis',{input:t([1,2,2]),weights:{shape:[3,4],type:0,values:Array(12).fill(1)},output:t([1,2,3],0,{shape_signature:[-1,2,3]}),options:{keep_num_dims:true}},/keep_num_dims.*input_size/]
]){
    test(`actual FC edit rejects ${name} without hiding known errors behind dynamic extents`,async()=>{
        const f=await fixture(spec);assert.throws(()=>prepareTfliteModelEdit(f.index,f.file,plan),e=>/Subgraph #0.*OP #0.*inputs \[0, 1, 3\].*outputs \[2\]/.test(e.message)&&/FULLY_CONNECTED/.test(e.message)&&error.test(e.message));
    });
    test(`serialized FC report rejects ${name} before weight reads`,async()=>{
        const f=await fixture(spec);assert.throws(()=>validateTfliteConstants(f.model,0,()=>assert.fail('No weight reads.')),e=>/Subgraph #0.*OP #0 FULLY_CONNECTED.*inputs tensor \[0, 1, 3\].*outputs tensor \[2\]/.test(e.message)&&error.test(e.message));
    });
}

test('floating FC edit and reopen preserves optional bias slots, original weights and legacy concrete rank',async()=>{
    const metadata=JSON.parse(await readFile(new URL('../vendor/netron/tflite-metadata.json',import.meta.url),'utf8'));
    for(const bias of [true,false])for(const omitted of [true,false]){
        if(bias&&omitted)continue;
        const f=await fixture({input:t([1,2],0,{has_rank:false}),...(bias?{bias:{shape:[1,3],type:0,values:[1,2,3]}}:{bias:null,omitBias:omitted})}),inputs=bias?[0,1,3]:omitted?[0,1]:[0,1,-1];
        const edited=editTfliteModel(f.index,f.file,[{graph:0,operators:[{template:0,inputs,outputs:[2]}]}]),bytes=new Uint8Array(await edited.blob.arrayBuffer()),read=(o,n)=>bytes.subarray(o,o+n),reopened=await parseModel(read,bytes.length,metadata);
        assert.deepEqual(Array.from(reopened.raw.subgraphs[0].operators[0].inputs),inputs);assert.equal(reopened.raw.subgraphs[0].tensors[0].has_rank,false);assert.doesNotThrow(()=>validateTfliteModelGraph(reopened.raw,0));
        const proof=validateTfliteConstants(reopened.raw,0,()=>assert.fail('FC must not inspect payloads.'),{budget:0});assert.equal(proof.checked,1);assert.equal(proof.unchecked,0);assert.equal(proof.bytesRead,0);assert.equal(proof.inspectedBytes,0);assert.equal(proof.operators[0].status,'passed');
        for(const [id,b] of f.model.buffers.entries())if(b.size){const a=reopened.raw.buffers[id];assert.deepEqual(read(Number(a.offset),Number(a.size)),f.read(Number(b.offset),Number(b.size)));}
    }
});

test('FC dynamic dimensions, unknown quant_spec and unsupported mixed encoding retain explicit not-run status',async()=>{
    const specs=[{input:dynamic,output:unknownOutput},{options:{quant_spec:Uint8Array.of(1,2,3)}},{input:t([1,2],1),weights:t([3,2],1),output:t([1,3],1),bias:null},{input:t([1,2],3),weights:{shape:[3,2],type:3,values:[1,0,0,1,1,1]},output:t([1,3],7),bias:{shape:[3],type:2,values:[0,0,0]}},{options:{weights_format:1},workspace:t([1,2],3)}];
    for(const spec of specs){
        const f=await fixture(spec),op=f.model.subgraphs[0].operators[0],inputs=Array.from(op.inputs);assert.doesNotThrow(()=>prepareTfliteModelEdit(f.index,f.file,[{graph:0,operators:[{template:0,inputs,outputs:Array.from(op.outputs)}]}]));
        const proof=validateTfliteConstants(f.model,0,()=>assert.fail('No reads for unverified metadata.'),{budget:0});assert.equal(proof.checked,0);assert.equal(proof.unchecked,1);assert.equal(proof.operators[0].status,'not-run');assert.ok(proof.operators[0].reason);
    }
});

test('known hybrid FC and int64 quantized bias keep their valid metadata relationships',()=>{
    assert.doesNotThrow(()=>checkOperatorMetadata('FULLY_CONNECTED',[t([1,2]),t([3,2],9),t([3])],[t([1,3])],{}));
    assert.doesNotThrow(()=>checkOperatorMetadata('FULLY_CONNECTED',[t([1,2],7),t([3,2],9),t([3],4)],[t([1,3],7)],{}));
});

test('FC export report exposes checked versus unknown contract verdicts while runtime stays manual',async()=>{
    const metadata=JSON.parse(await readFile(new URL('../vendor/netron/tflite-metadata.json',import.meta.url),'utf8'));
    for(const unknown of [false,true]){
        const f=await fixture(unknown?{options:{quant_spec:Uint8Array.of(1,2,3)}}:{}),exported=editTfliteModel(f.index,f.file,plan),bytes=new Uint8Array(await exported.blob.arrayBuffer()),candidate=await parseModel((o,n)=>bytes.subarray(o,o+n),bytes.length,metadata);
        exported.semanticValidation=[validateTfliteConstants(candidate.raw,0,()=>assert.fail('No FC weight reads.'))];exported.roundTrip=true;
        const built=createModelEditReport(f.index,f.file,exported,candidate,{graph:0,node:0,mode:'replace'},{outputName:'fc-edited.tflite'}),report=JSON.parse(await built.blob.text());
        assert.equal(report.operatorSummary.checked,unknown?0:1);assert.equal(report.operatorSummary.unchecked,unknown?1:0);
        assert.equal(report.operatorValidation[0].type,'FULLY_CONNECTED');assert.equal(report.operatorValidation[0].status,unknown?'not-run':'passed');assert.match(report.operatorValidation[0].reason,unknown?/quant_spec/:/未讀權重/);
        assert.ok(report.checks.filter(c=>c.id.startsWith('runtime')).every(c=>c.status==='not-run'));assert.ok(!JSON.stringify(report).includes('"values"'));
        assert.deepEqual(candidate.raw.subgraphs[0].operators[0].builtin_options.quant_spec,f.model.subgraphs[0].operators[0].builtin_options.quant_spec);
    }
});

test('custom op named FULLY_CONNECTED never enters builtin metadata rules',async()=>{
    const f=await fixture({output:t([1,3],2)});f.model.operator_codes[0].custom_code='FULLY_CONNECTED';
    assert.doesNotThrow(()=>prepareTfliteModelEdit(f.index,f.file,plan));
    const proof=validateTfliteConstants(f.model,0,()=>assert.fail('Custom payload must not be interpreted.'));
    assert.equal(proof.operators[0].status,'not-run');assert.match(proof.operators[0].reason,/custom kernel/);
});
