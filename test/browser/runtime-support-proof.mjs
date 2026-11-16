import assert from 'node:assert/strict';
export const RUNTIME_SUPPORT_EXPECTATIONS=[
 ['missing-version','2035802838cf28a314da90f9e66778685f294eea588317fff71e492dc835a507','not-verified','7c9fa136d4413fa6173637e883b6998d32e1d675f88cddff9dcbcf331820f4b8'],
 ['invalid-permutation','b115ff3feb71cfc1f8586d92d4e6e554cb8c07294a730ff2e04d1218ea76ca84','failed','d86e8112f3c4c4442126f8e9f44f16867da487f29052bf91b810457db34209a4'],
 ['supported-control','b115ff3feb71cfc1f8586d92d4e6e554cb8c07294a730ff2e04d1218ea76ca84','passed','7c9fa136d4413fa6173637e883b6998d32e1d675f88cddff9dcbcf331820f4b8']
];
export function assertRuntimeSupportProof(proof){
 assert.ok(proof?.status==='passed'&&proof.modelWorkers===3&&proof.runtimeWorkers===3&&proof.downloads===2&&proof.allWorkersClosed===true&&proof.cases?.length===3,'missing runtime support proof');
 for(const [i,[name,hash,status,axisHash]]of RUNTIME_SUPPORT_EXPECTATIONS.entries()){
  const c=proof.cases[i];assert.equal(c.name,name);assert.equal(c.modelSHA256,hash);assert.equal(c.status,status);assert.equal(c.automaticRuntime,false);
  assert.deepEqual(c.inputSHA256,['24ae2dfe8df57c1b80e54cef3d90ac3b417fd98973345a5f616bbc9a75dcc202',axisHash]);
  if(status==='not-verified'){
   assert.equal(c.ioAbsent,true);assert.equal(c.zipSHA256,undefined);assert.match(c.message,/未能驗證.*runtime 未註冊 TRANSPOSE version 999/s);assert.match(c.message,/Didn't find op for builtin opcode 'TRANSPOSE' version '999'/);
  }else{
   assert.match(c.zipSHA256,/^[a-f0-9]{64}$/);assert.equal(c.recordedStatus,status);assert.equal(c.compiled,true);assert.equal(c.invoked,status==='passed');assert.equal(c.inputsMatch,true);
   if(status==='failed'){assert.equal(c.outputSaved,false);assert.match(c.message,/本機執行檢查：失敗/);assert.ok(!c.message.includes('runtime 未註冊'));}
   else{assert.equal(c.outputSHA256,'b05183b256a48062521a4beb24c91079d1b94dfdef9ca4edcb76d28f69ee7fcd');assert.equal(c.numericMatches,true);assert.deepEqual(c.output,[1,4,2,5,3,6]);}
  }
 }
}
