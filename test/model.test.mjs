import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fixture } from './fixture.mjs';
import { parseModel, search, findPatterns, snapshot, selectionSnapshot } from '../src/model-engine.js';
import { RangeStream } from '../src/range-stream.js';
const metadata = JSON.parse(await readFile(new URL('../vendor/netron/tflite-metadata.json', import.meta.url)));
const open = async (options) => {
    const f = fixture(options);
    let largestRead = 0;
    const index = await parseModel((offset, length) => {
        largestRead = Math.max(largestRead, length);
        const result = new Uint8Array(length);
        if (offset < f.data.length) result.set(f.data.subarray(offset, Math.min(offset + length, f.data.length)));
        return result;
    }, f.totalBytes, metadata);
    return { index, largestRead, f };
};
test('real Netron parser preserves graphs, tensor ids, quantization and orphan tensors', async () => {
    const { index } = await open({});
    assert.equal(index.graphs.length, 2);
    assert.equal(search(index, 'layers', 'TRANSPOSE').length, 2);
    assert.equal(search(index, 'tensors', '#5', '1').length, 1);
    assert.equal(index.graphs[1].tensors.get('5').quantization.scale[0], 0.25);
    assert.equal(index.graphs[1].tensors.get('5').quantization.offset[0], 3n);
    assert.equal(search(index, 'tensors', 'unused_weights').length, 2);
});
test('patterns follow direct edges, allow branches, normalize case and stay within each graph', async () => {
    const { index } = await open({});
    const result = await findPatterns(index, ['RESHAPE', 'transpose', 'Reshape']);
    assert.equal(result.items.length, 2);
    assert.deepEqual(result.items[0].path, [0, 1, 2]);
    assert.equal((await findPatterns(index, ['RESHAPE', 'RESHAPE'])).items.length, 0);
    assert.equal((await findPatterns(index, ['Reshape', 'Transpose', 'Reshape'], '1')).items.length, 1);
});
test('1.25 GiB inline weights are range descriptors; initial reads stay bounded', async () => {
    const { index, largestRead, f } = await open({ weightBytes: 1342177280 });
    const tensor = index.graphs[0].tensors.get('6').initializer;
    assert.equal(tensor._data.length, 1342177280);
    assert.equal(tensor._data.offset, f.payloadOffset);
    assert.ok(largestRead <= 1024 * 1024, `largest read ${largestRead}`);
    assert.ok(index.stats.bytesRead < 8 * 1024 * 1024, `read ${index.stats.bytesRead}`);
    const dto = structuredClone(snapshot(index, 0, [1]));
    assert.ok(dto.graph.nodes.length <= 100);
    console.log(JSON.stringify({ fixtureBytes: f.totalBytes, bytesRead: index.stats.bytesRead, largestRead, parseMs: Math.round(index.stats.parseMs) }));
});
test('local graph size is bounded independently of model node count', async () => {
    const { index } = await open({ graphCount: 1, repeats: 1000 });
    assert.equal(index.graphs[0].graph.nodes.length, 3001);
    const result = snapshot(index, 0, [1500]);
    assert.ok(result.graph.nodes.length <= 100);
    assert.ok(result.graph.nodes.some((n) => n.identifier === '1500'));
    assert.equal((await findPatterns(index, ['Reshape', 'Transpose', 'Reshape'])).items.length, 1000);
});
test('invalid files and range errors fail explicitly', async () => {
    const stream = new RangeStream(() => new Uint8Array(4), 4);
    assert.throws(() => stream.seek(5));
    assert.throws(() => stream.peek(5));
    await assert.rejects(parseModel(() => new Uint8Array(16), 16, metadata), /TFLite/);
});

test('result selection preserves full graph scope and can send only highlight metadata', async () => {
    const { index } = await open({ graphCount: 2, repeats: 4 });
    const item = (await findPatterns(index, ['Reshape', 'Transpose', 'Reshape'], '1')).items[0];
    const full = selectionSnapshot(index, item, { full: true });
    assert.equal(full.graphIndex, 1);
    assert.equal(full.graph.nodes.length, 13);
    assert.deepEqual(full.selected, [0, 1, 2]);
    const metadata = selectionSnapshot(index, item, { full: true, metadataOnly: true });
    assert.equal(metadata.graphIndex, 1);
    assert.equal(metadata.full, true);
    assert.equal(metadata.graph, undefined);
    assert.equal(metadata.nodes, undefined);
    assert.deepEqual(metadata.selected, full.selected);
    assert.ok(selectionSnapshot(index, item).graph.nodes.length < full.graph.nodes.length);
    const tensor = search(index, 'tensors', 'unused_weights', '1')[0];
    const detail = selectionSnapshot(index, tensor, { full: true, metadataOnly: true });
    assert.equal(detail.graph, undefined);
    assert.equal(detail.detail.identifier, '15');
    assert.deepEqual(detail.selected, []);
});
