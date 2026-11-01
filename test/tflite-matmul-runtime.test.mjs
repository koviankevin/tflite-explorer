import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {readFile} from 'node:fs/promises';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
import vm from 'node:vm';
import {batchMatmulFixture as fixture} from './batch-matmul-fixture.mjs';
import {editTfliteModel} from '../src/tflite-model-edit.js';
import {parseModel} from '../src/model-engine.js';
import {runtimePlan} from '../src/tflite-runtime-policy.js';
import {executeRuntime} from '../src/tflite-runtime-execute.js';
import {validateTfliteConstants} from '../src/tflite-constant-checks.js';
import {Archive} from '../vendor/netron/zip.js';
const t=(shape,type=0,values,quantization)=>({shape,type,...(values?{values}:{}),...(quantization?{quantization}:{})});

test('pinned CPU preserves BMM adjoints, batch broadcast, hybrid and integer accumulators after actual edit export',async()=>{
    const base=new URL('../vendor/litert/2.6.0/',import.meta.url),messages=[];
    globalThis.self=globalThis;globalThis.require=createRequire(import.meta.url);globalThis.__dirname=fileURLToPath(base);
    globalThis.importScripts=url=>vm.runInThisContext(readFileSync(new URL(url),'utf8'),{filename:fileURLToPath(url)});
    globalThis.Module={locateFile:name=>fileURLToPath(new URL(name,base)),printErr:s=>{messages.push(String(s));if(messages.length>16)messages.shift();}};
    const rt=await import('../vendor/litert/2.6.0/core.js');await rt.loadLiteRt(new URL('litert_wasm_compat_internal.js',base).href);
    const metadata=JSON.parse(await readFile(new URL('../vendor/netron/tflite-metadata.json',import.meta.url),'utf8'));
    const q={scale:Float32Array.of(1),zero_point:BigInt64Array.of(0n),quantized_dimension:0};
    const cases=[
        ...[[false,false,[19,22,43,50]],[true,false,[26,30,38,44]],[false,true,[17,23,39,53]],[true,true,[23,31,34,46]]].map(([adj_x,adj_y,expected])=>({name:`float-${adj_x}-${adj_y}`,spec:{rhs:t([2,2],0,[5,6,7,8]),options:{adj_x,adj_y}},input:[1,2,3,4],expected})),
        {name:'unequal-batch-ranks',spec:{lhs:t([2,1,2,2]),rhs:t([3,2,2],0,[1,0,0,1,2,0,0,2,3,0,0,3]),output:t([2,3,2,2])},input:[1,2,3,4,5,6,7,8],expected:[1,2,3,4,2,4,6,8,3,6,9,12,5,6,7,8,10,12,14,16,15,18,21,24]},
        ...[false,true].map(asymmetric_quantize_inputs=>({name:`hybrid-${asymmetric_quantize_inputs}`,spec:{rhs:t([2,2],9,[1,0,0,1],q),options:{asymmetric_quantize_inputs}},input:[1,2,3,4],expected:[1,2,3,4],tolerance:0.025})),
        {name:'int8-to-int32',spec:{lhs:t([2,2],9),rhs:t([2,2],9,[1,0,0,1]),output:t([2,2],2)},input:[1,2,3,4],expected:[1,2,3,4]},
        {name:'quantized-int8',spec:{lhs:t([2,2],9,undefined,q),rhs:t([2,2],9,[1,0,0,1],q),output:t([2,2],9,undefined,q)},input:[1,2,3,4],expected:[1,2,3,4]},
        {name:'int16-int8',spec:{lhs:t([2,2],7,undefined,q),rhs:t([2,2],9,[1,0,0,1],q),output:t([2,2],7,undefined,q)},input:[1,2,3,4],expected:[1,2,3,4]}
    ];
    try{
        for(const c of cases){
            const f=await fixture(c.spec),edited=editTfliteModel(f.index,f.file,[{graph:0,operators:[{template:0,inputs:[0,1]}]}]),bytes=new Uint8Array(await edited.blob.arrayBuffer()),candidate=await parseModel((o,n)=>bytes.subarray(o,o+n),bytes.length,metadata);
            assert.equal(validateTfliteConstants(candidate.raw,0,()=>assert.fail('BMM validation must not read weights.')).checked,1,c.name);
            const inputType=candidate.raw.subgraphs[0].tensors[0].type,Data=inputType===9?Int8Array:inputType===7?Int16Array:Float32Array;
            messages.length=0;const result=await executeRuntime({blob:edited.blob,plan:runtimePlan(candidate.raw,bytes.length),rt,specs:[{mode:'bin',file:new File([Data.from(c.input)],'input.bin')}],diagnostics:()=>messages});
            assert.equal(result.status,'passed',`${c.name}: ${JSON.stringify(result)}`);assert.equal(result.invoked,true);
            const archive=result.io.archive instanceof Uint8Array?result.io.archive:new Uint8Array(await result.io.archive.arrayBuffer()),z=Archive.open(archive,'zip'),body=z.entries.get('outputs-0.bin').peek().slice(),type=candidate.raw.subgraphs[0].tensors[2].type;
            const actual=Array.from(type===9?new Int8Array(body.buffer):type===7?new Int16Array(body.buffer):type===2?new Int32Array(body.buffer):new Float32Array(body.buffer));
            assert.equal(actual.length,c.expected.length,c.name);
            actual.forEach((v,i)=>assert.ok(Math.abs(v-c.expected[i])<=(c.tolerance??0),`${c.name} output ${i}: ${v} != ${c.expected[i]}`));
            for(let id=1;id<f.model.buffers.length;id++){
                const a=f.model.buffers[id],b=candidate.raw.buffers[id];assert.deepEqual(bytes.subarray(Number(b.offset),Number(b.offset+b.size)),f.bytes.subarray(Number(a.offset),Number(a.offset+a.size)),c.name+' weights');
            }
        }
        const bad=await fixture({output:t([2,2],2)});
        assert.throws(()=>editTfliteModel(bad.index,bad.file,[{graph:0,operators:[{template:0,inputs:[0,1]}]}]),/BATCH_MATMUL.*dtype/);
    }finally{await rt.unloadLiteRt();}
});
