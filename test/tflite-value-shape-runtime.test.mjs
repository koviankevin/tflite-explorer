import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createRequire} from 'node:module';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import vm from 'node:vm';
import {valueShapeFixtures} from './value-shape-fixture.mjs';
import {axisTransformFixture} from './axis-transform-fixture.mjs';
import {runtimePlan,RUNTIME_INTERPRETER_ENGINE} from '../src/tflite-runtime-policy.js';
import {executeRuntime} from '../src/tflite-runtime-execute.js';
import {interpreterRuntime} from '../src/tflite-interpreter-runtime.js';
import {precompileInterpreterBindings} from '../scripts/lib/interpreter-bindings.mjs';
import {Archive} from '../vendor/netron/zip.js';
import {FlatbufferWriter} from '../src/flatbuffer-writer.js';
const base=new URL('../vendor/tflite-interpreter/0.0.1-alpha.10/',import.meta.url),sha=bytes=>createHash('sha256').update(bytes).digest('hex');
test('Interpreter AOT loader is reproducible from pinned upstream bytes and preserves all published source hashes',async()=>{
    const provenance=JSON.parse(await readFile(new URL('provenance.json',base),'utf8'));
    for(const f of provenance.files){const bytes=await readFile(new URL(f.path,base));assert.equal(bytes.length,f.bytes);assert.equal(sha(bytes),f.sha256);}
    const original=await readFile(new URL('../scripts/data/interpreter-upstream.js',import.meta.url));
    const table=await readFile(new URL('../scripts/data/interpreter-binding-factories.json',import.meta.url));assert.equal(sha(table),provenance.bindingsSHA256);
    assert.equal(precompileInterpreterBindings(original,JSON.parse(table)),await readFile(new URL('tflite_web_api_cc.js',base),'utf8'));
    assert.throws(()=>precompileInterpreterBindings(original.toString()+' ',JSON.parse(table)),/Unexpected upstream/);
});
test('value-dependent input, produced and variable shape tensors select Interpreter; literals keep CompiledModel',async()=>{
    for(const f of await valueShapeFixtures()){
        const plan=runtimePlan(f.model,f.blob.size);assert.equal(plan.eligible,true);
        assert.equal(plan.runtimeBackend,f.axisInput?'interpreter':'compiled',f.name);
        if(f.axisInput){assert.equal(plan.engine,RUNTIME_INTERPRETER_ENGINE);assert.equal(plan.valueDependentShapeOps.length,1);}
        if(f.axisInput){f.model.operator_codes[0].builtin_code=0;assert.equal(runtimePlan(f.model,f.blob.size).runtimeBackend,'interpreter',f.name+' deprecated builtin');}
    }
    for(const mode of ['producer','variable']){
        const f=await axisTransformFixture(),g=f.model.subgraphs[0];
        if(mode==='producer')g.operators.push({...g.operators[0],outputs:[1]});else g.tensors[1].is_variable=true;
        assert.equal(runtimePlan(f.model,f.blob.size).runtimeBackend,'interpreter');
    }
    const f=await axisTransformFixture({name:'EXPAND_DIMS',axisType:4,axes:[1],axisShape:[],axisInput:true,output:[2,1,3]});
    const plan=runtimePlan(f.model,f.blob.size);assert.match(plan.reason,/input／output dtype/);
    const skipped=await executeRuntime({blob:{size:f.blob.size,arrayBuffer(){throw Error('must not read');}},plan,rt:null});assert.equal(skipped.status,'not-verified');assert.equal(skipped.engine,RUNTIME_INTERPRETER_ENGINE);
});
test('a stale CompiledModel path is refused before reading a value-dependent model body',async()=>{
    const f=(await valueShapeFixtures())[0];let reads=0;
    const result=await executeRuntime({blob:{size:f.blob.size,arrayBuffer(){reads++;throw Error('must not read');}},plan:runtimePlan(f.model,f.blob.size),rt:{},specs:f.values.map(v=>({mode:'bin',file:new File([v],'input.bin')}))});
    assert.equal(result.status,'failed');assert.equal(result.invoked,false);assert.equal(reads,0);assert.match(result.reason,/標準 Interpreter/);
});
test('actual AOT Interpreter runs without string compilation and saves exact raw inputs and numerical outputs for all eight unchanged models',async()=>{
    const messages=[],context=vm.createContext({require:createRequire(import.meta.url),process,Buffer,console,TextDecoder,TextEncoder,WebAssembly,setTimeout,clearTimeout,__dirname:fileURLToPath(base),...Object.fromEntries(['Uint8Array','Int8Array','Uint16Array','Int16Array','Uint32Array','Int32Array','Float32Array','Float64Array','ArrayBuffer'].map(n=>[n,globalThis[n]]))},{codeGeneration:{strings:false,wasm:true}});
    vm.runInContext(await readFile(new URL('tflite_web_api_cc.js',base),'utf8'),context);
    const module=await context.tflite_web_api_ModuleFactory({wasmBinary:await readFile(new URL('tflite_web_api_cc.wasm',base)),printErr:s=>messages.push(String(s))}),rt=interpreterRuntime(module);
    for(const f of await valueShapeFixtures()){
        // Deliberately exercise the standard Interpreter for controls too;
        // policy chooses it only for the input-dependent transform cases.
        const plan=runtimePlan(f.model,f.blob.size),specs=f.values.map((v,i)=>({mode:'bin',file:new File([v],i+'.bin')}));
        const result=await executeRuntime({blob:f.blob,plan,rt,specs,diagnostics:()=>messages});
        assert.equal(result.status,'passed',f.name+': '+result.reason);assert.equal(result.engine,RUNTIME_INTERPRETER_ENGINE);assert.equal(result.modelSHA256,sha(f.bytes));
        const zip=Archive.open(new Uint8Array(await result.io.archive.arrayBuffer()),'zip');
        assert.deepEqual([...new (f.values[0].constructor)(zip.entries.get('outputs-0.bin').peek().slice().buffer)],f.expected,f.name);
        for(const [i,v]of f.values.entries())assert.deepEqual(Buffer.from(zip.entries.get('inputs-'+i+'.bin').peek()),Buffer.from(v.buffer,v.byteOffset,v.byteLength),f.name);
        const manifest=JSON.parse(new TextDecoder().decode(zip.entries.get('manifest.json').peek()));assert.equal(manifest.modelSHA256,sha(f.bytes));assert.equal(manifest.validation.engine,RUNTIME_INTERPRETER_ENGINE);
    }
    const f=(await valueShapeFixtures())[0],plan=runtimePlan(f.model,f.blob.size),result=await executeRuntime({blob:f.blob,plan,rt,specs:[{mode:'bin',file:new File([f.values[0]],'data.bin')},{mode:'bin',file:new File([Int32Array.of(0,1)],'axis.bin')}]});
    assert.equal(result.status,'failed');assert.equal(result.invoked,true);assert.match(result.reason,/輸出 shape/);
    assert.deepEqual(result.io.manifest.outputs[0].shape,[2,3]);
    f.model.operator_codes[0].builtin_code=0;const legacy=await new FlatbufferWriter().finish(f.model,new Blob());
    const executed=await executeRuntime({blob:legacy,plan:runtimePlan(f.model,legacy.size),rt,specs:f.values.map(v=>({mode:'bin',file:new File([v],'legacy.bin')}))});
    assert.equal(executed.status,'passed',executed.reason);
    const legacyZip=Archive.open(new Uint8Array(await executed.io.archive.arrayBuffer()),'zip');assert.deepEqual([...new Float32Array(legacyZip.entries.get('outputs-0.bin').peek().slice().buffer)],f.expected);
});
