import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {readFile} from 'node:fs/promises';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
import vm from 'node:vm';
import {runtimeFixture} from './runtime-fixture.mjs';
import {tflite as schema} from '../vendor/netron/tflite-schema.js';
import {FlatbufferWriter} from '../src/flatbuffer-writer.js';
import {parseModel} from '../src/model-engine.js';
import {editTfliteModel} from '../src/tflite-model-edit.js';
import {validateTfliteConstants} from '../src/tflite-constant-checks.js';
import {runtimePlan} from '../src/tflite-runtime-policy.js';
import {executeRuntime} from '../src/tflite-runtime-execute.js';
import {Archive} from '../vendor/netron/zip.js';

test('signed TRANSPOSE permutations survive actual model edits and produce the pinned CPU outputs',async()=>{
    const base=new URL('../vendor/litert/2.6.0/',import.meta.url),messages=[];
    globalThis.self=globalThis;globalThis.require=createRequire(import.meta.url);globalThis.__dirname=fileURLToPath(base);
    globalThis.importScripts=url=>vm.runInThisContext(readFileSync(new URL(url),'utf8'),{filename:fileURLToPath(url)});
    globalThis.Module={locateFile:name=>fileURLToPath(new URL(name,base)),printErr:s=>messages.push(String(s))};
    const rt=await import('../vendor/litert/2.6.0/core.js');await rt.loadLiteRt(new URL('litert_wasm_compat_internal.js',base).href);
    const metadata=JSON.parse(await readFile(new URL('../vendor/netron/tflite-metadata.json',import.meta.url),'utf8'));
    try{
        for(const [axes,shape,expected]of [[[1,0],[3,2],[1,4,2,5,3,6]],[[-1,0],[3,2],[1,4,2,5,3,6]],[[-2,-1],[2,3],[1,2,3,4,5,6]]]){
            const {model}=await runtimeFixture({inputShapes:[[2,3],[2]],outputShape:shape}),g=model.subgraphs[0];
            model.operator_codes[0].builtin_code=schema.BuiltinOperator.TRANSPOSE;model.operator_codes[0].deprecated_builtin_code=schema.BuiltinOperator.TRANSPOSE;
            const bytes=new Uint8Array(8),view=new DataView(bytes.buffer);axes.forEach((n,i)=>view.setInt32(i*4,n,true));
            model.buffers.push({data:bytes,offset:0n,size:0n});Object.assign(g.tensors[1],{buffer:1,type:2});g.inputs=Int32Array.of(0);g.operators[0].builtin_options=null;
            const original=new FlatbufferWriter().finish(model,new Blob()),raw=new Uint8Array(await original.arrayBuffer()),index=await parseModel((o,n)=>raw.subarray(o,o+n),raw.length,metadata);
            const edited=editTfliteModel(index,new File([original],'signed-transpose.tflite'),[{graph:0,tensors:[{like:2,name:'clone_output'}],operators:[{template:0,inputs:[0,1],outputs:[2]},{template:0,inputs:[0,1],outputs:[3]}],outputs:[2,3]}]);
            const candidate=new Uint8Array(await edited.blob.arrayBuffer()),reopened=await parseModel((o,n)=>candidate.subarray(o,o+n),candidate.length,metadata),graph=reopened.raw.subgraphs[0];
            assert.equal(graph.operators.length,2);assert.equal(validateTfliteConstants(reopened.raw,0,(o,n)=>candidate.subarray(o,o+n)).checked,2);
            for(const op of graph.operators){const t=graph.tensors[op.inputs[1]],b=reopened.raw.buffers[t.buffer];assert.deepEqual(candidate.subarray(Number(b.offset),Number(b.offset+b.size)),bytes,'editing must preserve the original signed permutation bytes');}
            const result=await executeRuntime({blob:edited.blob,plan:runtimePlan(reopened.raw,edited.blob.size),rt,specs:[{mode:'bin',file:new File([Float32Array.of(1,2,3,4,5,6)],'input.bin')}],diagnostics:()=>messages});
            assert.equal(result.status,'passed',JSON.stringify(result));assert.equal(result.invoked,true);
            const zip=Archive.open(new Uint8Array(await result.io.archive.arrayBuffer()),'zip');
            for(const i of [0,1])assert.deepEqual([...new Float32Array(zip.entries.get(`outputs-${i}.bin`).peek().slice().buffer)],expected);
        }
    }finally{rt.unloadLiteRt();}
});
