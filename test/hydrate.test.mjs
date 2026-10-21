import { test } from 'node:test';
import assert from 'node:assert/strict';
import { hydrate } from '../src/hydrate.js';
import { Tensor } from '../vendor/netron/base.js';
test('DTO hydration restores type methods, shared identities, and lazy local tensor reads', async () => {
    let reads = 0;
    const bytes = new Uint8Array(12);
    new DataView(bytes.buffer).setFloat32(4, 3.5, true);
    new DataView(bytes.buffer).setFloat32(8, 2.5, true);
    const file = { slice: (offset, end) => ({ arrayBuffer: async () => { reads++; return bytes.slice(offset, end).buffer; } }) };
    const value = { name: 'weight', type: { dataType: 'float32', shape: { dimensions: [2] } }, encoding: '<', _data: { __range: true, offset: 4, length: 8 } };
    const dto = { one: value, two: value };
    hydrate(dto, file);
    assert.equal(reads, 0);
    assert.equal(dto.one, dto.two);
    assert.equal(value.type.toString(), 'float32[2]');
    assert.equal(value.peek(), false);
    await Promise.all([value.read(), value.read()]);
    assert.equal(reads, 1);
    assert.equal(value.peek(), true);
    assert.deepEqual(new Tensor(value).value, [3.5, 2.5]);
});
test('large weight previews fail explicitly without reading the payload', async () => {
    const value = { type: { dataType: 'uint8', shape: { dimensions: [20000000] } }, encoding: '<', _data: { __range: true, offset: 0, length: 20000000 } };
    hydrate(value, { slice() { throw new Error('should not read'); } });
    await assert.rejects(value.read(), /16 MiB/);
    assert.equal(value.peek(), false);
});
test('lazy string tensors decode correctly', async () => {
    const bytes = new Uint8Array(15);
    const view = new DataView(bytes.buffer);
    view.setInt32(0, 2, true); view.setInt32(4, 12, true); view.setInt32(8, 14, true); bytes.set([104, 105, 33], 12);
    const value = { type: { dataType: 'string', shape: { dimensions: [2] } }, encoding: '|', _data: { __range: true, offset: 0, length: 15 } };
    hydrate(value, new Blob([bytes])); await value.read();
    assert.deepEqual(value.values, ['hi', '!']);
});
