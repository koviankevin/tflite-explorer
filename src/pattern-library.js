import { prepareGraphPattern } from './subgraph-pattern.js?v=fc124b8183a7a475';
import { operatorKey } from './pattern-utils.js?v=fc124b8183a7a475';
import {prepareMLIRPattern,CFG_PATTERN_MODE} from './mlir-pattern-spec.js?v=fc124b8183a7a475';

export const PATTERN_LIBRARY_KEY = 'model-lens.patterns.v3';
const previousLibraryKey='model-lens.patterns.v2';
const legacyLibraryKey='model-lens.patterns.v1';
export const PATTERN_FILE_LIMIT = 1024 * 1024;
const fileFormat = 'model-lens-patterns';

export function reusablePattern(name, structure) {
    if (!structure || !Array.isArray(structure.nodes) || !Array.isArray(structure.edges)) throw new Error('Pattern 缺少節點或連線。');
    if (structure.nodes.some((node) => !node || typeof node.alias !== 'string' || node.alias.length > 80 || typeof node.type !== 'string' || node.type.length > 256)) throw new Error('Pattern 的節點編號或 operator 類型無效。');
    if (structure.edges.some((edge) => !edge || typeof edge.from !== 'string' || typeof edge.to !== 'string')) throw new Error('Pattern 的連線無效。');
    const title = String(name || '').trim().slice(0, 80);
    if (!title) throw new Error('請輸入 pattern 名稱。');
    if(structure.mode!==undefined && structure.mode!==CFG_PATTERN_MODE)throw new Error('不支援此 pattern 搜尋模式。');
    const spec = structure.mode===CFG_PATTERN_MODE ? prepareMLIRPattern(structure) : prepareGraphPattern(structure.nodes, structure.edges);
    const types = new Map(structure.nodes.map((node) => [node.alias, String(node.type).trim()]));
    return { name: title, ...(spec.mode ? {mode:spec.mode} : {}), nodes: spec.nodes.map((node) => spec.mode ? {...node} : ({ alias: node.alias, type: types.get(node.alias),...(node.conditions?.length?{conditions:node.conditions}:{}) })), edges: spec.edges, induced: Boolean(structure.induced) };
}

export function loadPatterns(storage) {
    const value = JSON.parse(storage.getItem(PATTERN_LIBRARY_KEY) ?? storage.getItem(previousLibraryKey) ?? storage.getItem(legacyLibraryKey) ?? '[]');
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

export function exportPatterns(patterns) {
    if (!patterns.length || patterns.length > 50) throw new Error('請選擇 1 至 50 組已儲存的 patterns。');
    const text=JSON.stringify({ format: fileFormat, version: patterns.some(p=>p.nodes.some(n=>n.conditions?.length)) ? 3 : patterns.some(p=>p.mode===CFG_PATTERN_MODE) ? 2 : 1, patterns: patterns.map((pattern) => reusablePattern(pattern.name, pattern)) }, null, 2);
    if(new TextEncoder().encode(text).length>PATTERN_FILE_LIMIT)throw new Error('Pattern 檔案超過 1 MiB，請改為匯出所選 pattern。');
    return text;
}

export function parsePatternFile(text) {
    if (new TextEncoder().encode(text).length > PATTERN_FILE_LIMIT) throw new Error('Pattern 檔案不得超過 1 MiB。');
    let file;
    try { file = JSON.parse(text.replace(/^\uFEFF/, '')); } catch { throw new Error('無法讀取 JSON，請選擇模鏡匯出的 pattern 檔案。'); }
    if (file?.format !== fileFormat || ![1,2,3].includes(file?.version)) throw new Error('不支援此 pattern 檔案格式或版本。');
    if (!Array.isArray(file.patterns) || !file.patterns.length || file.patterns.length > 50) throw new Error('檔案需包含 1 至 50 組 patterns。');
    return file.patterns.map((pattern, i) => {
        if (!pattern || typeof pattern.name !== 'string' || !pattern.name.trim() || pattern.name.length > 80 || (pattern.induced !== undefined && typeof pattern.induced !== 'boolean')) throw new Error(`第 ${i + 1} 組 pattern 的名稱或連線設定無效。`);
        if(file.version===1 && pattern.mode!==undefined)throw new Error('跨 block pattern 需要 version 2 檔案。');
        if(file.version<3 && pattern.nodes?.some(n=>n.conditions!==undefined))throw new Error('有條件的 pattern 需要 version 3 檔案。');
        try { return reusablePattern(pattern.name, pattern); } catch (error) { throw new Error(`第 ${i + 1} 組 pattern：${error.message}`); }
    });
}

function signature(pattern) {
    if(pattern.mode===CFG_PATTERN_MODE)return JSON.stringify({mode:pattern.mode,nodes:pattern.nodes.map(n=>JSON.stringify(n)).sort(),edges:pattern.edges.map(e=>JSON.stringify(e)).sort(),induced:pattern.induced});
    return JSON.stringify({ nodes: pattern.nodes.map((node) => [node.alias, operatorKey(node.type),node.conditions || []]).sort(), edges: pattern.edges.map((edge) => [edge.from, edge.to]).sort(), induced: pattern.induced });
}

export function planPatternImport(library, imported) {
    const next = library.map((pattern) => reusablePattern(pattern.name, pattern));
    let skipped = 0;
    let renamed = 0;
    const added = [];
    for (const item of imported) {
        let pattern = reusablePattern(item.name, item);
        const existing = next.find((entry) => entry.name === pattern.name);
        if (existing && signature(existing) === signature(pattern)) { skipped++; continue; }
        if (existing) {
            let suffix = 2;
            let name;
            let conflict;
            do {
                name = `${pattern.name.slice(0, 70)}（${suffix++}）`;
                conflict = next.find((entry) => entry.name === name);
                if (conflict && signature(conflict) === signature(pattern)) { skipped++; pattern = null; break; }
            } while (conflict);
            if (!pattern) continue;
            pattern.name = name; renamed++;
        }
        next.push(pattern); added.push(pattern);
    }
    if (next.length > 50) throw new Error(`匯入後共有 ${next.length} 組，超過 50 組上限；請改匯出所選 pattern。`);
    return { patterns: next, added, skipped, renamed };
}

export function importPatterns(storage, library, text) {
    const plan = planPatternImport(library, parsePatternFile(text));
    storage.setItem(PATTERN_LIBRARY_KEY, JSON.stringify(plan.patterns));
    return plan;
}
