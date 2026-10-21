export const operatorKey = (name) => String(name).replace(/[^a-z0-9]/gi, '').toUpperCase();
export const LORA_PATTERN = 'Mul0 -> FC -> Add0\nMul0 -> BMM0 -> BMM1 -> Add0';
// Reuse normalized operator types across searches on the same immutable graph.
export function operatorIndex(entry) {
    if (!entry.operatorIndex) {
        const byType = new Map();
        const names = new Set();
        const keys = entry.graph.nodes.map((node, n) => {
            names.add(node.type.name);
            const key = operatorKey(node.type.name);
            if (!byType.has(key)) byType.set(key, []);
            byType.get(key).push(n);
            return key;
        });
        entry.operatorIndex = { keys, byType, names: [...names] };
    }
    return entry.operatorIndex;
}
