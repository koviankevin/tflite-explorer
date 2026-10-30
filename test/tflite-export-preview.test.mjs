import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {parseModel} from '../src/model-engine.js';
import {customFixture} from './custom-fixture.mjs';
import {tfliteExportPreview,exportPreviewText} from '../src/tflite-export-preview.js';
test('custom export preview exposes retained buffers without reading their payload or remapping opaque IDs',async()=>{
    const f=await customFixture({external:true}),metadata=JSON.parse(await readFile(new URL('../vendor/netron/tflite-metadata.json',import.meta.url),'utf8')),index=await parseModel((o,n)=>f.bytes.subarray(o,o+n),f.bytes.length,metadata);
    const extra=1024**3;index.raw.buffers.push({size:BigInt(extra),offset:8n});
    const preview=tfliteExportPreview(index,0,[1,1]);assert.equal(preview.layers,1);assert.equal(preview.preservedIds,true);assert.equal(preview.retainedBuffers,index.raw.buffers.length);assert.ok(preview.opaqueRetainedBytes>=extra);assert.match(exportPreviewText(preview),/不明引用.*小片段/);
    const ordinary=tfliteExportPreview(index,0,[0]);assert.equal(ordinary.preservedIds,false);assert.ok(ordinary.retainedBytes<extra);assert.throws(()=>tfliteExportPreview(index,0,[99999]),/有效/);
});
