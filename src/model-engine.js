import '../vendor/netron/base.js?v=6c76cced0e0a8fe9';
import { BinaryReader } from '../vendor/netron/flatbuffers.js?v=6c76cced0e0a8fe9';
import { ModelFactory, Value, Tensor } from '../vendor/netron/tflite.js?v=6c76cced0e0a8fe9';
import { tflite as schema } from '../vendor/netron/tflite-schema.js?v=6c76cced0e0a8fe9';
import { RangeStream } from './range-stream.js?v=6c76cced0e0a8fe9';
import { operatorKey, operatorIndex } from './pattern-utils.js?v=6c76cced0e0a8fe9';
export { operatorKey } from './pattern-utils.js?v=6c76cced0e0a8fe9';
const argumentValues = (argument) => Array.isArray(argument.value) ? argument.value.filter((value) => value && typeof value === 'object' && value.identifier !== undefined) : [];
export const CUSTOM_OPTIONS_PREVIEW_LIMIT = 64 * 1024;

// Preserve the original Netron parser, but represent inline weights using the
// external-buffer range path it already supports. No weight payload is copied.
schema.Buffer.decode = (reader, position) => {
    const buffer = new schema.Buffer();
    buffer.data = new Uint8Array(0);
    buffer.offset = reader.uint64_(position, 6, 0n);
    buffer.size = reader.uint64_(position, 8, 0n);
    const field = reader.__offset(position, 4);
    if (field) {
        const vector = position + field + reader.int32(position + field);
        const length = reader.uint32(vector);
        if (length) { buffer.offset = BigInt(vector + 4); buffer.size = BigInt(length); }
    }
    return buffer;
};

export async function parseModel(readAt, length, metadata, progress = () => {}) {
    const start = performance.now();
    const stream = new RangeStream(readAt, length);
    const reader = BinaryReader.open(stream);
    if (!reader || reader.identifier !== 'TFL3') throw new Error('請選擇有效的 TFLite（TFL3）模型。');
    reader._size = 64 * 1024;
    // Keep read-only inspection available for newer schemas, but never export
    // data whose unknown fields/options would be silently dropped by our writer.
    let exportUnsupportedReason = '';
    const maxima = new Map();
    const checkTable = (position, type) => {
        if (!maxima.has(type)) {
            const offsets = [...type.decode.toString().matchAll(/reader\.\w+\(position, (\d+)/g)].map((match) => Number(match[1]));
            let max = Math.max(2, ...offsets);
            if (/reader\.union\(position, /.test(type.decode.toString())) max = Math.max(max, ...[...type.decode.toString().matchAll(/reader\.union\(position, (\d+)/g)].map((m) => Number(m[1]) + 2));
            // The lazy Buffer decoder uses __offset directly for inline data.
            maxima.set(type, type === schema.Buffer ? 8 : max);
        }
        const vt = position - reader.int32(position);
        for (let slot = maxima.get(type) + 2; slot < reader.uint16(vt); slot += 2) {
            if (reader.uint16(vt + slot)) exportUnsupportedReason = '模型包含本版 schema 未支援的新欄位；可檢視，但暫不能安全匯出子模型。';
        }
    };
    for (const method of ['table', 'tables', 'union']) {
        const original = reader[method];
        reader[method] = function(position, offset, type) {
            const checked = { decode: (r, p, tag) => {
                // Unions choose the concrete table inside their decode method.
                let value;
                if (type === schema.Operator) {
                    const inline = Boolean(r.__offset(p, 14));
                    const originalArray = r.array;
                    let optionsRange = null;
                    let deferred = false;
                    r.array = function(position, offset, elementType) {
                        if (position === p && offset === 14 && elementType === Uint8Array && inline) {
                            const field = p + r.__offset(p, 14);
                            const vector = field + r.int32(field);
                            const size = r.uint32(vector);
                            optionsRange = { offset: vector + 4, size };
                            if (optionsRange.offset > length - size) throw new Error('Custom options 資料範圍超出檔案。');
                            if (size > CUSTOM_OPTIONS_PREVIEW_LIMIT) { deferred = true; return new Uint8Array(); }
                        }
                        return originalArray.call(this, position, offset, elementType);
                    };
                    try { value = type.decode(r, p, tag); }
                    finally { r.array = originalArray; }
                    Object.assign(value, { customOptionsInline: inline, customOptionsRange: optionsRange, customOptionsDeferred: deferred });
                } else value = type.decode(r, p, tag);
                if (method === 'union' && tag && !value) exportUnsupportedReason = '模型包含未知 operator／量化 options；暫不能安全匯出子模型。';
                if (value) checkTable(p, method === 'union' ? value.constructor : type);
                return value;
            } };
            return original.call(this, position, offset, checked);
        };
    }
    const types = new Map(metadata.map((item) => [item.name, item]));
    const context = {
        type: 'tflite.flatbuffers', value: reader, stream,
        require: async () => ({ tflite: schema }),
        metadata: async () => ({
            type: (name) => types.get(name) || { name: String(name) },
            attribute: (type, name) => types.get(type)?.attributes?.find((item) => item.name === name) || null
        })
    };
    progress('解析模型結構');
    let raw;
    const create = schema.Model.create;
    schema.Model.create = (r) => { raw = create.call(schema.Model, r); return raw; };
    let model;
    try { model = await new ModelFactory().open(context); }
    finally { schema.Model.create = create; }
    progress('建立 Layers／Tensors 索引');
    checkTable(reader.root, schema.Model);
    model.modules.forEach((graph, g) => graph.nodes.forEach((node) => {
        const op = raw.subgraphs[g].operators[Number(node.identifier)];
        if (op?.customOptionsDeferred || op?.large_custom_options_size) {
            const bytes = op.customOptionsDeferred ? op.customOptionsRange.size : String(op.large_custom_options_size);
            node.attributes.push({ name: 'custom_options 資料範圍', type: 'string', value: `${bytes} bytes；保留原始資料，未展開內容。切圖時由本機檔案搬移。` });
        }
    }));
    return { ...indexModel(model, (tensors, graphIndex) => {
        // Include even tensors not referenced by any operator or graph boundary.
        raw.subgraphs[graphIndex].tensors.forEach((tensor, index) => {
            if (!tensors.has(String(index))) {
                const buffer = raw.buffers[tensor.buffer];
                const initializer = buffer?.size ? new Tensor(index, tensor, buffer, stream, tensor.is_variable) : null;
                tensors.set(String(index), new Value(index, tensor, initializer, '', ''));
            }
        });
    }), raw, exportUnsupportedReason, stats: { ...stream.stats, fileBytes: length, parseMs: performance.now() - start } };
}

// Parser adapters supply a shared graph shape; searching and slicing are format independent.
export function indexModel(model, additionalTensors = () => {}) {
    const graphs = model.modules.map((graph, graphIndex) => {
        const tensors = new Map();
        const producers = new Map();
        const consumers = new Map();
        const visit = (argument) => {
            for (const value of argumentValues(argument)) tensors.set(value.identifier, value);
        };
        for (const arg of [...graph.inputs, ...graph.outputs]) visit(arg);
        graph.nodes.forEach((node, index) => {
            for (const argument of [...node.inputs, ...node.outputs]) visit(argument);
            for (const arg of node.outputs) for (const value of argumentValues(arg)) producers.set(value.identifier, index);
            for (const arg of node.inputs) for (const value of argumentValues(arg)) {
                if (!consumers.has(value.identifier)) consumers.set(value.identifier, new Set());
                consumers.get(value.identifier).add(index);
            }
        });
        additionalTensors(tensors, graphIndex);
        const next = graph.nodes.map((node) => new Set(node.outputs.flatMap((arg) => argumentValues(arg).flatMap((v) => [...(consumers.get(v.identifier) || [])]))));
        const previous = graph.nodes.map(() => new Set());
        next.forEach((targets, from) => targets.forEach((to) => previous[to].add(from)));
        const records = [];
        graph.nodes.forEach((node, index) => {
            const names = [...node.inputs, ...node.outputs].flatMap((arg) => argumentValues(arg).map((value) => value.name.split('\n')[0])).join(' ');
            records.push({ kind: 'layers', graph: graphIndex, index, id: node.identifier, label: node.name || node.type.name, operator: node.type.name, text: `${node.name} ${names} ${node.type.name} ${operatorKey(node.type.name)} ${node.identifier}`.toLowerCase() });
        });
        for (const value of tensors.values()) {
            const linked = new Set([...(consumers.get(value.identifier) || []), producers.get(value.identifier)].filter((x) => x !== undefined));
            const operators = [...linked].map((i) => graph.nodes[i].type.name).join(' ');
            records.push({ kind: 'tensors', graph: graphIndex, id: value.identifier, label: value.name.split('\n')[0] || `Tensor #${value.identifier}`, dtype: value.type?.dataType, shape: value.type?.shape?.dimensions || [], operator: operators, text: `${value.name} ${operators} ${operatorKey(operators)}`.toLowerCase() });
        }
        const entry = { graph, tensors, producers, consumers, next, previous, records };
        operatorIndex(entry);
        return entry;
    });
    return { model, graphs };
}

export function search(index, kind, query, scope = 'all') {
    const q = query.trim().toLowerCase();
    const exact = /^#?\d+$/.test(q) ? q.replace(/^#/, '') : null;
    const key = operatorKey(q);
    return index.graphs.flatMap((g, i) => scope !== 'all' && i !== Number(scope) ? [] : g.records.filter((record) => record.kind === kind && (!q || (exact !== null ? record.id === exact : record.text.includes(q) || (key && operatorKey(record.operator).includes(key))))));
}

export async function findPatterns(index, operators, scope = 'all', cancelled = () => false) {
    const pattern = operators.map(operatorKey);
    if (!pattern.length || pattern.some((x) => !x)) throw new Error('請至少選擇一個 operator。');
    const results = [];
    const limit = 50000;
    let steps = 0;
    let yieldAt = 0;
    for (let g = 0; g < index.graphs.length; g++) {
        if (scope !== 'all' && g !== Number(scope)) continue;
        const { graph, next } = index.graphs[g];
        const { keys, byType } = operatorIndex(index.graphs[g]);
        if (pattern.length > graph.nodes.length || pattern.some((type) => !byType.has(type))) continue;
        const stack = [];
        for (let n = graph.nodes.length - 1; n >= 0; n--) if (keys[n] === pattern[0]) stack.push([n]);
        while (stack.length) {
            if (++steps > 2000000) return { items: results, truncated: true, searchLimited: true };
            if (steps % 2000 === 0) {
                if (performance.now() >= yieldAt) { await new Promise((resolve) => setTimeout(resolve, 0)); yieldAt = performance.now() + 8; }
                if (cancelled()) return null;
            }
            const path = stack.pop();
            if (path.length === pattern.length) {
                results.push({ kind: 'patterns', graph: g, path, label: path.map((n) => graph.nodes[n].type.name).join(' → '), id: path.map((n) => graph.nodes[n].identifier).join(' → ') });
                if (results.length === limit) return { items: results, truncated: true };
            } else {
                for (const n of [...next[path.at(-1)]].reverse()) {
                    if (++steps > 2000000) return { items: results, truncated: true, searchLimited: true };
                    if (steps % 2000 === 0) {
                        if (performance.now() >= yieldAt) { await new Promise((resolve) => setTimeout(resolve, 0)); yieldAt = performance.now() + 8; }
                        if (cancelled()) return null;
                    }
                    if (!path.includes(n) && keys[n] === pattern[path.length]) stack.push([...path, n]);
                }
            }
        }
    }
    return { items: results, truncated: false };
}

export function selectNodes(entry, selected, hops = 1, maximum = 100) {
    const result = new Set(selected);
    let frontier = [...selected];
    for (let depth = 0; depth < hops && result.size < maximum; depth++) {
        const next = [];
        for (const node of frontier) for (const neighbor of [...entry.next[node], ...entry.previous[node]]) {
            if (!result.has(neighbor) && result.size < maximum) { result.add(neighbor); next.push(neighbor); }
        }
        frontier = next;
    }
    return [...result].sort((a, b) => a - b);
}

export function snapshot(index, graphIndex, selected, full = false) {
    const entry = index.graphs[graphIndex];
    const nodes = full ? entry.graph.nodes.map((_, i) => i) : selectNodes(entry, selected);
    const graph = { ...entry.graph, nodes: nodes.map((n) => entry.graph.nodes[n]) };
    // Boundary tensors preserve the context of the sliced graph.
    if (!full) {
        const outputs = new Set(graph.nodes.flatMap((n) => n.outputs.flatMap(argumentValues)));
        const inputs = new Set(graph.nodes.flatMap((n) => n.inputs.flatMap(argumentValues)));
        graph.inputs = [...inputs].filter((v) => !outputs.has(v) && !v.initializer).map((v) => ({ name: v.name.split('\n')[0] || `#${v.identifier}`, value: [v] }));
        graph.outputs = [...outputs].filter((v) => !inputs.has(v) || [...(entry.consumers.get(v.identifier) || [])].some((n) => !nodes.includes(n))).map((v) => ({ name: v.name.split('\n')[0] || `#${v.identifier}`, value: [v] }));
        graph.signatures = [];
    }
    return { graph: serialize(graph), graphIndex, nodes, selected, total: entry.graph.nodes.length, full };
}

export function selectionSnapshot(index, item, { full = false, metadataOnly = false } = {}) {
    const entry = index.graphs[item.graph];
    const selected = item.path || (item.kind === 'layers' ? [item.index] : [...new Set([entry.producers.get(item.id), ...(entry.consumers.get(item.id) || [])].filter((n) => n !== undefined))].slice(0, 20));
    const detail = item.kind === 'tensors' ? serialize(entry.tensors.get(item.id)) : null;
    // A rendered full graph needs no repeated graph/weight metadata transfer.
    const graph = full && metadataOnly ? { graphIndex: item.graph, selected, total: entry.graph.nodes.length, full, metadataOnly: true } : snapshot(index, item.graph, selected, full);
    return { ...graph, detail, item };
}

export function serialize(value, seen = new Map()) {
    if (value === null || typeof value !== 'object') return value;
    if (seen.has(value)) return seen.get(value);
    if (value instanceof RangeStream) return { __range: true, offset: value.offset, length: value.length };
    if (ArrayBuffer.isView(value)) return value;
    const result = Array.isArray(value) ? [] : {};
    seen.set(value, result);
    for (const [key, item] of Object.entries(value)) result[key] = serialize(item, seen);
    return result;
}
