import { writeFile } from 'node:fs/promises';
import { customFixture } from '../custom-fixture.mjs';
import { FlatbufferWriter } from '../../src/flatbuffer-writer.js';

// Opaque custom op with two outputs feeding an Add join; no runtime required.
const destination = process.argv[2];
if (!destination) throw new Error('Provide an output .tflite path.');
const { model } = await customFixture();
model.operator_codes[1].custom_code = 'InternalSplitFooWithQuantizedBranchesAndCustomParameters';
const blob = new FlatbufferWriter().finish(model, new Blob());
await writeFile(destination, new Uint8Array(await blob.arrayBuffer()));
console.log(destination);
