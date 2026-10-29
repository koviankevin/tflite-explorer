import {test} from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
test('importing the model parser preserves shared schema decoders, deterministic demo bytes and inline weights',()=>{
    const raw=execFileSync(process.execPath,[fileURLToPath(new URL('./helpers/demo-import-order.mjs',import.meta.url)),'--demo-order'],{encoding:'utf8',timeout:15000,windowsHide:true,maxBuffer:1024**2}),r=JSON.parse(raw.trim());
    assert.equal(r.beforeSHA256,'b417c9581c3c18d16f41cb9ebccf5d64ac461eeda333a620882fd191c65eb83d');assert.equal(r.afterSHA256,r.beforeSHA256);assert.equal(r.beforeBytes,12624);assert.equal(r.afterBytes,12624);assert.equal(r.decoderUnchanged,true);assert.equal(r.weightBytes,8);assert.equal(r.weightOffset,'0');assert.equal(r.weightSize,'0');
});
