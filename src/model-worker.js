import { parseModel, search, findPatterns, snapshot, selectionSnapshot } from './model-engine.js';
import { parseGraphPattern, prepareGraphPattern, captureGraphPattern, findSubgraphPatterns } from './subgraph-pattern.js';
import { operatorKey, operatorIndex } from './pattern-utils.js';
let index;
let results = [];
let generation = 0;
let file;
const send = (id, data) => postMessage({ id, data });
self.onmessage = async ({ data: { id, action, args } }) => {
    try {
        if (action === 'open') {
            file = args.file;
            const reader = new FileReaderSync();
            const response = await fetch(new URL('../vendor/netron/tflite-metadata.json', import.meta.url));
            if (!response.ok) throw new Error('無法載入 operator 定義。');
            const progress = (stage) => postMessage({ stage });
            index = await parseModel((offset, length) => new Uint8Array(reader.readAsArrayBuffer(file.slice(offset, offset + length))), file.size, await response.json(), progress);
            send(id, { format: index.model.format, description: index.model.description, stats: index.stats, graphs: index.graphs.map((e, i) => ({ index: i, name: e.graph.name || `Subgraph ${i}`, layers: e.graph.nodes.length, tensors: e.tensors.size })), operators: [...new Set(index.graphs.flatMap((entry) => operatorIndex(entry).names))].sort() });
        } else if (action === 'exportTflite') {
            const { exportTflite } = await import('./tflite-export.js');
            send(id, exportTflite(index, args.graph, args.nodes, file));
        } else if (action === 'search') {
            generation++;
            results = search(index, args.kind, args.query, args.scope);
            send(id, { items: results.slice(0, 100), total: results.length, offset: 0 });
        } else if (action === 'pattern' || action === 'subgraphPattern') {
            const current = ++generation;
            const available = [...new Set(index.graphs.flatMap((entry) => operatorIndex(entry).names))];
            const spec = action === 'subgraphPattern' ? args.structure ? prepareGraphPattern(args.structure.nodes, args.structure.edges) : parseGraphPattern(args.text, available) : null;
            if (spec) spec.induced = Boolean(args.structure?.induced ?? args.induced);
            if (spec && args.structure) spec.label = `連接結構 · ${spec.nodes.length} 節點 · ${spec.edges.length} 連線`;
            const result = spec ? await findSubgraphPatterns(index, spec, args.scope, () => generation !== current) : await findPatterns(index, args.operators, args.scope, () => generation !== current);
            if (!result) { send(id, { cancelled: true }); return; }
            results = result.items;
            const decodedNodes = spec?.nodes.map((node) => ({ alias: node.alias, type: available.find((type) => operatorKey(type) === node.type) || node.type, present: available.some((type) => operatorKey(type) === node.type) }));
            send(id, { items: results.slice(0, 100), total: results.length, offset: 0, truncated: result.truncated, searchLimited: result.searchLimited, decodedNodes });
        } else if (action === 'capturePattern') {
            const entry = index.graphs[args.graph];
            if (!entry) throw new Error('找不到目前 subgraph。');
            send(id, captureGraphPattern(entry, args.nodes));
        } else if (action === 'page') {
            send(id, { items: results.slice(args.offset, args.offset + 100), total: results.length, offset: args.offset });
        } else if (action === 'select') {
            send(id, selectionSnapshot(index, args.item, args));
        } else if (action === 'graph') {
            send(id, { ...snapshot(index, args.graph, args.full ? [] : [0].filter(() => index.graphs[args.graph].graph.nodes.length), args.full), item: null });
        }
    } catch (error) { postMessage({ id, error: error.message || String(error) }); }
};
