import { parseModel } from './model-engine.js?v=e67611582982ec3f';
import { modelFormat } from './model-formats.js?v=e67611582982ec3f';
export { modelFormat } from './model-formats.js?v=e67611582982ec3f';
export async function openModelFile(file, { readAt, readMetadata, progress = () => {}, dialects = [] }) {
    if (modelFormat(file.name) === 'mlir') {
        const { parseMLIRFile } = await import('./mlir-engine.js?v=e67611582982ec3f');
        return parseMLIRFile(file, { identifier: file.name, metadata: await readMetadata('mlir'), dialects, progress });
    }
    const index = await parseModel(readAt, file.size, JSON.parse(await readMetadata('tflite')), progress);
    return { ...index, sourceFormat: 'tflite', capabilities: { tfliteExport: true } };
}
