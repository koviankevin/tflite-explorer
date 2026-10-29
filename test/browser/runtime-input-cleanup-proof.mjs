import assert from 'node:assert/strict';
export async function runtimeInputCleanupProof(read,kind){
    const state=await read(()=>({open:document.querySelector('#edit-runtime-dialog').open,controls:document.querySelector('#edit-runtime-inputs').childElementCount,fileInputs:document.querySelectorAll('#edit-runtime-inputs input[type="file"]').length,callbackCleared:document.querySelector('#edit-runtime-run').onclick===null,error:document.querySelector('#edit-runtime-input-error').textContent}));
    assert.deepEqual(state,{open:false,controls:0,fileInputs:0,callbackCleared:true,error:''});return {kind,...state};
}
