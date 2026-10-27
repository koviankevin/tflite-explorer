import { parseModel } from './model-engine.js?v=0f8361cc44fcd547';
import { modelFormat } from './model-formats.js?v=0f8361cc44fcd547';
export { modelFormat } from './model-formats.js?v=0f8361cc44fcd547';
export async function openModelFile(file, { readAt, readMetadata, progress = () => {}, dialects = [] }) {
    if (modelFormat(file.name) === 'mlir') {
        const { parseMLIRFile } = await import('./mlir-engine.js?v=0f8361cc44fcd547');
        return parseMLIRFile(file, { identifier: file.name, metadata: await readMetadata('mlir'), dialects, progress });
    }
    const index = await parseModel(readAt, file.size, JSON.parse(await readMetadata('tflite')), progress);
    return { ...index, sourceFormat: 'tflite', capabilities: { tfliteExport: true } };
}
