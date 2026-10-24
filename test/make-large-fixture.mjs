import { openSync, writeSync, ftruncateSync, closeSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { fixture } from './fixture.mjs';

// Keep main's 21,001-operator CLI default; browser acceptance explicitly opts
// into two subgraphs so cross-subgraph search remains covered.
export function makeLargeFixture(file = path.join(os.tmpdir(), 'tflite-explorer-synthetic-1_25GiB.tflite'), { graphCount = 1, repeats = 7000, weightBytes = 1342177280 } = {}) {
    const f = fixture({ graphCount, repeats, weightBytes });
    const fd = openSync(file, 'w');
    try { writeSync(fd, f.data); ftruncateSync(fd, f.totalBytes); } finally { closeSync(fd); }
    return { file, bytes: f.totalBytes, payloadOffset: f.payloadOffset, layers: graphCount * (repeats * 3 + 1), graphCount, repeats, note: 'Synthetic structure with sparse zero weight payload; no user model data.' };
}
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
    console.log(JSON.stringify(makeLargeFixture(process.argv[2] ? path.resolve(process.argv[2]) : undefined)));
}
