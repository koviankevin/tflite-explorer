import { openSync, readSync, fstatSync, closeSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { parseModel, findPatterns } from '../src/model-engine.js';
const path = process.argv[2];
if (!path) { console.error('Usage: node scripts/inspect.mjs <local-model.tflite>'); process.exit(1); }
const metadata = JSON.parse(await readFile(new URL('../vendor/netron/tflite-metadata.json', import.meta.url)));
const fd = openSync(path, 'r');
try {
    const length = fstatSync(fd).size;
    const index = await parseModel((offset, count) => {
        const data = new Uint8Array(count);
        const received = readSync(fd, data, 0, count, offset);
        if (received !== count) throw new Error('File ended unexpectedly.');
        return data;
    }, length, metadata);
    const result = await findPatterns(index, ['RESHAPE', 'TRANSPOSE', 'RESHAPE']);
    console.log(JSON.stringify({ format: index.model.format, stats: index.stats, graphs: index.graphs.map((g) => ({ layers: g.graph.nodes.length, tensors: g.tensors.size })), reshapeTransposeReshape: result.items.length }, null, 2));
} finally { closeSync(fd); }
