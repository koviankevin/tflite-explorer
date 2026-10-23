import { openSync, writeSync, ftruncateSync, closeSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fixture } from './fixture.mjs';
const file = process.argv[2] ? path.resolve(process.argv[2]) : path.join(os.tmpdir(), 'tflite-explorer-synthetic-1_25GiB.tflite');
const f = fixture({ graphCount: 1, repeats: 7000, weightBytes: 1342177280 });
const fd = openSync(file, 'w');
try { writeSync(fd, f.data); ftruncateSync(fd, f.totalBytes); } finally { closeSync(fd); }
console.log(JSON.stringify({ file, bytes: f.totalBytes, layers: 21001, note: 'Synthetic structure with zero weight payload; no user model data.' }));
