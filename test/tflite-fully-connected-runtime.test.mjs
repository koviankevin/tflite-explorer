import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {readFile} from 'node:fs/promises';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
import vm from 'node:vm';
import {fullyConnectedFixture as fixture} from './fully-connected-fixture.mjs';
import {editTfliteModel} from '../src/tflite-model-edit.js';
import {parseModel} from '../src/model-engine.js';
import {runtimePlan} from '../src/tflite-runtime-policy.js';
import {executeRuntime} from '../src/tflite-runtime-execute.js';
import {validateTfliteConstants} from '../src/tflite-constant-checks.js';
import {exportTflite} from '../src/tflite-export.js';
import {editWorkspaceSnapshot,exportEditWorkspace} from '../src/model-edit-workspace.js';
import {modelEditDraft} from '../src/model-edit-draft.js';
import {Archive} from '../vendor/netron/zip.js';
const t=(shape,type=0,extra={})=>({shape,type,...extra});

test('actual CPU keeps float, hybrid, quantized, optional-bias, cut and composition FC exports executable',async()=>{
    const base=new URL('../vendor/litert/2.6.0/',import.meta.url),messages=[];
    globalThis.self=globalThis;globalThis.require=createRequire(import.meta.url);globalThis.__dirname=fileURLToPath(base);
    globalThis.importScripts=url=>vm.runInThisContext(readFileSync(new URL(url),'utf8'),{filename:fileURLToPath(url)});
    globalThis.Module={locateFile:name=>fileURLToPath(new URL(name,base)),printErr:s=>{messages.push(String(s));if(messages.length>16)messages.shift();}};
    const rt=await import('../vendor/litert/2.6.0/core.js');await rt.loadLiteRt(new URL('litert_wasm_compat_internal.js',base).href);
    const metadata=JSON.parse(await readFile(new URL('../vendor/netron/tflite-metadata.json',import.meta.url),'utf8'));
    const q={scale:Float32Array.of(1),zero_point:BigInt64Array.of(0n),quantized_dimension:0},u={...q,zero_point:BigInt64Array.of(128n)},weights=[1,0,0,1,1,1];
    const cases=[
        {name:'float',spec:{}},
        {name:'row-bias',spec:{bias:{shape:[1,3],type:0,values:[1,2,3]}},expected:[2,4,6]},
        ...[false,true].map(omitBias=>({name:`optional-bias-${omitBias?'two-slots':'sentinel'}`,spec:{bias:null,omitBias}})),
        {name:'flattened-batch',spec:{input:t([2,1,2]),output:t([2,3])},input:[1,2,3,4],expected:[1,2,3,3,4,7]},
        {name:'keep-num-dims',spec:{input:t([2,1,2]),output:t([2,1,3]),options:{keep_num_dims:true}},input:[1,2,3,4],expected:[1,2,3,3,4,7]},
        ...[false,true].map(asymmetric_quantize_inputs=>({name:`hybrid-${asymmetric_quantize_inputs}`,spec:{weights:{shape:[3,2],type:9,values:weights,quantization:q},options:{asymmetric_quantize_inputs}},tolerance:.04})),
        {name:'int8',spec:{input:t([1,2],9,{quantization:q}),weights:{shape:[3,2],type:9,values:weights,quantization:q},bias:{shape:[3],type:2,values:[0,0,0],quantization:q},output:t([1,3],9,{quantization:q})}},
        {name:'uint8',spec:{input:t([1,2],3,{quantization:u}),weights:{shape:[3,2],type:3,values:weights.map(n=>n+128),quantization:u},bias:{shape:[3],type:2,values:[0,0,0],quantization:q},output:t([1,3],3,{quantization:u})},input:[129,130],expected:[129,130,131]},
        {name:'int16-int8-int64-bias',spec:{input:t([1,2],7,{quantization:q}),weights:{shape:[3,2],type:9,values:weights,quantization:q},bias:{shape:[3],type:4,values:[0,0,0],quantization:q},output:t([1,3],7,{quantization:q}),options:{quantized_bias_type:4}}},
        ...['cut','composition'].map(mode=>({name:`optional-bias-${mode}`,mode,spec:{bias:null}}))
    ];
    try{
        for(const c of cases){
            const f=await fixture(c.spec),op=f.model.subgraphs[0].operators[0];let exported;
            if(c.mode==='cut')exported=exportTflite(f.index,0,[0],f.file);
            else if(c.mode==='composition'){
                const snapshot=editWorkspaceSnapshot(f.index,{targets:[{graph:0,node:0}],composition:true}),draft=modelEditDraft(snapshot);
                draft.apply({kind:'import',node:'op:0:0',nodes:['op:0:0'],label:'public FC without bias'});exported=await exportEditWorkspace(f.index,f.file,snapshot,draft.commands);
            }else exported=editTfliteModel(f.index,f.file,[{graph:0,operators:[{template:0,inputs:Array.from(op.inputs),outputs:Array.from(op.outputs)}]}]);
            const bytes=new Uint8Array(await exported.blob.arrayBuffer()),read=(o,n)=>bytes.subarray(o,o+n),candidate=await parseModel(read,bytes.length,metadata),g=candidate.raw.subgraphs[0];
            const proof=validateTfliteConstants(candidate.raw,0,()=>assert.fail('FC metadata must not read weights.'),{budget:0});assert.equal(proof.checked,1,c.name);assert.equal(proof.unchecked,0,c.name);
            assert.equal(g.inputs.length,1,c.name);const type=g.tensors[g.inputs[0]].type,Data={0:Float32Array,3:Uint8Array,7:Int16Array,9:Int8Array}[type];messages.length=0;
            const result=await executeRuntime({blob:exported.blob,plan:runtimePlan(candidate.raw,bytes.length),rt,specs:[{mode:'bin',file:new File([Data.from(c.input??[1,2])],'input.bin')}],diagnostics:()=>messages});
            assert.equal(result.status,'passed',`${c.name}: ${JSON.stringify(result)}`);assert.equal(result.invoked,true);
            const archive=result.io.archive instanceof Uint8Array?result.io.archive:new Uint8Array(await result.io.archive.arrayBuffer()),z=Archive.open(archive,'zip'),body=z.entries.get('outputs-0.bin').peek().slice(),actual=Array.from(new Data(body.buffer,body.byteOffset,body.byteLength/Data.BYTES_PER_ELEMENT)),expected=c.expected??[1,2,3];
            assert.equal(actual.length,expected.length,c.name);actual.forEach((v,i)=>assert.ok(Math.abs(v-expected[i])<=(c.tolerance??0),`${c.name}: output ${i} ${v} != ${expected[i]}`));
            const a=f.model.subgraphs[0];
            for(const slot of [1,2])if(a.operators[0].inputs[slot]>=0){
                const before=a.tensors[a.operators[0].inputs[slot]],after=g.tensors[g.operators[0].inputs[slot]],b=f.model.buffers[before.buffer],d=candidate.raw.buffers[after.buffer];
                assert.deepEqual(read(Number(d.offset),Number(d.size)),f.read(Number(b.offset),Number(b.size)),c.name+` exact original const slot ${slot}`);assert.deepEqual(after.quantization,before.quantization,c.name+' quantization');
            }
            assert.equal(candidate.raw.operator_codes[g.operators[0].opcode_index].version,f.model.operator_codes[0].version,c.name+' version');
        }
    }finally{await rt.unloadLiteRt();}
});
