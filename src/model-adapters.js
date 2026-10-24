import { parseModel } from './model-engine.js?v=48cf132f532c0b5d';
import { modelFormat } from './model-formats.js?v=48cf132f532c0b5d';
export { modelFormat } from './model-formats.js?v=48cf132f532c0b5d';
export async function openModelFile(file, { readAt, readMetadata, progress = () => {}, dialects = [] }) {
    if (modelFormat(file.name) === 'mlir') {
        const { parseMLIR, MLIR_TEXT_LIMIT } = await import('./mlir-engine.js?v=48cf132f532c0b5d');
        if (file.size > MLIR_TEXT_LIMIT) throw new Error('文字 MLIR 基礎版最多 64 MiB；請先縮小 IR dump。');
        return parseMLIR(new Uint8Array(await file.arrayBuffer()), { identifier: file.name, metadata: await readMetadata('mlir'), dialects, progress });
    }
    const index = await parseModel(readAt, file.size, JSON.parse(await readMetadata('tflite')), progress);
    return { ...index, sourceFormat: 'tflite', capabilities: { tfliteExport: true } };
}
