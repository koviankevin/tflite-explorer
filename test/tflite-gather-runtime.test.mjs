import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {readFile} from 'node:fs/promises';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
import vm from 'node:vm';
import {gatherFixture as fixture} from './gather-fixture.mjs';
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

test('pinned CPU executes edited GATHER indices encodings, negative options, batches and empty output with exact results',async()=>{
    const base=new URL('../vendor/litert/2.6.0/',import.meta.url),messages=[];
    globalThis.self=globalThis;globalThis.require=createRequire(import.meta.url);globalThis.__dirname=fileURLToPath(base);
    globalThis.importScripts=url=>vm.runInThisContext(readFileSync(new URL(url),'utf8'),{filename:fileURLToPath(url)});
    globalThis.Module={locateFile:name=>fileURLToPath(new URL(name,base)),printErr:s=>{messages.push(String(s));if(messages.length>16)messages.shift();}};
    const rt=await import('../vendor/litert/2.6.0/core.js');await rt.loadLiteRt(new URL('litert_wasm_compat_internal.js',base).href);
    const metadata=JSON.parse(await readFile(new URL('../vendor/netron/tflite-metadata.json',import.meta.url),'utf8'));
    const q={scale:Float32Array.of(1),zero_point:BigInt64Array.of(0n),quantized_dimension:0};
    const cases=[
        ...[2,4,7].map(type=>({name:`indices-${type}`,spec:{indices:{shape:[2],type,values:[0,2]}},input:[1,2,3,4,5,6],expected:[1,3,4,6]})),
        {name:'negative-axis',spec:{options:{axis:-1}},input:[1,2,3,4,5,6],expected:[1,3,4,6]},
        {name:'scalar-indices',spec:{indices:{shape:[],type:2,values:[1]},output:t([2])},input:[1,2,3,4,5,6],expected:[2,5]},
        {name:'negative-batch',spec:{params:t([2,2,3]),indices:{shape:[2,2],type:2,values:[0,2,1,0]},output:t([2,2,2]),options:{axis:-1,batch_dims:-1}},input:[1,2,3,4,5,6,7,8,9,10,11,12],expected:[1,3,4,6,8,7,11,10]},
        {name:'batch-equals-indices-rank',spec:{params:t([2,2,3]),indices:{shape:[2,2],type:2,values:[1,2,0,1]},output:t([2,2]),options:{axis:2,batch_dims:2}},input:[1,2,3,4,5,6,7,8,9,10,11,12],expected:[2,6,7,11]},
        ...[7,9].map(type=>({name:`quantized-params-${type}`,spec:{params:t([2,3],type,{quantization:q}),output:t([2,2],type,{quantization:q})},input:[1,2,3,4,5,6],expected:[1,3,4,6]})),
        ...['full','cut','composition'].map(mode=>({name:`empty-indices-${mode}`,mode,spec:{indices:{shape:[0],type:2,values:[]},output:t([2,0])},input:[1,2,3,4,5,6],expected:[]}))
    ];
    try{
        for(const c of cases){
            const f=await fixture(c.spec);let edited;
            if(c.mode==='cut')edited=exportTflite(f.index,0,[0],f.file);
            else if(c.mode==='composition'){
                const snapshot=editWorkspaceSnapshot(f.index,{targets:[{graph:0,node:0}],composition:true}),draft=modelEditDraft(snapshot);
                draft.apply({kind:'import',node:'op:0:0',nodes:['op:0:0'],label:'public empty Gather'});edited=await exportEditWorkspace(f.index,f.file,snapshot,draft.commands);
            }else edited=editTfliteModel(f.index,f.file,[{graph:0,operators:[{template:0,inputs:[0,1],outputs:[2]}]}]);
            const bytes=new Uint8Array(await edited.blob.arrayBuffer()),read=(o,n)=>bytes.subarray(o,o+n),candidate=await parseModel(read,bytes.length,metadata);
            const proof=validateTfliteConstants(candidate.raw,0,read);assert.equal(proof.checked,1);assert.equal(proof.unchecked,0);
            const type=candidate.raw.subgraphs[0].tensors[0].type,Data={0:Float32Array,7:Int16Array,9:Int8Array}[type];messages.length=0;
            const result=await executeRuntime({blob:edited.blob,plan:runtimePlan(candidate.raw,bytes.length),rt,specs:[{mode:'bin',file:new File([Data.from(c.input)],'input.bin')}],diagnostics:()=>messages});
            assert.equal(result.status,'passed',`${c.name}: ${JSON.stringify(result)}`);assert.equal(result.invoked,true);
            const archive=result.io.archive instanceof Uint8Array?result.io.archive:new Uint8Array(await result.io.archive.arrayBuffer()),z=Archive.open(archive,'zip'),body=z.entries.get('outputs-0.bin').peek().slice();
            assert.deepEqual(Array.from(new Data(body.buffer,body.byteOffset,body.byteLength/Data.BYTES_PER_ELEMENT)),c.expected,c.name);
            for(const [id,a] of f.model.buffers.entries())if(a.size){const b=candidate.raw.buffers[id];assert.deepEqual(read(Number(b.offset),Number(b.size)),f.read(Number(a.offset),Number(a.size)),c.name+' source bytes');}
        }
    }finally{await rt.unloadLiteRt();}
});
