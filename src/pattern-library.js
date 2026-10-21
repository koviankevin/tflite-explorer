import { prepareGraphPattern } from './subgraph-pattern.js';

export const PATTERN_LIBRARY_KEY = 'model-lens.patterns.v1';

export function reusablePattern(name, structure) {
    const title = String(name || '').trim().slice(0, 80);
    if (!title) throw new Error('請輸入 pattern 名稱。');
    const spec = prepareGraphPattern(structure.nodes, structure.edges);
    const types = new Map(structure.nodes.map((node) => [node.alias, String(node.type).trim()]));
    return { name: title, nodes: spec.nodes.map((node) => ({ alias: node.alias, type: types.get(node.alias) })), edges: spec.edges, induced: Boolean(structure.induced) };
}

export function loadPatterns(storage) {
    const value = JSON.parse(storage.getItem(PATTERN_LIBRARY_KEY) || '[]');
    if (!Array.isArray(value)) return [];
    return value.slice(0, 50).flatMap((item) => {
        try { return [reusablePattern(item.name, item)]; } catch { return []; }
    });
}

export function savePattern(storage, library, pattern) {
    const clean = reusablePattern(pattern.name, pattern);
    const next = [...library.filter((item) => item.name !== clean.name), clean];
    if (next.length > 50) throw new Error('最多儲存 50 組 pattern。請使用既有名稱更新。');
    storage.setItem(PATTERN_LIBRARY_KEY, JSON.stringify(next));
    return next;
}
