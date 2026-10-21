import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fixture } from './fixture.mjs';
import { parseModel, snapshot } from '../src/model-engine.js';
import { parseGraphPattern, prepareGraphPattern, captureGraphPattern, findSubgraphPatterns, LORA_PATTERN } from '../src/subgraph-pattern.js';
import { loadPatterns, savePattern, PATTERN_LIBRARY_KEY } from '../src/pattern-library.js';
const metadata = JSON.parse(await readFile(new URL('../vendor/netron/tflite-metadata.json', import.meta.url)));
const open = async (options = {}) => {
    const f = fixture({ variant: 'lora', ...options });
    const bytes = new Uint8Array(f.totalBytes); bytes.set(f.data);
    return parseModel((offset, length) => bytes.subarray(offset, offset + length), bytes.length, metadata);
};
test('LoRA branches must share both Mul and Add, with distinct BMM nodes', async () => {
    const index = await open();
    const spec = parseGraphPattern(LORA_PATTERN);
    assert.equal(spec.nodes.length, 5); assert.equal(spec.edges.length, 5);
    const result = await findSubgraphPatterns(index, spec);
    assert.equal(result.items.length, 2);
    assert.deepEqual(result.items[0].path, [0, 1, 4, 2, 3]);
    assert.deepEqual(result.items[0].connections, [[0, 1], [1, 4], [0, 2], [2, 3], [3, 4]]);
    assert.equal(snapshot(index, 0, result.items[0].path).graph.nodes.length, 5);
    assert.equal((await findSubgraphPatterns(index, spec, '1')).items.length, 1);
});
test('two paths that merge into different Add operators are not a match', async () => {
    const result = await findSubgraphPatterns(await open({ brokenJoin: true }), parseGraphPattern(LORA_PATTERN));
    assert.equal(result.items.length, 0);
});
test('a pattern can have two independent exits and allow extra outgoing branches', async () => {
    const spec = parseGraphPattern('Mul0 -> FC\nMul0 -> BMM0 -> BMM1');
    const result = await findSubgraphPatterns(await open(), spec);
    assert.equal(result.items.length, 2);
    assert.equal(spec.nodes.filter((node) => spec.outgoing.get(node.alias).length === 0).length, 2);
});
test('explicit aliases work, and different aliases cannot reuse a model node', async () => {
    const index = await open();
    assert.equal((await findSubgraphPatterns(index, parseGraphPattern('m:Mul -> f:FC -> a:Add\nm -> b0:BMM -> b1:BMM -> a'))).items.length, 2);
    assert.equal((await findSubgraphPatterns(index, parseGraphPattern('Mul0 -> FC -> Add0\nMul1 -> BMM0 -> BMM1 -> Add0'))).items.length, 0);
});
test('invalid, cyclic, disconnected and conflicting patterns are rejected', () => {
    for (const text of ['', 'Mul0', 'Mul0 -> -> Add0', 'm:Mul -> m:Add', 'a:Mul -> b:Add -> a', 'Mul0 -> FC\nBMM0 -> Add0']) assert.throws(() => parseGraphPattern(text));
});
test('dropdown-created graph matches without any typed operator aliases', async () => {
    const spec = prepareGraphPattern(['Mul', 'FullyConnected', 'BatchMatMul', 'BatchMatMul', 'Add'].map((type, i) => ({alias:`N${i+1}`,type})), [[1,2],[1,3],[3,4],[2,5],[4,5]].map(([a,b])=>({from:`N${a}`,to:`N${b}`})));
    const result = await findSubgraphPatterns(await open(), spec);
    assert.equal(result.items.length, 2);
    assert.equal(result.items[0].connections.length, 5);
    assert.throws(()=>prepareGraphPattern([{alias:'N1',type:'Mul'},{alias:'N2',type:'Add'}],[]),/連通子圖/);
});

test('capturing graph nodes discovers both branches and their shared join', async () => {
    const index = await open();
    const structure = captureGraphPattern(index.graphs[0], [4, 3, 0, 1, 2, 2]);
    assert.deepEqual(structure.nodes.map((n) => n.type), ['Mul', 'FullyConnected', 'BatchMatMul', 'BatchMatMul', 'Add']);
    assert.deepEqual(structure.edges, [[1, 2], [1, 3], [2, 5], [3, 4], [4, 5]].map(([a, b]) => ({ from: `N${a}`, to: `N${b}` })));
    const spec = prepareGraphPattern(structure.nodes, structure.edges); spec.induced = structure.induced;
    assert.equal((await findSubgraphPatterns(index, spec)).items.length, 2);
    assert.equal((await findSubgraphPatterns(await open({ brokenJoin: true }), spec)).items.length, 0);
    assert.equal(captureGraphPattern(index.graphs[0], [0, 1, 2, 3]).edges.length, 3);
    assert.throws(() => captureGraphPattern(index.graphs[0], [0]), /至少選取兩個/);
    assert.throws(() => captureGraphPattern(index.graphs[0], [1, 2]), /連通子圖/);
    assert.throws(() => captureGraphPattern(index.graphs[0], [0, 999]), /目前 subgraph/);
});

test('captured pattern requires exact internal topology but allows external connections', async () => {
    const index = await open();
    const structure = captureGraphPattern(index.graphs[0], [0, 1, 2, 3]);
    const spec = prepareGraphPattern(structure.nodes, structure.edges); spec.induced = true;
    assert.equal((await findSubgraphPatterns(index, spec)).items.length, 2);
    index.graphs[0].next[1].add(3);
    assert.equal((await findSubgraphPatterns(index, spec, '0')).items.length, 0);
    spec.induced = false;
    assert.equal((await findSubgraphPatterns(index, spec, '0')).items.length, 1);
});

test('pattern library survives reload and stores no model identifiers or tensors', async () => {
    const values = new Map();
    const storage = { getItem: (key) => values.get(key), setItem: (key, value) => values.set(key, value) };
    const structure = captureGraphPattern((await open()).graphs[0], [0, 1, 2, 3, 4]);
    const saved = savePattern(storage, [], { ...structure, name: '我的 LoRA', modelName: 'private.tflite', weights: [123] });
    assert.equal(saved.length, 1);
    const loaded = loadPatterns(storage);
    assert.equal(loaded[0].name, '我的 LoRA');
    assert.equal(loaded[0].induced, true);
    assert.equal(loaded[0].edges.length, 5);
    assert.equal(values.get(PATTERN_LIBRARY_KEY).includes('private.tflite'), false);
    assert.equal(savePattern(storage, loaded, { ...structure, name: '我的 LoRA' }).length, 1);
});
