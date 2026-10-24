import { test } from 'node:test';
import assert from 'node:assert/strict';
import { exportPatterns, parsePatternFile, importPatterns, planPatternImport, loadPatterns, savePattern, PATTERN_LIBRARY_KEY, PATTERN_FILE_LIMIT } from '../src/pattern-library.js';

const pattern = (name = 'LoRA 範例') => ({ name, nodes: ['Mul', 'FullyConnected', 'BatchMatMul', 'BatchMatMul', 'Add'].map((type, n) => ({ alias: `N${n + 1}`, type })), edges: [[1, 2], [1, 3], [3, 4], [2, 5], [4, 5]].map(([from, to]) => ({ from: `N${from}`, to: `N${to}` })), induced: true });
const memoryStorage = () => { const values = new Map(); return { getItem: (key) => values.get(key), setItem: (key, value) => values.set(key, value) }; };

test('export/import round trip preserves topology, multiple exits, and matching mode across storage', () => {
    const first = pattern();
    const exits = { ...pattern('雙出口'), nodes: first.nodes.slice(0, 4), edges: first.edges.filter((edge) => edge.to !== 'N5'), induced: false };
    const file = exportPatterns([{ ...first, modelName: 'private.tflite', tensors: [123], weights: [456] }, exits]);
    assert.equal(file.includes('private.tflite'), false); assert.equal(file.includes('weights'), false);
    const storage = memoryStorage();
    const plan = importPatterns(storage, [], '\uFEFF' + file);
    assert.equal(plan.added.length, 2);
    assert.deepEqual(loadPatterns(storage), [first, exits]);
    assert.deepEqual(parsePatternFile(file), [first, exits]);
});

test('import skips identical names and content, renames conflicts, and preserves existing patterns', () => {
    const existing = pattern();
    const different = { ...pattern(), induced: false };
    const plan = planPatternImport([existing], [existing, different]);
    assert.equal(plan.skipped, 1); assert.equal(plan.renamed, 1);
    assert.deepEqual(plan.patterns[0], existing);
    assert.equal(plan.patterns[1].name, 'LoRA 範例（2）');
    const again = planPatternImport(plan.patterns, [different]);
    assert.equal(again.added.length, 0); assert.equal(again.skipped, 1);
});

test('invalid files, unknown versions, disconnected or oversized patterns never modify stored data', () => {
    const storage = memoryStorage(); storage.setItem(PATTERN_LIBRARY_KEY, 'original');
    const bad = [
        '{', '{}', JSON.stringify({ format: 'model-lens-patterns', version: 99, patterns: [pattern()] }),
        exportPatterns([pattern()]).replace('"induced": true', '"induced": "true"'),
        JSON.stringify({ format: 'model-lens-patterns', version: 1, patterns: [{ ...pattern(), edges: [] }] }),
        JSON.stringify({ format: 'model-lens-patterns', version: 1, patterns: [{ ...pattern(), nodes: Array(33).fill({ alias: 'N', type: 'Mul' }) }] }),
        ' '.repeat(PATTERN_FILE_LIMIT + 1)
    ];
    for (const text of bad) {
        assert.throws(() => importPatterns(storage, [], text));
        assert.equal(storage.getItem(PATTERN_LIBRARY_KEY), 'original');
    }
    const full = Array.from({ length: 50 }, (_, n) => pattern(`Pattern ${n}`));
    assert.throws(() => importPatterns(storage, full, exportPatterns([pattern('新增')])), /50 組/);
    assert.equal(storage.getItem(PATTERN_LIBRARY_KEY), 'original');
});

test('storage write failure leaves the caller library unchanged', () => {
    const library = [pattern('既有')];
    assert.throws(() => importPatterns({ setItem() { throw new Error('quota'); } }, library, exportPatterns([pattern('新增')])));
    assert.deepEqual(library, [pattern('既有')]);
});

test('library upgrade reads legacy patterns and preserves the old storage independently',()=>{
    const storage=memoryStorage(),legacy=[pattern('舊 pattern')],raw=JSON.stringify(legacy);
    storage.setItem('model-lens.patterns.v1',raw);
    assert.deepEqual(loadPatterns(storage),legacy);
    const upgraded=savePattern(storage,loadPatterns(storage),pattern('新 pattern'));
    assert.deepEqual(loadPatterns(storage),upgraded);
    assert.equal(storage.getItem('model-lens.patterns.v1'),raw);
    storage.setItem('model-lens.patterns.v1','[]');
    assert.deepEqual(loadPatterns(storage),upgraded);
});
