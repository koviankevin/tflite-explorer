import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
import vm from 'node:vm';
import {axisTransformFixture} from './axis-transform-fixture.mjs';
import {FlatbufferWriter} from '../src/flatbuffer-writer.js';
import {runtimePlan,runtimeSummary} from '../src/tflite-runtime-policy.js';
import {executeRuntime} from '../src/tflite-runtime-execute.js';
import {interpreterRuntime} from '../src/tflite-interpreter-runtime.js';
import {runtimeUnsupportedKernel} from '../src/tflite-runtime-diagnostics.js';
import {runtimeSupportFixtures} from './runtime-support-fixture.mjs';
import {Archive} from '../vendor/netron/zip.js';

async function actualInterpreter(){
 const base=new URL('../vendor/tflite-interpreter/0.0.1-alpha.10/',import.meta.url),diagnostics=[];
 const context=vm.createContext({require:createRequire(import.meta.url),process,Buffer,console,TextDecoder,TextEncoder,WebAssembly,setTimeout,clearTimeout,__dirname:fileURLToPath(base),...Object.fromEntries(['Uint8Array','Int8Array','Uint16Array','Int16Array','Uint32Array','Int32Array','Float32Array','Float64Array','ArrayBuffer'].map(n=>[n,globalThis[n]]))},{codeGeneration:{strings:false,wasm:true}});
 vm.runInContext(await readFile(new URL('tflite_web_api_cc.js',base),'utf8'),context);
 const module=await context.tflite_web_api_ModuleFactory({wasmBinary:await readFile(new URL('tflite_web_api_cc.wasm',base)),printErr:s=>diagnostics.push(String(s))});
 return {rt:interpreterRuntime(module),diagnostics};
}

test('actual Interpreter missing builtin version is not-verified with its original registration diagnostic and no invocation',async()=>{
 const f=await axisTransformFixture({name:'TRANSPOSE',axes:[1,0],output:[3,2],axisInput:true});
 f.model.operator_codes[0].version=999;
 const blob=await new FlatbufferWriter().finish(f.model,new Blob()),plan=runtimePlan(f.model,blob.size),{rt,diagnostics}=await actualInterpreter();
 assert.equal(plan.eligible,true);assert.equal(plan.runtimeBackend,'interpreter');
 const result=await executeRuntime({blob,plan,rt,diagnostics:()=>diagnostics});
 assert.match(diagnostics.join('\n'),/Didn't find op for builtin opcode 'TRANSPOSE' version '999'/);
 assert.equal(result.compiled,false);assert.equal(result.invoked,false);assert.equal(result.io,undefined);
 assert.equal(result.stage,'compile');assert.equal(result.status,'not-verified');assert.equal(result.failureKind,'unsupported-kernel');
 assert.match(runtimeSummary(result),/未能驗證/);assert.match(result.reason,/runtime.*未註冊|runtime.*不支援/);
 assert.match(result.diagnostics.join('\n'),/TRANSPOSE.*999/);
 assert.equal(result.unsupportedKernel.kernel,'TRANSPOSE');assert.equal(result.unsupportedKernel.version,999);
});

test('only bounded compile-time builtin registration diagnostics identify unsupported kernels',()=>{
 const line="ERROR: Didn't find op for builtin opcode 'TRANSPOSE' version '999'. An older version of this builtin might be supported.";
 assert.equal(runtimeUnsupportedKernel([line],'compile').version,999);
 assert.equal(runtimeUnsupportedKernel([line],'invoke'),null);
 assert.equal(runtimeUnsupportedKernel([line],'inputs'),null);
 for(const diagnostic of ['INVALID_ARGUMENT: Can\'t initialize model','ERROR: Registration failed.','ERROR: Tensor 0 has invalid parameters.',"Tensor name: "+line,"ERROR: Didn't find op for builtin opcode 'TRANSPOSE' version '-1'."]){assert.equal(runtimeUnsupportedKernel([diagnostic],'compile'),null,diagnostic);}
 assert.equal(runtimeUnsupportedKernel([line,...Array(12).fill('other diagnostic')],'compile'),null);
 assert.equal(runtimeUnsupportedKernel(['x'.repeat(512)+line],'compile'),null);
});

test('generic initialization failure remains failed without an explicit missing-kernel diagnostic',async()=>{
 const f=await axisTransformFixture({name:'TRANSPOSE',axes:[1,0],output:[3,2],axisInput:true}),plan=runtimePlan(f.model,f.blob.size);
 let deleted=0;
 const result=await executeRuntime({blob:f.blob,plan,rt:{backend:'interpreter',Environment:{create:async()=>({delete(){deleted++;}})},loadAndCompile:async()=>{throw Error("INVALID_ARGUMENT: Can't initialize model");}},diagnostics:()=>['ERROR: Registration failed.']});
 assert.equal(result.status,'failed');assert.equal(result.compiled,false);assert.equal(result.invoked,false);assert.equal(result.unsupportedKernel,undefined);assert.equal(deleted,1);
});

test('actual Interpreter invalid TRANSPOSE metadata remains a failed model preparation, not unsupported runtime',async()=>{
 const f=await axisTransformFixture({name:'TRANSPOSE',axes:[0,0],output:[2,3],axisInput:false}),{rt,diagnostics}=await actualInterpreter();
 const plan=runtimePlan(f.model,f.blob.size);assert.equal(plan.eligible,true);
 const result=await executeRuntime({blob:f.blob,plan,rt,diagnostics:()=>diagnostics});
 assert.equal(result.status,'failed');assert.equal(result.invoked,false);assert.notEqual(result.failureKind,'unsupported-kernel');
 assert.ok(result.diagnostics.length>0);assert.match(result.diagnostics.join('\n'),/TRANSPOSE|transpose/);
});

test('identical supported model bytes retain real invalid-input failure and valid control, with exact saved BIN evidence',async()=>{
 const fixtures=(await runtimeSupportFixtures()).filter(f=>f.version===1);assert.deepEqual(fixtures[0].bytes,fixtures[1].bytes);
 for(const f of fixtures){
  const {rt,diagnostics}=await actualInterpreter(),plan=runtimePlan(f.model,f.blob.size),specs=f.values.map((v,i)=>({mode:'bin',file:new File([v],i+'.bin')}));
  const result=await executeRuntime({blob:f.blob,plan,rt,specs,diagnostics:()=>diagnostics});
  assert.equal(result.status,f.status,result.reason);assert.equal(result.compiled,true);assert.equal(result.invoked,f.status==='passed');assert.equal(result.unsupportedKernel,undefined);
  const zip=Archive.open(new Uint8Array(await result.io.archive.arrayBuffer()),'zip'),manifest=JSON.parse(new TextDecoder().decode(zip.entries.get('manifest.json').peek()));
  assert.equal(manifest.validation.status,f.status);for(const [i,v]of f.values.entries())assert.deepEqual(Buffer.from(zip.entries.get('inputs-'+i+'.bin').peek()),Buffer.from(v.buffer,v.byteOffset,v.byteLength));
  if(f.expected)assert.deepEqual([...new Float32Array(zip.entries.get('outputs-0.bin').peek().slice().buffer)],f.expected);
  else{assert.equal(zip.entries.has('outputs-0.bin'),false);assert.equal(result.stage,'invoke');}
 }
});

test('legacy Interpreter repeated-axis Invoke still fails output integrity and retains its actual output for diagnosis',async()=>{
 const f=await axisTransformFixture({name:'TRANSPOSE',axes:[0,0],output:[3,2],axisInput:true}),{rt,diagnostics}=await actualInterpreter();
 const result=await executeRuntime({blob:f.blob,plan:runtimePlan(f.model,f.blob.size),rt,diagnostics:()=>diagnostics,specs:[{mode:'bin',file:new File([Float32Array.of(1,2,3,4,5,6)],'data.bin')},{mode:'bin',file:new File([Int32Array.of(0,0)],'axes.bin')}]});
 assert.equal(result.status,'failed');assert.equal(result.compiled,true);assert.equal(result.invoked,true);assert.equal(result.unsupportedKernel,undefined);assert.match(result.reason,/輸出 shape/);assert.ok(result.io.archive);
 assert.notDeepEqual(result.io.manifest.outputs[0].shape,[3,2]);assert.equal(result.io.manifest.validation.status,'failed');
});
