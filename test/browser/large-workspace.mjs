// Part of the opt-in large-file runner only. All changes go through visible UI;
// CDP is read-only observation, never application state injection.
import assert from 'node:assert/strict';
import { readFile, open } from 'node:fs/promises';
import path from 'node:path';
import { once } from 'node:events';
import { fixture } from '../fixture.mjs';
import { BinaryReader } from '../../vendor/netron/flatbuffers.js';

export async function conditionsWorkspaceAcceptance({ page, readPage, waitFor, report, temporary, check }) {
    const expectCount = async (count) => {
        const expected = `${count.toLocaleString('en-US')} 筆匹配路徑`;
        const deadline = Date.now() + 30000;
        while (await page.locator('#result-count').textContent() !== expected) {
            assert.ok(Date.now() < deadline, `Expected ${expected}`);
            await new Promise(resolve => setTimeout(resolve, 100));
        }
    };
    const drawReady = () => waitFor(() => document.querySelector('#target').getAttribute('aria-busy') === 'false' && document.querySelectorAll('#target .node').length > 0);
    // Laptop layout hides the old primary button. Exercise the visible control.
    const run = async (count) => { await page.getByRole('button', { name: '尋找模式', exact: true }).filter({ visible: true }).click(); await expectCount(count); };
    const chooser = async (button, file) => {
        const pending = page.waitForEvent('filechooser');
        await page.locator(button).click(); await (await pending).setFiles(file);
    };
    const download = async (button, name) => {
        const pending = page.waitForEvent('download'); await page.locator(button).click();
        const value = await pending; assert.equal(await value.failure(), null);
        const file = path.join(temporary, name); await value.saveAs(file);
        return { file, json: JSON.parse(await readFile(file, 'utf8')) };
    };
    const workerBytes = () => readPage(() => globalThis.__largeFileAcceptance.workers.at(-1).audit.bytes);
    const condition = async (kind, value, port = 0) => {
        await page.locator('#condition-node').selectOption('N2');
        await page.locator('#condition-kind').selectOption(kind);
        if (kind === 'attribute') await page.locator('#condition-attribute-name').fill('missing_attribute');
        else { await page.locator('#condition-side').selectOption('output'); await page.locator('#condition-port').fill(String(port)); }
        await page.locator('#condition-value').fill(value); await page.locator('#add-condition').click();
    };
    const removeLast = () => page.locator('#condition-list button').last().click();
    const before = await workerBytes();
    await page.locator('#condition-summary').click();
    await condition('shape', '1, *'); await condition('dtype', 'float32'); await run(2000);
    assert.equal(await page.locator('.result-item').count(), 100);
    await page.locator('#next-page').click();
    await waitFor(() => document.querySelector('#page-label').textContent.startsWith('101–200'));
    await page.locator('.result-item').first().click(); await drawReady();
    assert.match(await page.locator('.result-item.active').textContent(), /子圖 0/);
    assert.ok(await page.locator('#target .node').count() <= 100);
    check('large File metadata shape/dtype AND search, exact count, pagination and bounded matching SVG');

    await condition('dtype', 'int8'); await run(0);
    assert.equal(await page.locator('.result-item').count(), 0);
    await removeLast(); await run(2000);
    await condition('shape', '2, *'); await run(0); await removeLast(); await run(2000);
    await condition('dtype', 'float32', 1); await run(0); await removeLast(); await run(2000);
    await condition('attribute', 'absent'); await run(0); await removeLast(); await run(2000);
    assert.equal(await workerBytes(), before, 'Metadata condition searches must not read weights');
    check('condition changes and explicit re-search reject dtype/shape/absent-port/attribute and recover matches without file reads');

    await page.locator('#condition-pattern-name').fill('Large metadata acceptance');
    await page.locator('#save-edited-pattern').click(); await expectCount(2000);
    const library = await download('#export-pattern', 'conditional-pattern.json');
    assert.equal(library.json.version, 3);
    const expectedRules = [{ kind: 'shape', side: 'output', port: 0, value: [1, null] }, { kind: 'dtype', side: 'output', port: 0, value: 'float32' }];
    assert.deepEqual(library.json.patterns[0].nodes.find(n => n.alias === 'N2').conditions, expectedRules);
    await page.locator('#reset-pattern').click(); await expectCount(2000);
    assert.equal(await page.locator('#condition-list button').count(), 0);
    await page.locator('#open-import').click(); await chooser('#choose-pattern-file', library.file);
    await waitFor(() => document.querySelector('#import-preview').textContent.includes('略過 1 組重複'));
    await page.locator('#confirm-import').click();
    await page.locator('#saved-pattern').selectOption('Large metadata acceptance'); await expectCount(2000);
    assert.equal(await page.locator('#condition-list button').count(), 2);
    assert.equal(await workerBytes(), before);
    check('conditional pattern library save, version 3 JSON download/import and condition reapplication');

    await page.locator('#next-page').click();
    await waitFor(() => document.querySelector('#page-label').textContent.startsWith('101–200'));
    await page.locator('.result-item').first().click(); await drawReady();
    await page.locator('#graph-font-size').selectOption('32'); await drawReady();
    await page.locator('#explorer-resize').press('Home');
    await page.locator('#explorer-resize').press('Shift+ArrowRight');
    await page.locator('#zoom-out').click(); await page.locator('#zoom-out').click();
    await page.locator('#pick-pattern').click();
    await page.locator('[data-model-node]').nth(0).click();
    await page.locator('[data-model-node]').nth(1).click();
    const saved = await download('#save-workspace', 'svg-workspace.json');
    const state = saved.json.state;
    assert.equal(saved.json.format, 'model-lens-workspace');
    assert.equal(saved.json.identity.bytes, report.fixture.bytes);
    assert.match(saved.json.identity.signature, /^[a-f0-9]{64}$/);
    assert.equal(state.activeIndex, 100); assert.equal(state.scope, 'all'); assert.equal(state.kind, 'patterns');
    assert.deepEqual(JSON.parse(state.resultKey)[4], [300, 301, 302]);
    assert.deepEqual(state.pattern.nodes.find(n => n.alias === 'N2').conditions, expectedRules);
    assert.equal(state.camera.kind, 'svg'); assert.ok(state.camera.candidates.length > 0);
    assert.equal(state.font, '32'); assert.equal(state.sidebarWidth, 320);
    assert.equal(state.selections[0].nodes.length, 2); assert.equal(state.picking, true);
    assert.equal(await workerBytes(), before, 'Fingerprint and JSON save must use metadata only');
    report.workspace = { identity: saved.json.identity, state, jsonBytes: (await readFile(saved.file)).length, searchExtraReadBytes: 0, restores: [] };

    async function closeModel() {
        const worker = page.workers().find(w => new URL(w.url()).pathname.endsWith('/model-worker.js'));
        assert.ok(worker);
        const closed = once(worker, 'close'); await page.locator('#close-model').click(); await closed;
    }
    async function restored(label) {
        await waitFor(() => document.querySelector('#status').textContent.startsWith('已恢復工作階段：'));
        await expectCount(2000); await drawReady();
        assert.equal(await page.locator('#graph-font-size').inputValue(), '32');
        assert.equal(await page.locator('#condition-list button').count(), 2);
        assert.equal(await page.locator('#target .pattern-picked').count(), 2);
        assert.equal(await page.locator('.result-item.active').getAttribute('data-result-index'), '100');
        const bytes = await workerBytes();
        const roundtrip = await download('#save-workspace', `restored-${label}.json`);
        for (const key of ['kind', 'query', 'scope', 'graph', 'view', 'activeIndex', 'resultKey', 'pattern', 'font', 'direction', 'sidebarWidth', 'selections', 'picking']) assert.deepEqual(roundtrip.json.state[key], state[key], `Restored ${key}`);
        const camera = roundtrip.json.state.camera;
        assert.equal(camera.zoom, state.camera.zoom);
        const anchor = state.camera.candidates[0], actual = camera.candidates.find(c => c.id === anchor.id);
        assert.ok(actual, 'Saved SVG anchor survives');
        const target = await page.locator('#target').boundingBox();
        const clamp = (v, size) => Math.min(Math.max(v, Math.min(48, size / 2)), Math.max(size - 48, size / 2));
        assert.ok(Math.abs(actual.x - clamp(anchor.x, target.width)) < 3 && Math.abs(actual.y - clamp(anchor.y, target.height)) < 3, 'SVG anchor restored within 3px');
        assert.equal(await workerBytes(), bytes, 'Restored fingerprint must not read weights');
        report.workspace.restores.push({ label, workerReadBytes: bytes, camera, selections: roundtrip.json.state.selections });
    }
    await closeModel();
    await chooser('#open-workspace', saved.file);
    await page.locator('#choose-workspace-model').waitFor();
    await chooser('#choose-workspace-model', report.fixture.file); await restored('file');
    check('downloaded workspace JSON reselects native large File and restores conditions, exact match, selections and SVG camera');

    await closeModel();
    report.auditHistory = [await readPage(() => globalThis.__largeFileAcceptance)];
    await page.reload(); await page.locator('#welcome-open').waitFor();
    assert.equal(await page.locator('#last-workspace').isEnabled(), true);
    await page.locator('[data-kind="patterns"]').click();
    await page.locator('#saved-pattern').selectOption('Large metadata acceptance');
    assert.equal(await page.locator('#condition-list button').count(), 2, 'Conditional library survives reload independently of workspace restore');
    await chooser('#last-workspace', report.fixture.file); await restored('local-storage');
    check('page reload preserves conditional library and last-saved workspace; native model reselection restores SVG state');

    // Same byte length defeats size-only validation: change one tensor dtype
    // in the metadata header, retaining a valid model and sparse payload.
    const different = fixture({ graphCount: 2, repeats: 1000, weightBytes: 1342177280 });
    const header = Buffer.from(different.data), reader = BinaryReader.open(header);
    const positions = { decode: (_reader, position) => position };
    const graph = reader.tables(reader.root, 8, positions)[0];
    const tensor = reader.tables(graph, 4, positions)[2];
    const typeOffset = reader.__offset(tensor, 6); assert.ok(typeOffset > 0);
    assert.equal(header[tensor + typeOffset], 0); // FLOAT32 -> INT8
    header[tensor + typeOffset] = 9;
    const mismatch = path.join(temporary, 'same-size-different-structure.tflite');
    const handle = await open(mismatch, 'w');
    try { await handle.write(header); await handle.truncate(different.totalBytes); } finally { await handle.close(); }
    assert.equal(different.totalBytes, report.fixture.bytes);
    await closeModel(); await chooser('#open-workspace', saved.file);
    await page.locator('#choose-workspace-model').waitFor(); await chooser('#choose-workspace-model', mismatch);
    await waitFor(() => document.querySelector('#loading-card').hidden && document.querySelector('#notice-text').textContent.includes('模型結構或檔案大小與工作階段不符'));
    assert.equal(await page.locator('#layer-count').textContent(), '6,002');
    assert.equal(await page.locator('#target .pattern-picked').count(), 0);
    assert.equal(await page.locator('#pick-pattern').getAttribute('aria-pressed'), 'false');
    assert.equal(await page.locator('#workspace-hint').isHidden(), true);
    check('same-size valid large model with different structural fingerprint rejects saved selections');
    await chooser('#open-workspace', saved.file); await page.locator('#choose-workspace-model').waitFor();
    await chooser('#choose-workspace-model', report.fixture.file); await restored('after-mismatch');
    check('original large model restores correctly after a rejected workspace model');
    // Leave a neutral UI for the existing tensor/export/cancellation coverage.
    await page.locator('#clear-capture').click();
    await page.locator('#cancel-capture').click();
    await page.locator('#reset-pattern').click(); await expectCount(2000);
}
