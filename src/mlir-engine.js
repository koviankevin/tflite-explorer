import { ModelFactory } from '../vendor/netron/mlir.js';
import { Decoder } from '../vendor/netron/text.js';
import { indexModel } from './model-engine.js';

export const MLIR_TEXT_LIMIT = 64 * 1024 * 1024;

export async function parseMlir(bytes, identifier, metadata, progress = () => {}) {
    if (bytes.length > MLIR_TEXT_LIMIT) throw new Error('文字 MLIR 目前最多 64 MiB；請先在內部工具移除大型常數或拆分檔案。');
    if (bytes[0] === 0x4d && bytes[1] === 0x4c && bytes[2] === 0xef && bytes[3] === 0x52) {
        throw new Error('目前支援文字 .mlir；MLIR bytecode 請先以內部 MLIR 工具轉成文字通用語法。');
    }
    const start = performance.now();
    progress('解析文字 MLIR');
    let model;
    try {
        model = await new ModelFactory().open({
            type: 'mlir.text', identifier,
            asset: async () => metadata,
            read: async (kind) => {
                if (kind === 'text.decoder') return Decoder.open(bytes);
                throw new Error(`不支援的 MLIR 讀取方式：${kind}`);
            }
        });
    } catch (error) {
        throw new Error(`MLIR 解析失敗：${error.message}。自訂 dialect 請先匯出通用語法（--mlir-print-op-generic）；專用簡寫語法需要額外接入。`);
    }
    const graphs = [];
    const seen = new Set();
    const collect = (graph, name) => {
        if (seen.has(graph)) return;
        seen.add(graph);
        graph.name ||= name;
        graph.nodes.forEach((node, index) => { node.identifier = String(index); });
        const values = new Map();
        for (const arg of [...graph.inputs, ...graph.outputs, ...graph.nodes.flatMap((node) => [...node.inputs, ...node.outputs])]) {
            // Scalar attributes also use Netron Argument; only SSA values form edges.
            if (!Array.isArray(arg.value)) continue;
            for (const value of arg.value) {
                if (!value || typeof value !== 'object' || typeof value.name !== 'string') continue;
                value.identifier = value.name;
                values.set(value.name, value);
            }
        }
        for (const arg of [...graph.inputs, ...graph.outputs, ...graph.nodes.flatMap((node) => [...node.inputs, ...node.outputs])]) {
            if (Array.isArray(arg.value)) arg.value = arg.value.map((value) => values.get(value?.name) || value);
        }
        graphs.push(graph);
        for (const node of graph.nodes) for (const block of node.blocks || []) {
            if (block.value?.nodes) collect(block.value, `${graph.name}/${node.identifier}:${block.name}`);
        }
    };
    for (const graph of [...model.modules, ...model.functions]) collect(graph, `Graph ${graphs.length}`);
    if (!graphs.length) throw new Error('MLIR 沒有可檢視的 function 或 operation graph。');
    model.modules = graphs;
    progress('建立 MLIR Layers／Tensors 索引');
    return { ...indexModel(model), stats: { bytesRead: bytes.length, reads: 1, fileBytes: bytes.length, parseMs: performance.now() - start } };
}
