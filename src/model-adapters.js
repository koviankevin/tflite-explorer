import { parseModel } from './model-engine.js?v=66e1f1fa94a943d8';
import { modelFormat } from './model-formats.js?v=66e1f1fa94a943d8';
export { modelFormat } from './model-formats.js?v=66e1f1fa94a943d8';
export async function openModelFile(file, { readAt, readMetadata, progress = () => {}, dialects = [] }) {
    if (modelFormat(file.name) === 'mlir') {
        const { parseMLIRFile } = await import('./mlir-engine.js?v=66e1f1fa94a943d8');
        return parseMLIRFile(file, { identifier: file.name, metadata: await readMetadata('mlir'), dialects, progress });
    }
    const index = await parseModel(readAt, file.size, JSON.parse(await readMetadata('tflite')), progress);
    return { ...index, sourceFormat: 'tflite', capabilities: { tfliteExport: true } };
}
