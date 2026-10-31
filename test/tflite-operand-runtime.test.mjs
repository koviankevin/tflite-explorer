import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {readFile} from 'node:fs/promises';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
import vm from 'node:vm';
import {operandFixture} from './operand-fixture.mjs';
import {runtimePlan} from '../src/tflite-runtime-policy.js';
import {executeRuntime} from '../src/tflite-runtime-execute.js';
import {parseModel} from '../src/model-engine.js';
import {editTfliteModel} from '../src/tflite-model-edit.js';
import {validateTfliteConstants} from '../src/tflite-constant-checks.js';
import {Archive} from '../vendor/netron/zip.js';
const t=(shape,type=0,values)=>({shape,type,...(values===undefined?{}:{values})});
test('pinned CPU checks actual edited operand-family exports and every output byte',async()=>{
    const base=new URL('../vendor/litert/2.6.0/',import.meta.url),diagnostics=[];
    globalThis.self=globalThis;globalThis.require=createRequire(import.meta.url);globalThis.__dirname=fileURLToPath(base);
    globalThis.importScripts=url=>vm.runInThisContext(readFileSync(new URL(url),'utf8'),{filename:fileURLToPath(url)});
    globalThis.Module={locateFile:name=>fileURLToPath(new URL(name,base)),printErr:s=>diagnostics.push(String(s))};
    const rt=await import('../vendor/litert/2.6.0/core.js');await rt.loadLiteRt(new URL('litert_wasm_compat_internal.js',base).href);
    const metadata=JSON.parse(await readFile(new URL('../vendor/netron/tflite-metadata.json',import.meta.url),'utf8'));
    const cases=[
        ['PAD',[t([2]),t([1,2],2,[1,1])],[t([4])],{},[1,2],[[0,1,2,0]]],
        ['PADV2',[t([2]),t([1,2],2,[1,2]),t([],0,[7])],[t([5])],{},[1,2],[[7,1,2,7,7]]],
        ['SLICE',[t([2,3]),t([2],2,[0,1]),t([2],2,[-1,2])],[t([2,2])],{},[1,2,3,4,5,6],[[2,3,5,6]]],
        ['STRIDED_SLICE',[t([5]),t([1],2,[0]),t([1],2,[0]),t([1],2,[-1])],[t([5])],{begin_mask:1,end_mask:1},[1,2,3,4,5],[[5,4,3,2,1]]],
        ['STRIDED_SLICE',[t([2,3]),t([3],2,[0,0,-1]),t([3],2,[0,0,0]),t([3],2,[1,1,1])],[t([2,1])],{ellipsis_mask:1,new_axis_mask:2,shrink_axis_mask:4},[1,2,3,4,5,6],[[3,6]]],
        ['SPLIT',[t([],2,[1]),t([2,4])],[t([2,2]),t([2,2])],{num_splits:2},[1,2,3,4,5,6,7,8],[[1,2,5,6],[3,4,7,8]]],
        ['SPLIT_V',[t([6]),t([3],2,[1,-1,2]),t([],2,[0])],[t([1]),t([3]),t([2])],{num_splits:3},[1,2,3,4,5,6],[[1],[2,3,4],[5,6]]],
        ...[['MEAN',[2,5]],['SUM',[6,15]],['REDUCE_PROD',[6,120]],['REDUCE_MIN',[1,4]],['REDUCE_MAX',[3,6]]].map(([name,out])=>[name,[t([2,3]),t([1],2,[-1])],[t([2])],{keep_dims:false},[1,2,3,4,5,6],[out]]),
        ['REDUCE_ANY',[t([2,3],6),t([1],2,[1])],[t([2],6)],{keep_dims:false},[0,1,0,0,0,0],[[1,0]]],
        ['REDUCE_ALL',[t([2,3],6),t([1],2,[1])],[t([2],6)],{keep_dims:false},[1,1,1,1,0,1],[[1,0]]]
    ];
    try{
        for(const [name,inputs,outputs,options,inputValues,expected]of cases){
            const f=await operandFixture(name,inputs,outputs,options),op=f.model.subgraphs[0].operators[0];
            const result=editTfliteModel(f.index,f.file,[{graph:0,operators:[{template:0,inputs:Array.from(op.inputs)}]}]);
            const raw=new Uint8Array(await result.blob.arrayBuffer()),candidate=await parseModel((o,n)=>raw.subarray(o,o+n),raw.length,metadata);
            assert.equal(validateTfliteConstants(candidate.raw,0,(o,n)=>raw.subarray(o,o+n)).checked,1,name);
            const b=inputs[0].type===6?Uint8Array.from(inputValues):Float32Array.from(inputValues);
            const invoked=await executeRuntime({blob:result.blob,plan:runtimePlan(candidate.raw,raw.length),rt,specs:[{mode:'bin',file:new File([b],'input.bin')}],diagnostics:()=>diagnostics});
            assert.equal(invoked.status,'passed',name+': '+JSON.stringify(invoked));
            const zip=Archive.open(new Uint8Array(await invoked.io.archive.arrayBuffer()),'zip');
            for(const [i,values]of expected.entries()){
                const body=zip.entries.get(`outputs-${i}.bin`).peek().slice(),actual=outputs[i].type===6?Array.from(body):Array.from(new Float32Array(body.buffer));
                assert.deepEqual(actual,values,`${name} output ${i}`);
            }
            for(let id=1;id<f.model.buffers.length;id++){
                const old=f.model.buffers[id],now=candidate.raw.buffers[id];
                assert.deepEqual(raw.subarray(Number(now.offset),Number(now.offset+now.size)),f.bytes.subarray(Number(old.offset),Number(old.offset+old.size)),`${name} buffer #${id}`);
            }
        }
    }finally{rt.unloadLiteRt();}
});
