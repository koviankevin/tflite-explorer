import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fixture } from './fixture.mjs';
import { parseModel, findPatterns } from '../src/model-engine.js';
import { captureGraphPattern, prepareGraphPattern, findSubgraphPatterns } from '../src/subgraph-pattern.js';

test('connected pattern search does not repeatedly scan unrelated operator types', async () => {
    const metadata = JSON.parse(await readFile(new URL('../vendor/netron/tflite-metadata.json', import.meta.url)));
    const source = fixture({ graphCount: 1, repeats: 100 });
    const bytes = new Uint8Array(source.totalBytes); bytes.set(source.data);
    const index = await parseModel((offset, length) => bytes.subarray(offset, offset + length), bytes.length, metadata);
    const structure = captureGraphPattern(index.graphs[0], [0, 1, 2, 3, 4]);
    const spec = prepareGraphPattern(structure.nodes, structure.edges); spec.induced = true;
    let reads = 0;
    let keyReads = 0;
    index.graphs[0].operatorIndex.keys = new Proxy(index.graphs[0].operatorIndex.keys, { get(target, key, receiver) { if (/^\d+$/.test(String(key))) keyReads++; return Reflect.get(target, key, receiver); } });
    for (const node of index.graphs[0].graph.nodes) {
        const type = node.type;
        node.type = { ...type, get name() { reads++; return type.name; } };
    }
    const result = await findSubgraphPatterns(index, spec);
    assert.equal(result.items.length, 99);
    assert.ok(reads <= index.graphs[0].graph.nodes.length * 3, `${reads} operator type reads for ${index.graphs[0].graph.nodes.length} layers`);
    assert.ok(keyReads <= index.graphs[0].graph.nodes.length * 12, `${keyReads} candidate type checks for ${index.graphs[0].graph.nodes.length} layers`);
});

test('large candidate planning yields to cancellation before scanning the whole candidate set', async () => {
    const count = 10000;
    let checked = 0;
    const keys = new Proxy(Array(count).fill('MUL'), { get(target, key, receiver) { if (/^\d+$/.test(String(key))) checked++; return Reflect.get(target, key, receiver); } });
    const entry = { graph: { nodes: Array.from({ length: count }, (_, n) => ({ type: { name: 'Mul' }, identifier: String(n) })) }, next: Array.from({ length: count }, () => new Set()), previous: Array.from({ length: count }, () => new Set()), operatorIndex: { keys, byType: new Map([['MUL', Array.from({ length: count }, (_, n) => n)]]) } };
    const spec = prepareGraphPattern([{ alias: 'a', type: 'Mul' }, { alias: 'b', type: 'Mul' }], [{ from: 'a', to: 'b' }]);
    let polls = 0;
    assert.equal(await findSubgraphPatterns({ graphs: [entry] }, spec, 'all', () => ++polls >= 2), null);
    assert.ok(checked <= 2048, `${checked} candidate checks before cancellation`);
});

test('a dense linear search with an unreachable tail reports an incomplete result at its work budget', async () => {
    const count = 25;
    const nodes = Array.from({ length: count }, (_, n) => ({ type: { name: n ? 'Mul' : 'Add' }, identifier: String(n) }));
    const next = nodes.map((_, n) => new Set(nodes.map((_, i) => i).filter((i) => i > n)));
    const result = await findPatterns({ graphs: [{ graph: { nodes }, next }] }, [...Array(20).fill('Mul'), 'Add']);
    assert.equal(result.items.length, 0);
    assert.equal(result.searchLimited, true);
    assert.equal(result.truncated, true);
});
