import { tflite as schema } from '../vendor/netron/tflite-schema.js';
import { FlatbufferWriter } from './flatbuffer-writer.js';

export function exportTflite(index, graphIndex, selected, file) {
    if (!index.raw) throw new Error('缺少 TFLite 原始模型資料，請重新開啟模型後匯出。');
    if (index.exportUnsupportedReason) throw new Error(index.exportUnsupportedReason);
    const graph = index.raw.subgraphs[graphIndex];
    const nodes = [...new Set(selected)].sort((a, b) => a - b);
    if (!graph || !nodes.length || nodes.some((n) => !Number.isInteger(n) || !graph.operators[n])) throw new Error('請先在圖上選取 layers 或選取搜尋結果。');
    const operators = nodes.map((n) => graph.operators[n]);
    const customOperators = [...new Set(operators.filter((op) => {
        const code = index.raw.operator_codes[op.opcode_index];
        return code && Math.max(code.builtin_code, code.deprecated_builtin_code) === schema.BuiltinOperator.CUSTOM;
    }).map((op) => index.raw.operator_codes[op.opcode_index].custom_code || 'Custom'))];
    // Unknown custom payloads can contain tensor/buffer indices. Preserve their
    // numbering and data instead of guessing how to rewrite opaque bytes.
    const preservedIds = customOperators.length > 0;
    const range = (offset, size) => {
        offset = Number(offset || 0n); size = Number(size || 0n);
        if (!Number.isSafeInteger(offset) || !Number.isSafeInteger(size) || offset < 0 || size < 0 || (size && offset < 2) || offset > file.size - size) throw new Error('權重或 custom options 的資料範圍超出來源檔案。');
        return { offset, size };
    };
    const used = new Set(); const produced = new Set(); const consumed = new Set();
    const selectedSet = new Set(nodes);
    const outsideConsumers = new Set(graph.operators.flatMap((op, n) => selectedSet.has(n) ? [] : [...op.inputs].filter((id) => id >= 0)));
    for (const op of operators) {
        const code = index.raw.operator_codes[op.opcode_index];
        const type = Math.max(code.builtin_code, code.deprecated_builtin_code);
        if (!schema.BuiltinOperator[type]) throw new Error('模型包含本版未支援的 operator，暫不能安全匯出。');
        if (/(?:VAR_HANDLE|VARIABLE|HASHTABLE|RANDOM|CALL_ONCE|ASSIGN)/.test(schema.BuiltinOperator[type] || '') || [...(op.mutating_variable_inputs || [])].some(Boolean)) throw new Error('目前不匯出有狀態的 operators；需要對應初始化程序。');
        if (op.large_custom_options_size) range(op.large_custom_options_offset, op.large_custom_options_size);
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
    const tensorIds = preservedIds ? graph.tensors.map((_, i) => i) : [...used].sort((a, b) => a - b);
    const remap = new Map(tensorIds.map((id, i) => [id, i]));
    const mapId = (id) => id < 0 ? id : remap.get(id);
    const bufferIds = preservedIds ? index.raw.buffers.map((_, i) => i) : [...new Set([0, ...tensorIds.map((id) => graph.tensors[id].buffer)])];
    const bufferMap = new Map(bufferIds.map((id, i) => [id, i]));
    const buffers = bufferIds.map((id) => {
        const source = index.raw.buffers[id];
        if (!source) throw new Error('權重 buffer 編號無效。');
        const { offset, size } = range(source.offset, source.size);
        return Object.assign(new schema.Buffer(), { data: size ? null : source.data || new Uint8Array(), offset: 0n, size: 0n, ...(size ? { sourceRange: { offset, size, kind:'buffer', reference:`buffer:${id}` } } : {}) });
    });
    const tensors = tensorIds.map((id) => {
        const source = graph.tensors[id];
        if (!bufferMap.has(source.buffer)) throw new Error('Tensor 指向不存在的權重 buffer。');
        if (source.external_buffer) throw new Error('目前不能將外部檔案 tensor 的資料封裝進子模型。');
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
        description: `Model Lens extracted submodel; boundary tensors are inputs/outputs. Original operator options, tensors, quantization and required weights preserved.${preservedIds ? ' Custom operators: original tensor/buffer indices and all buffers retained; opaque options preserved, custom runtime required.' : ''}`, buffers,
        // TFLITE_METADATA describes the original graph boundaries. Other opaque
        // metadata can be a custom runtime dependency, so keep it and its buffers.
        metadata: preservedIds ? index.raw.metadata.filter((item) => item.name !== 'TFLITE_METADATA') : [], metadata_buffer: preservedIds ? Int32Array.from(index.raw.metadata_buffer.filter((id) => !index.raw.metadata.some((item) => item.name === 'TFLITE_METADATA' && item.buffer === id))) : new Int32Array(), signature_defs: [], external_buffers: [], external_buffer_groups: []
    };
    exported.subgraphs[0].operators = exported.subgraphs[0].operators.map((op, i) => {
        if (op.customOptionsInline && op.custom_options?.length) op = {...op, byteSources:{custom_options:{...op.customOptionsRange, kind:'custom-options-inline', reference:`operator:${nodes[i]}`}}};
        if (!op.large_custom_options_size && !op.customOptionsDeferred) return op;
        const sourceRange = op.customOptionsDeferred ? range(op.customOptionsRange.offset, op.customOptionsRange.size) : range(op.large_custom_options_offset, op.large_custom_options_size);
        // Preserve inline precedence when both representations exist. A large
        // deferred inline vector becomes the effective external initialization data.
        const inline = !op.customOptionsDeferred && op.customOptionsInline;
        return { ...op, custom_options: inline ? op.custom_options : null, large_custom_options_offset: 0n, large_custom_options_size: 0n, externalRanges: [{ offsetKey: 'large_custom_options_offset', sizeKey: 'large_custom_options_size', ...sourceRange, kind:'custom-options-external', reference:`operator:${nodes[i]}` }] };
    });
    const {blob,ranges} = new FlatbufferWriter().finishArtifact(exported, file);
    const boundary = id => {
        const t=graph.tensors[id],q=t.quantization;
        const details=q?.details;
        return {id:mapId(id),sourceId:id,name:t.name,shape:[...t.shape],shapeSignature:[...(t.shape_signature || [])],dtype:schema.TensorType[t.type] || String(t.type),quantization:q ? {min:[...(q.min || [])],max:[...(q.max || [])],scale:[...(q.scale || [])],zeroPoint:[...(q.zero_point || [])].map(String),dimension:q.quantized_dimension,details:details?{type:details.constructor.name,...Object.fromEntries(Object.entries(details).map(([key,value])=>[key,typeof value==='bigint'?String(value):ArrayBuffer.isView(value)?[...value]:value]))}:null}:null};
    };
    const provenance={mode:'tflite-subgraph',ranges,operators:nodes.map((node,i)=>({source:{graph:graphIndex,node},output:{graph:0,node:i}})),tensorMap:[...used].sort((a,b)=>a-b).map(id=>({sourceId:id,outputId:mapId(id)}))};
    return { blob, provenance, layers: nodes.length, tensors: tensors.length, customOperators, preservedIds, retainedBuffers: buffers.length, inputs: inputs.map(boundary), outputs: outputs.map(boundary) };
}
