import { readFile } from 'node:fs/promises';
import { fixture } from '../test/fixture.mjs';
import { parseModel, search, snapshot } from '../src/model-engine.js';
import { captureGraphPattern, prepareGraphPattern, findSubgraphPatterns } from '../src/subgraph-pattern.js';

const metadata = JSON.parse(await readFile(new URL('../vendor/netron/tflite-metadata.json', import.meta.url)));
const repeats = Number(process.argv[2] || 1000);
const source = fixture({ graphCount: 1, repeats, weightBytes: 1280 * 1024 * 1024 });
const started = performance.now();
const index = await parseModel((offset, length) => {
    const bytes = new Uint8Array(length);
    if (offset < source.data.length) bytes.set(source.data.subarray(offset, offset + length));
    return bytes;
}, source.totalBytes, metadata);
const parseMs = performance.now() - started;
let start = performance.now();
for (let n = 0; n < 20; n++) search(index, 'layers', 'RESHAPE');
const searchMs = (performance.now() - start) / 20;
const structure = captureGraphPattern(index.graphs[0], [0, 1, 2, 3, 4]);
const spec = prepareGraphPattern(structure.nodes, structure.edges); spec.induced = true;
start = performance.now();
const matches = await findSubgraphPatterns(index, spec);
const patternMs = performance.now() - start;
start = performance.now();
const dto = snapshot(index, 0, matches.items[0]?.path || [0]);
const snapshotMs = performance.now() - start;
console.log(JSON.stringify({ layers: index.graphs[0].graph.nodes.length, virtualFileGiB: source.totalBytes / 2 ** 30, parseMs: +parseMs.toFixed(1), bytesRead: index.stats.bytesRead, searchMs: +searchMs.toFixed(2), patternMs: +patternMs.toFixed(1), matches: matches.items.length, limited: matches.truncated, snapshotMs: +snapshotMs.toFixed(2), drawnNodes: dto.graph.nodes.length }));
