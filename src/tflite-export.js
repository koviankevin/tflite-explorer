import { tflite as schema } from '../vendor/netron/tflite-schema.js';
import { FlatbufferWriter } from './flatbuffer-writer.js';

export function exportTflite(index, graphIndex, selected, file) {
    if (!index.raw) throw new Error('TFLite 子模型匯出僅適用於 TFLite 來源；MLIR 需要內部 compiler lowering。');
    if (index.exportUnsupportedReason) throw new Error(index.exportUnsupportedReason);
    const graph = index.raw.subgraphs[graphIndex];
    const nodes = [...new Set(selected)].sort((a, b) => a - b);
    if (!graph || !nodes.length || nodes.some((n) => !Number.isInteger(n) || !graph.operators[n])) throw new Error('請先在圖上選取 layers 或選取搜尋結果。');
    const operators = nodes.map((n) => graph.operators[n]);
    const used = new Set(); const produced = new Set(); const consumed = new Set();
    const selectedSet = new Set(nodes);
    const outsideConsumers = new Set(graph.operators.flatMap((op, n) => selectedSet.has(n) ? [] : [...op.inputs].filter((id) => id >= 0)));
    for (const op of operators) {
        const code = index.raw.operator_codes[op.opcode_index];
        const type = Math.max(code.builtin_code, code.deprecated_builtin_code);
        if (!schema.BuiltinOperator[type]) throw new Error('模型包含本版未支援的 operator，暫不能安全匯出。');
        if (type === schema.BuiltinOperator.CUSTOM || Number(op.large_custom_options_size || 0n) || /(?:VAR_HANDLE|VARIABLE|HASHTABLE|RANDOM|CALL_ONCE|ASSIGN)/.test(schema.BuiltinOperator[type] || '') || [...(op.mutating_variable_inputs || [])].some(Boolean)) throw new Error('目前不匯出 custom 或有狀態的 operators；需要對應 runtime／初始化程序。');
        if ([op.builtin_options, op.builtin_options_2].some((options) => options && Object.keys(options).some((key) => /subgraph/.test(key)))) throw new Error('目前不匯出含控制流程或子圖呼叫的區域，避免遺漏被呼叫的 subgraphs。');
        for (const id of [...op.inputs, ...op.outputs, ...op.intermediates || []]) if (id >= 0) used.add(id);
        for (const id of op.inputs) if (id >= 0) consumed.add(id);
        for (const id of op.outputs) if (id >= 0) produced.add(id);
    }
    // Quantization details can themselves refer to scale/zero-point tensors.
    for (const id of used) {
        const tensor = graph.tensors[id];
        if (!tensor) throw new Error('Tensor 索引無效。');
        if (tensor.is_variable || tensor.type === 13 || tensor.type === 14 || tensor.external_buffer) throw new Error('目前不支援 variable、resource、variant 或外部檔案 tensor 的子模型匯出。');
        const q = tensor.quantization?.details;
        for (const key of ['scales', 'zero_points']) if (q?.[key] >= 0) { used.add(q[key]); consumed.add(q[key]); }
    }
    const tensorIds = [...used].sort((a, b) => a - b);
    const remap = new Map(tensorIds.map((id, i) => [id, i]));
    const mapId = (id) => id < 0 ? id : remap.get(id);
    const buffers = [Object.assign(new schema.Buffer(), { data: new Uint8Array(), offset: 0n, size: 0n })];
    const bufferMap = new Map([[0, 0]]);
    const tensors = tensorIds.map((id) => {
        const source = graph.tensors[id];
        if (!bufferMap.has(source.buffer)) {
            const b = index.raw.buffers[source.buffer];
            const offset = Number(b?.offset || 0n), size = Number(b?.size || 0n);
            if (!Number.isSafeInteger(offset) || !Number.isSafeInteger(size) || offset < 0 || size < 0 || offset + size > file.size) throw new Error('權重 buffer 超出來源檔案範圍。');
            bufferMap.set(source.buffer, buffers.length);
            // External ranges must omit data entirely. An empty inline vector
            // takes precedence over offset/size in the runtime.
            buffers.push(Object.assign(new schema.Buffer(), { data: size ? null : new Uint8Array(), offset: 0n, size: 0n, ...(size ? {sourceRange:{offset, size}} : {}) }));
        }
        const tensor = { ...source, buffer: bufferMap.get(source.buffer) };
        const details = source.quantization?.details;
        if (details && 'scales' in details) tensor.quantization = { ...source.quantization, details: Object.assign(new details.constructor(), details, { scales: mapId(details.scales), zero_points: mapId(details.zero_points) }) };
        return tensor;
    });
    const inputs = tensorIds.filter((id) => consumed.has(id) && !produced.has(id) && !Number(index.raw.buffers[graph.tensors[id].buffer]?.size || 0n));
    const outputs = tensorIds.filter((id) => produced.has(id) && (outsideConsumers.has(id) || graph.outputs.includes(id) || !consumed.has(id)));
    if (!outputs.length) throw new Error('選取區域沒有可匯出的輸出。');
    const exported = {
        version: index.raw.version, operator_codes: index.raw.operator_codes,
        subgraphs: [{ tensors, inputs: Int32Array.from(inputs, mapId), outputs: Int32Array.from(outputs, mapId), operators: operators.map((op) => ({ ...op, inputs: Int32Array.from(op.inputs, mapId), outputs: Int32Array.from(op.outputs, mapId), intermediates: Int32Array.from(op.intermediates || [], mapId), debug_metadata_index: -1 })), name: `${graph.name || 'Subgraph'} / extracted`, debug_metadata_index: -1 }],
        description: 'Model Lens extracted submodel; boundary tensors are inputs/outputs. Original operator options, tensors, quantization and required weights preserved.', buffers,
        metadata: [], metadata_buffer: new Int32Array(), signature_defs: [], external_buffers: [], external_buffer_groups: []
    };
    const blob = new FlatbufferWriter().finish(exported, file);
    return { blob, layers: nodes.length, tensors: tensors.length, inputs: inputs.map((id) => ({ id: mapId(id), sourceId: id, name: graph.tensors[id].name })), outputs: outputs.map((id) => ({ id: mapId(id), sourceId: id, name: graph.tensors[id].name })) };
}
