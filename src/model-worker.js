import { parseModel, search, findPatterns, snapshot, serialize } from './model-engine.js';
import { parseGraphPattern, prepareGraphPattern, captureGraphPattern, findSubgraphPatterns } from './subgraph-pattern.js';
import { operatorKey } from './pattern-utils.js';
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
            index = await parseModel((offset, length) => new Uint8Array(reader.readAsArrayBuffer(file.slice(offset, offset + length))), file.size, await response.json(), (stage) => postMessage({ stage }));
            send(id, { format: index.model.format, description: index.model.description, stats: index.stats, graphs: index.graphs.map((e, i) => ({ index: i, name: e.graph.name || `Subgraph ${i}`, layers: e.graph.nodes.length, tensors: e.tensors.size })), operators: [...new Set(index.graphs.flatMap((e) => e.graph.nodes.map((n) => n.type.name)))].sort() });
        } else if (action === 'search') {
            generation++;
            results = search(index, args.kind, args.query, args.scope);
            send(id, { items: results.slice(0, 100), total: results.length, offset: 0 });
        } else if (action === 'pattern' || action === 'subgraphPattern') {
            const current = ++generation;
            const available = [...new Set(index.graphs.flatMap((g) => g.graph.nodes.map((n) => n.type.name)))];
            const spec = action === 'subgraphPattern' ? args.structure ? prepareGraphPattern(args.structure.nodes, args.structure.edges) : parseGraphPattern(args.text, available) : null;
            if (spec) spec.induced = Boolean(args.structure?.induced ?? args.induced);
            if (spec && args.structure) spec.label = `分支子圖 · ${spec.nodes.length} 節點 · ${spec.edges.length} 連線`;
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
            const item = args.item;
            const entry = index.graphs[item.graph];
            let nodes = item.path || (item.kind === 'layers' ? [item.index] : [...new Set([entry.producers.get(item.id), ...(entry.consumers.get(item.id) || [])].filter((x) => x !== undefined))].slice(0, 20));
            const detail = item.kind === 'tensors' ? serialize(entry.tensors.get(item.id)) : null;
            if (!nodes.length) nodes = [];
            send(id, { ...snapshot(index, item.graph, nodes, args.full), detail, item });
        } else if (action === 'graph') {
            send(id, { ...snapshot(index, args.graph, args.full ? [] : [0].filter(() => index.graphs[args.graph].graph.nodes.length), args.full), item: null });
        }
    } catch (error) { postMessage({ id, error: error.message || String(error) }); }
};
