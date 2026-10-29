import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {executableDemoFixture} from '../executable-demo-fixture.mjs';
import {tflite as schema} from '../../vendor/netron/tflite-schema.js';
if(process.argv[2]!=='--demo-order')throw Error('Explicit deterministic demo import-order reference only.');
const hash=b=>createHash('sha256').update(b).digest('hex'),decoder=schema.Buffer.decode,before=await executableDemoFixture();
await import('../../src/model-engine.js');
const after=await executableDemoFixture(),result={beforeSHA256:hash(before.data),afterSHA256:hash(after.data),beforeBytes:before.totalBytes,afterBytes:after.totalBytes,decoderUnchanged:schema.Buffer.decode===decoder,weightBytes:after.model.buffers[1].data.length,weightOffset:String(after.model.buffers[1].offset),weightSize:String(after.model.buffers[1].size)};
console.log(JSON.stringify(result));assert.equal(result.afterSHA256,result.beforeSHA256,'Importing the parser must not change generated model bytes');assert.equal(result.decoderUnchanged,true,'The generated schema decoder is shared with builders');assert.equal(result.weightBytes,8);assert.equal(result.weightOffset,'0');assert.equal(result.weightSize,'0');
