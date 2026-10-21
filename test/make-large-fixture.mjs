import { openSync, writeSync, ftruncateSync, closeSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fixture } from './fixture.mjs';
const file = path.join(os.tmpdir(), 'tflite-explorer-synthetic-1_25GiB.tflite');
const f = fixture({ graphCount: 2, repeats: 1000, weightBytes: 1342177280 });
const fd = openSync(file, 'w');
try { writeSync(fd, f.data); ftruncateSync(fd, f.totalBytes); } finally { closeSync(fd); }
console.log(JSON.stringify({ file, bytes: f.totalBytes, layers: 6002, note: 'Synthetic structure with zero weight payload; no user model data.' }));
