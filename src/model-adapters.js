import { parseModel } from './model-engine.js?v=bf6ab8c5b29c3043';
import { modelFormat } from './model-formats.js?v=bf6ab8c5b29c3043';
export { modelFormat } from './model-formats.js?v=bf6ab8c5b29c3043';
export async function openModelFile(file, { readAt, readMetadata, progress = () => {}, dialects = [] }) {
    if (modelFormat(file.name) === 'mlir') {
        const { parseMLIRFile } = await import('./mlir-engine.js?v=bf6ab8c5b29c3043');
        return parseMLIRFile(file, { identifier: file.name, metadata: await readMetadata('mlir'), dialects, progress });
    }
    const index = await parseModel(readAt, file.size, JSON.parse(await readMetadata('tflite')), progress);
    return { ...index, sourceFormat: 'tflite', capabilities: { tfliteExport: true } };
}
