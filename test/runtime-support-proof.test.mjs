import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {runtimeSupportFixtures} from './runtime-support-fixture.mjs';
import {RUNTIME_SUPPORT_EXPECTATIONS,assertRuntimeSupportProof} from './browser/runtime-support-proof.mjs';
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const proof=()=>({status:'passed',modelWorkers:3,runtimeWorkers:3,downloads:2,allWorkersClosed:true,cases:RUNTIME_SUPPORT_EXPECTATIONS.map(([name,modelSHA256,status,axisHash])=>({name,modelSHA256,status,inputSHA256:['24ae2dfe8df57c1b80e54cef3d90ac3b417fd98973345a5f616bbc9a75dcc202',axisHash],automaticRuntime:false,...(status==='not-verified'?{ioAbsent:true,message:"本機執行檢查：未能驗證。runtime 未註冊 TRANSPOSE version 999\nERROR: Didn't find op for builtin opcode 'TRANSPOSE' version '999'."}:{recordedStatus:status,compiled:true,invoked:status==='passed',inputsMatch:true,zipSHA256:'a'.repeat(64),...(status==='failed'?{outputSaved:false,message:'本機執行檢查：失敗。指定輸入執行失敗。'}:{outputSHA256:'b05183b256a48062521a4beb24c91079d1b94dfdef9ca4edcb76d28f69ee7fcd',numericMatches:true,output:[1,4,2,5,3,6]})})}))});
test('runtime support evidence rejects skipped classification, changed input data and false success',()=>{
 assert.doesNotThrow(()=>assertRuntimeSupportProof(proof()));assert.throws(()=>assertRuntimeSupportProof(null));
 for(const mutate of [p=>p.cases.pop(),p=>p.runtimeWorkers++,p=>p.modelWorkers--,p=>p.downloads++,p=>p.allWorkersClosed=false,p=>p.cases[0].status='failed',p=>p.cases[0].modelSHA256='a'.repeat(64),p=>p.cases[0].message='generic unsupported',p=>p.cases[0].ioAbsent=false,p=>p.cases[0].zipSHA256='a'.repeat(64),p=>p.cases[1].status='not-verified',p=>p.cases[1].inputSHA256[1]=p.cases[2].inputSHA256[1],p=>p.cases[1].compiled=false,p=>p.cases[1].invoked=true,p=>p.cases[1].outputSaved=true,p=>p.cases[2].recordedStatus='failed',p=>p.cases[2].automaticRuntime=true,p=>p.cases[2].output[0]=0,p=>p.cases[2].numericMatches=false]){const p=structuredClone(proof());mutate(p);assert.throws(()=>assertRuntimeSupportProof(p));}
});
test('runtime support model and raw input hashes bind real generated fixtures, including equal model bytes with distinct inputs',async()=>{
 const fixtures=await runtimeSupportFixtures();assert.equal(fixtures.length,3);
 for(const [i,f]of fixtures.entries()){const e=RUNTIME_SUPPORT_EXPECTATIONS[i];assert.equal(f.name,e[0]);assert.equal(sha(f.bytes),e[1]);assert.equal(f.status,e[2]);assert.equal(sha(new Uint8Array(f.values[1].buffer)),e[3]);}
 assert.deepEqual(fixtures[1].bytes,fixtures[2].bytes);assert.notDeepEqual(fixtures[1].values[1],fixtures[2].values[1]);
});
