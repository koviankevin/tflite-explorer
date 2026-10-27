import { operatorKey, operatorIndex } from './pattern-utils.js?v=0f8361cc44fcd547';
import {normalizeConditions,conditionMatcher} from './pattern-conditions.js?v=0f8361cc44fcd547';
export { LORA_PATTERN } from './pattern-utils.js?v=0f8361cc44fcd547';

const aliases = new Map([['FC', 'FULLYCONNECTED'], ['BMM', 'BATCHMATMUL']]);
const canonical = (value) => aliases.get(operatorKey(value)) || operatorKey(value);

export function parseGraphPattern(text, available = []) {
    const nodes = new Map();
    const edges = new Map();
    const paths = [];
    const known = new Set(available.map(canonical));
    const lines = text.split(/\r?\n/).map((line) => line.trim()).filter((line) => line && !line.startsWith('//'));
    if (!lines.length) throw new Error('請輸入至少一條連接路徑。');
    if (lines.length > 16) throw new Error('一組子圖最多 16 條路徑。');
    for (const line of lines) {
        const path = line.split(/\s*(?:->|→)\s*/).map((part) => {
            const match = part.trim().match(/^([A-Za-z_][A-Za-z0-9_]*)(?:\s*:\s*([A-Za-z_][A-Za-z0-9_.]*))?$/);
            if (!match) throw new Error(`無法解析「${part}」。請使用 Mul0 -> FC -> Add0，或 m:Mul -> f:FullyConnected。`);
            const [, alias, explicit] = match;
            let type;
            if (explicit) type = canonical(explicit);
            else if (nodes.has(alias)) type = nodes.get(alias).type;
            else type = known.has(canonical(alias)) ? canonical(alias) : canonical(alias.replace(/\d+$/, ''));
            const existing = nodes.get(alias);
            if (existing && existing.type !== type) throw new Error(`別名 ${alias} 被指定為不同 operator。`);
            nodes.set(alias, { alias, type });
            return alias;
        });
        if (path.length < 2) throw new Error('每條路徑至少需要兩個節點，以 -> 連接。');
        for (let i = 0; i + 1 < path.length; i++) {
            if (path[i] === path[i + 1]) throw new Error('同一個節點不能直接連回自己。');
            const edge = { from: path[i], to: path[i + 1] };
            edges.set(`${edge.from}:${edge.to}`, edge);
        }
        paths.push(path);
    }
    return prepareGraphPattern([...nodes.values()], [...edges.values()], paths);
}

export function prepareGraphPattern(nodeList, edgeList, paths = null) {
    if (!Array.isArray(nodeList) || !nodeList.length || !Array.isArray(edgeList)) throw new Error('請先加入 operator 節點與連線。');
    if (nodeList.length > 32 || edgeList.length > 64) throw new Error('一組子圖最多 32 個節點、64 條連線。');
    const nodes = new Map();
    for (const node of nodeList) {
        if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(node.alias) || !operatorKey(node.type)) throw new Error('節點定義無效。');
        if (nodes.has(node.alias)) throw new Error('節點編號不可重複。');
        const conditions=normalizeConditions(node.conditions);
        nodes.set(node.alias, { alias: node.alias, type: operatorKey(node.type),...(conditions.length?{conditions}:{}) });
    }
    const edges = new Map();
    for (const edge of edgeList) {
        if (!nodes.has(edge.from) || !nodes.has(edge.to) || edge.from === edge.to) throw new Error('連線起點或終點無效。');
        edges.set(`${edge.from}:${edge.to}`, { from: edge.from, to: edge.to });
    }
    if (nodes.size > 32 || edges.size > 64) throw new Error('一組子圖最多 32 個節點、64 條連線。');
    const incoming = new Map([...nodes.keys()].map((alias) => [alias, []]));
    const outgoing = new Map([...nodes.keys()].map((alias) => [alias, []]));
    for (const { from, to } of edges.values()) { incoming.get(to).push(from); outgoing.get(from).push(to); }
    const reached = new Set();
    const stack = [nodes.keys().next().value];
    while (stack.length) { const alias = stack.pop(); if (reached.has(alias)) continue; reached.add(alias); stack.push(...incoming.get(alias), ...outgoing.get(alias)); }
    if (reached.size !== nodes.size) throw new Error('各路徑需共用節點，組成同一個連通子圖；請重複使用相同別名。');
    const counts = new Map([...incoming].map(([alias, parents]) => [alias, parents.length]));
    const queue = [...nodes.keys()].filter((alias) => counts.get(alias) === 0);
    let visited = 0;
    while (queue.length) {
        const alias = queue.shift(); visited++;
        for (const child of outgoing.get(alias)) { counts.set(child, counts.get(child) - 1); if (counts.get(child) === 0) queue.push(child); }
    }
    if (visited !== nodes.size) throw new Error('本版支援分支與匯合，但不支援循環 pattern。');
    return { nodes: [...nodes.values()], edges: [...edges.values()], paths: paths || [...edges.values()].map((edge) => [edge.from, edge.to]), incoming, outgoing };
}

// Extract only topology and operator types. Model names, tensor data and weights
// never enter a reusable pattern or the browser's pattern library.
export function captureGraphPattern(entry, selected) {
    const indexes = [...new Set(selected)].sort((a, b) => a - b);
    if (indexes.length < 2) throw new Error('請至少選取兩個相連的 layers。');
    if (indexes.length > 32) throw new Error('一組 pattern 最多選取 32 個 layers。');
    if (indexes.some((n) => !Number.isInteger(n) || !entry.graph.nodes[n])) throw new Error('選取的 layer 不在目前 subgraph。');
    const aliases = new Map(indexes.map((n, i) => [n, `N${i + 1}`]));
    const nodes = indexes.map((n) => ({ alias: aliases.get(n), type: entry.graph.nodes[n].type.name }));
    const edges = indexes.flatMap((from) => [...entry.next[from]].filter((to) => aliases.has(to)).map((to) => ({ from: aliases.get(from), to: aliases.get(to) })));
    prepareGraphPattern(nodes, edges);
    return { nodes, edges, induced: true };
}

export async function findSubgraphPatterns(index, spec, scope = 'all', cancelled = () => false) {
    const matches=conditionMatcher();
    const results = [];
    let steps = 0;
    let checks = 0;
    let yieldAt = 0;
    let limited = false;
    for (let g = 0; g < index.graphs.length; g++) {
        if (scope !== 'all' && g !== Number(scope)) continue;
        const entry = index.graphs[g];
        const { keys, byType } = operatorIndex(entry);
        if (spec.nodes.some((node) => !byType.has(node.type))) continue;
        const mapping = new Map();
        const used = new Set();
        const seen = new Set();
        const search = async () => {
            if (cancelled() || limited) return;
            if (mapping.size === spec.nodes.length) {
                if (spec.induced) {
                    for (const from of spec.nodes) for (const to of spec.nodes) {
                        if (entry.next[mapping.get(from.alias)].has(mapping.get(to.alias)) !== spec.outgoing.get(from.alias).includes(to.alias)) return;
                    }
                }
                const path = spec.nodes.map((node) => mapping.get(node.alias));
                const connections = spec.edges.map(({ from, to }) => [mapping.get(from), mapping.get(to)]);
                // Symmetric aliases may describe the same physical match.
                // Include edges so genuinely different paths remain distinct.
                const signature = JSON.stringify([[...path].sort((a, b) => a - b), connections.map(([from, to]) => `${from}:${to}`).sort()]);
                if (seen.has(signature)) return;
                seen.add(signature);
                const ids = spec.nodes.map((node) => `${node.alias} #${entry.graph.nodes[mapping.get(node.alias)].identifier}`);
                results.push({ kind: 'patterns', patternType: 'graph', graph: g, path, connections, label: spec.label || spec.paths.map((line) => line.join(' → ')).join(' / ') || `子圖 · ${spec.nodes.length} 個 operators`, id: ids.join(' · ') });
                if (results.length >= 50000) limited = true;
                return;
            }
            let chosen;
            let candidates;
            for (const node of spec.nodes) {
                if (mapping.has(node.alias)) continue;
                const constraints = [];
                for (const from of spec.incoming.get(node.alias)) if (mapping.has(from)) constraints.push(entry.next[mapping.get(from)]);
                for (const to of spec.outgoing.get(node.alias)) if (mapping.has(to)) constraints.push(entry.previous[mapping.get(to)]);
                // A connected pattern can always grow from its mapped frontier.
                // Scanning all nodes for a disconnected alias at every depth
                // makes even a simple chain quadratic in the model size.
                if (mapping.size && !constraints.length) continue;
                const typed = byType.get(node.type);
                const base = constraints.length ? [...constraints.reduce((a, b) => a.size <= b.size ? a : b)] : typed;
                const possible = [];
                for (const n of base) {
                    if (++checks % 2000 === 0) {
                        if (performance.now() >= yieldAt) {
                            await new Promise((resolve) => setTimeout(resolve, 0));
                            yieldAt = performance.now() + 8;
                        }
                        if (cancelled()) return;
                    }
                    if (checks > 2000000) { limited = true; return; }
                    if (!used.has(n) && keys[n] === node.type && constraints.every((set) => set.has(n)) && matches(entry.graph.nodes[n],node)) possible.push(n);
                }
                if (!possible.length) return;
                if (!candidates || possible.length < candidates.length) { chosen = node; candidates = possible; }
            }
            for (const candidate of candidates) {
                if (++steps % 1000 === 0) {
                    if (performance.now() >= yieldAt) {
                        await new Promise((resolve) => setTimeout(resolve, 0));
                        yieldAt = performance.now() + 8;
                    }
                    if (cancelled()) return;
                }
                if (steps > 2000000) { limited = true; return; }
                mapping.set(chosen.alias, candidate); used.add(candidate);
                await search();
                used.delete(candidate); mapping.delete(chosen.alias);
                if (limited || cancelled()) return;
            }
        };
        await search();
        if (cancelled()) return null;
        if (limited) break;
    }
    return { items: results, truncated: limited, searchLimited: steps > 2000000 || checks > 2000000 };
}
