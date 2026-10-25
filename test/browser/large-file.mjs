// Opt-in, real disk-backed File -> dedicated Worker -> UI acceptance. Never npm test.
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { execFileSync } from 'node:child_process';
import { readFile, writeFile, mkdtemp, rm, statfs, open, readdir, stat } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { once } from 'node:events';
import { makeLargeFixture } from '../make-large-fixture.mjs';
import { createStaticServer } from '../../scripts/serve.mjs';
import { conditionsWorkspaceAcceptance } from './large-workspace.mjs';

process.chdir(fileURLToPath(new URL('../../', import.meta.url)));
const MiB = 1024 ** 2;
const reportPath = path.resolve(process.env.LARGE_FILE_REPORT || 'test-results/large-file.json');
const { mkdir } = await import('node:fs/promises');
await mkdir(path.dirname(reportPath), { recursive: true });
const report = { status: 'failed', startedAt: new Date().toISOString(), checks: [], samples: [], limitations: [
    'Synthetic sparse zero weights, not a trained user model or cold-disk throughput benchmark.',
    'File APIs are observed and guarded at 1 MiB per call / 8 MiB per realm; guards stop unsafe regressions before allocation.',
    'RSS sums Chromium processes (shared pages may be counted more than once); sampled peaks can miss short spikes.',
    'Cancellation uses a test-only metadata response gate; successful loads use native FileReaderSync without delay.'
] };
let releaseGate, browserCDP, readPage;
let temporary, server, browser, context, sampleTimer, samplePending = Promise.resolve();
let sampling = false;
let chromiumRootPid;
let phase = 'startup';
const watchdog = setTimeout(async () => {
    report.status = 'failed'; report.error = `Hard timeout after 180s during ${phase}`;
    await writeFile(reportPath, JSON.stringify(report, null, 2) + '\n');
    console.error(report.error); process.exit(1);
}, 180000);
const errors = [];
const optionalRead = (file) => readFile(file, 'utf8').then((s) => s.trim()).catch(() => null);
const check = (name) => { report.checks.push(name); console.log(`PASS ${name}`); };

// Executed in both the page and real module worker; original File/Blob APIs do the reading.
function installReadAudit(worker = false) {
    const audit = { bytes: 0, calls: 0, maxRead: 0, violations: [], methods: {} };
    const publish = () => { if (worker) self.postMessage({ __largeFileAudit: audit }); };
    function record(blob, method) {
        audit.bytes += blob.size; audit.calls++; audit.maxRead = Math.max(audit.maxRead, blob.size);
        audit.methods[method] = (audit.methods[method] || 0) + 1;
        if (blob.size > 1024 ** 2 || audit.bytes > 8 * 1024 ** 2) {
            audit.violations.push(`${method}: ${blob.size} bytes; cumulative ${audit.bytes}`);
            publish(); throw new Error('Acceptance read budget exceeded');
        }
        publish();
    }
    for (const method of ['arrayBuffer', 'text', 'stream', 'bytes']) {
        const original = Blob.prototype[method];
        if (original) Blob.prototype[method] = function(...args) { record(this, `Blob.${method}`); return original.apply(this, args); };
    }
    for (const type of ['FileReader', 'FileReaderSync']) {
        if (!globalThis[type]) continue;
        for (const method of ['readAsArrayBuffer', 'readAsText', 'readAsDataURL', 'readAsBinaryString']) {
            const original = globalThis[type].prototype[method];
            if (original) globalThis[type].prototype[method] = function(blob, ...args) { record(blob, `${type}.${method}`); return original.call(this, blob, ...args); };
        }
    }
    if (!worker) {
        const state = globalThis.__largeFileAcceptance = { audit, workers: [], ticks: 0, maxGapMs: 0 };
        let last = performance.now();
        setInterval(() => { const now = performance.now(); state.maxGapMs = Math.max(state.maxGapMs, now - last); last = now; state.ticks++; }, 50);
        const NativeWorker = Worker;
        globalThis.Worker = class extends NativeWorker {
            constructor(...args) {
                super(...args);
                const entry = { url: String(args[0]), terminated: false };
                state.workers.push(entry);
                this.addEventListener('message', ({ data }) => {
                    if (data.__largeFileAudit) entry.audit = data.__largeFileAudit;
                    if (data.data?.stats) entry.stats = data.data.stats;
                });
                this.addEventListener('error', (event) => { entry.error = event.message; });
                this.__entry = entry;
            }
            terminate() { this.__entry.terminated = true; return super.terminate(); }
        };
    }
}
try {
    const disk = await statfs(os.tmpdir());
    const memoryLimit = await optionalRead('/sys/fs/cgroup/memory.max');
    const memoryCurrent = await optionalRead('/sys/fs/cgroup/memory.current');
    const available = memoryLimit && memoryLimit !== 'max' ? Number(memoryLimit) - Number(memoryCurrent) : os.freemem();
    report.environment = { platform: os.platform(), release: os.release(), osRelease: await optionalRead('/etc/os-release'), arch: os.arch(), node: process.version,
        playwright: JSON.parse(await readFile(new URL('../../node_modules/playwright/package.json', import.meta.url))).version,
        cpus: os.cpus().length, cpuQuota: await optionalRead('/sys/fs/cgroup/cpu.max'), memoryLimit, memoryCurrent,
        availableMemoryBytes: available, tempFreeBytes: disk.bavail * disk.bsize, shm: await optionalRead('/proc/mounts').then((s) => s?.split('\n').find((line) => line.includes(' /dev/shm '))),
        sourceCommit: process.env.GITHUB_SHA || execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
        sourceKind: process.env.GITHUB_ACTIONS === 'true' ? 'github-actions' : 'local-integration-snapshot',
        integrationBaseCommit: process.env.LARGE_FILE_BASE_COMMIT || null,
        sourceTree: execFileSync('git', ['write-tree'], { encoding: 'utf8' }).trim(),
        sourceDirty: Boolean(execFileSync('git', ['status', '--porcelain'], { encoding: 'utf8' }).trim()), headless: true };
    assert.ok(available >= 3 * 1024 ** 3, 'Need at least 3 GiB available memory');
    assert.ok(disk.bavail * disk.bsize >= 4 * 1024 ** 3, 'Need at least 4 GiB free temp disk (including non-sparse filesystems)');
    temporary = await mkdtemp(path.join(os.tmpdir(), 'model-lens-browser-'));
    report.fixture = makeLargeFixture(path.join(temporary, 'synthetic-1_25GiB.tflite'), { graphCount: 2, repeats: 1000 });
    const fixtureStat = await stat(report.fixture.file);
    report.fixture.allocatedBytes = fixtureStat.blocks * 512;
    assert.ok(report.fixture.bytes > 1024 ** 3);
    const badFile = path.join(temporary, 'invalid-1_25GiB.tflite');
    const invalid = await open(badFile, 'w');
    try { await invalid.write(Buffer.from('invalid TFLite')); await invalid.truncate(report.fixture.bytes); } finally { await invalid.close(); }
    execFileSync(process.execPath, ['scripts/build.mjs'], { stdio: 'inherit' });
    // Port 0 avoids conflicts with developer servers; only loopback is served.
    server = createStaticServer();
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    const url = `http://127.0.0.1:${server.address().port}`;
    browser = await chromium.launch({ headless: true, args: [`--model-lens-acceptance=${path.basename(temporary)}`], ...(process.env.CHROMIUM_EXECUTABLE_PATH ? { executablePath: process.env.CHROMIUM_EXECUTABLE_PATH } : {}) });
    browser.on('disconnected', () => errors.push('Browser disconnected unexpectedly'));
    report.environment.chromium = browser.version();
    context = await browser.newContext({ viewport: { width: 1440, height: 900 }, acceptDownloads: true });
    await context.addInitScript(installReadAudit);
    const page = await context.newPage();
    page.setDefaultTimeout(30000);
    page.on('crash', () => errors.push('Page crashed'));
    page.on('pageerror', (error) => errors.push(error.message));
    const network = [];
    await context.route('**/*', async (route) => {
        const request = route.request();
        network.push({ url: request.url(), method: request.method() });
        if (!request.url().startsWith(`${url}/`) || request.method() !== 'GET') {
            errors.push(`Unexpected network request: ${request.method()} ${request.url()}`); await route.abort(); return;
        }
        await route.continue();
    });
    await context.route('**/src/model-worker.js*', async (route) => {
        const response = await route.fetch();
        await route.fulfill({ response, body: `(${installReadAudit.toString()})(true);\n${await response.text()}` });
    });
    browserCDP = await browser.newBrowserCDPSession();
    const cdp = await context.newCDPSession(page);
    await cdp.send('Performance.enable');
    // Netron disables window.eval; CDP evaluates in the original page realm without changing it.
    readPage = async (fn) => {
        const result = await cdp.send('Runtime.evaluate', { expression: `(${fn.toString()})()`, returnByValue: true });
        if (result.exceptionDetails) throw new Error(result.exceptionDetails.text);
        return result.result.value;
    };
    async function waitFor(fn) {
        const deadline = Date.now() + 30000;
        while (!await readPage(fn)) {
            if (Date.now() > deadline) throw new Error(`Timed out: ${fn.toString()}`);
            await new Promise((resolve) => setTimeout(resolve, 100));
        }
    }
    async function sample() {
        // CDP PIDs can belong to a nested namespace. Locate only this launch's marked
        // browser in host /proc, then sum its descendants using host PPid values.
        let rssBytes = null;
        if (os.platform() === 'linux') {
            const ids = (await readdir('/proc')).filter((id) => /^\d+$/.test(id));
            const processes = (await Promise.all(ids.map(async (id) => {
                const text = await optionalRead(`/proc/${id}/status`);
                if (!text) return null;
                if (!chromiumRootPid) {
                    const cmd = await optionalRead(`/proc/${id}/cmdline`);
                    if (/\/(chrome|headless_shell)$/.test(cmd?.split('\0')[0] || '') && cmd.includes(`--model-lens-acceptance=${path.basename(temporary)}`)) chromiumRootPid = Number(id);
                }
                return { id: Number(id), parent: Number(text.match(/^PPid:\s+(\d+)/m)?.[1]), rss: Number(text.match(/^VmRSS:\s+(\d+)/m)?.[1] || 0) * 1024 };
            }))).filter(Boolean);
            assert.ok(chromiumRootPid, 'Cannot locate this Chromium launch in host /proc');
            const tree = new Set([chromiumRootPid]);
            for (let size = -1; size !== tree.size;) {
                size = tree.size;
                for (const item of processes) if (tree.has(item.parent)) tree.add(item.id);
            }
            rssBytes = processes.filter((item) => tree.has(item.id)).reduce((total, item) => total + item.rss, 0);
            assert.ok(rssBytes > 0, 'Chromium RSS measurement unavailable');
        }
        const { metrics } = await cdp.send('Performance.getMetrics');
        report.samples.push({ phase, elapsedMs: Date.now() - Date.parse(report.startedAt), rssBytes,
            mainHeapBytes: metrics.find((m) => m.name === 'JSHeapUsedSize')?.value });
    }
    await page.goto(url);
    await page.locator('#welcome-open').waitFor();
    await sample();
    sampleTimer = setInterval(() => {
        if (sampling) return;
        sampling = true;
        samplePending = sample().catch((e) => errors.push(`Memory sampler: ${e.message}`)).finally(() => { sampling = false; });
    }, 100);
    const selectFile = async (file) => {
        const chooserPromise = page.waitForEvent('filechooser');
        await page.locator('#open-model').click();
        await (await chooserPromise).setFiles(file); // Path, never a giant Node.js Buffer.
    };
    async function ready() {
        await waitFor(() => document.querySelector('#layer-count').textContent === '6,002' && document.querySelector('#loading-card').hidden);
        await waitFor(() => document.querySelector('#result-count').textContent === '3,001 筆結果');
    }
    phase = 'initial-load';
    const start = performance.now();
    await selectFile(report.fixture.file);
    await ready();
    report.initialLoadMs = performance.now() - start;
    report.metrics = await page.locator('#metrics').textContent();
    assert.equal(await readPage(() => document.querySelector('#model-file').files[0].size), report.fixture.bytes);
    assert.equal(await page.locator('#target .node').count(), 0, 'Large model must remain index-only');
    check('native file chooser, disk-backed >1 GiB File, worker index (6,002 operators), index-only UI');
    phase = 'interaction';
    await page.locator('#query').fill('#1500');
    await waitFor(() => document.querySelector('#result-count').textContent === '1 筆結果');
    await page.locator('.result-item').click();
    await waitFor(() => /局部圖 \d+ 個節點/.test(document.querySelector('#status').textContent));
    const nodes = await page.locator('#target .node').count();
    assert.ok(nodes > 0 && nodes <= 100, `Local graph nodes: ${nodes}`);
    check('exact layer search and bounded local SVG graph');
    await page.locator('[data-kind="patterns"]').click();
    await waitFor(() => document.querySelector('#result-count').textContent === '1,000 筆匹配路徑');
    await page.locator('#scope').selectOption('all');
    await waitFor(() => document.querySelector('#result-count').textContent === '2,000 筆匹配路徑');
    await page.locator('#next-page').click();
    await waitFor(() => document.querySelector('#page-label').textContent.startsWith('101–200'));
    await page.locator('.result-item').first().click();
    await waitFor(() => /局部圖 \d+ 個節點/.test(document.querySelector('#status').textContent));
    check('pattern search, both subgraphs, pagination and match highlighting');
    phase = 'conditions-workspace';
    await conditionsWorkspaceAcceptance({ page, readPage, waitFor, report, temporary, check });
    phase = 'interaction';
    await page.locator('[data-kind="tensors"]').click();
    await page.locator('#query').fill('unused_weights');
    await waitFor(() => document.querySelector('#result-count').textContent === '2 筆結果');
    await page.locator('.result-item').first().click();
    await page.locator('#tensor-summary').waitFor();
    check('lazy weight tensor metadata inspection');
    // Real small submodel download from the large source must remain usable.
    await page.locator('[data-kind="layers"]').click();
    await page.locator('#scope').selectOption('0');
    await page.locator('#query').fill('#1500');
    await waitFor(() => document.querySelector('#result-count').textContent === '1 筆結果');
    await page.locator('.result-item').click();
    await waitFor(() => /局部圖 \d+ 個節點/.test(document.querySelector('#status').textContent));
    await page.locator('#pick-pattern').click();
    await page.locator('[data-model-node]').first().click();
    const downloadPromise = page.waitForEvent('download');
    await page.locator('#export-submodel').click();
    const download = await downloadPromise;
    assert.equal(await download.failure(), null);
    const exported = path.join(temporary, 'exported.tflite');
    await download.saveAs(exported);
    check('submodel download from large source');
    await page.locator('#close-model').click();
    await page.locator('[data-kind="layers"]').click();
    phase = 'cancel';
    let enteredGate;
    const gate = new Promise((resolve) => { releaseGate = resolve; });
    const entered = new Promise((resolve) => { enteredGate = resolve; });
    const gateHandler = async (route) => { enteredGate(); await gate; await route.continue().catch(() => {}); };
    await context.route('**/tflite-metadata.json', gateHandler);
    await selectFile(report.fixture.file);
    await Promise.race([entered, new Promise((_, reject) => { const timer = setTimeout(() => reject(new Error('Cancel gate not reached')), 10000); timer.unref(); })]);
    const cancelledWorker = page.workers().find((w) => new URL(w.url()).pathname.endsWith('/model-worker.js'));
    assert.ok(cancelledWorker);
    const closed = Promise.race([once(cancelledWorker, 'close'), new Promise((_, reject) => { const timer = setTimeout(() => reject(new Error('Worker did not terminate')), 10000); timer.unref(); })]);
    await page.locator('#cancel-load').click();
    await closed;
    releaseGate();
    await context.unroute('**/tflite-metadata.json', gateHandler);
    assert.equal(await page.locator('#file-name').textContent(), '尚未開啟模型');
    await page.locator('#welcome-open').waitFor();
    check('cancel pending real worker open, worker termination and UI reset (metadata gate)');
    phase = 'invalid-file';
    await selectFile(badFile);
    await waitFor(() => document.querySelector('#status').textContent === '載入失敗，請重新選擇檔案。');
    assert.match(await page.locator('#notice-text').textContent(), /無法開啟模型/);
    check('invalid >1 GiB file reports an error and resets controls');
    phase = 'recovery';
    const recoveryStart = performance.now();
    await selectFile(report.fixture.file);
    await ready();
    report.recoveryLoadMs = performance.now() - recoveryStart;
    await page.locator('#query').fill('#0');
    await waitFor(() => document.querySelector('#result-count').textContent === '1 筆結果');
    await page.locator('.result-item').click();
    await waitFor(() => /局部圖 \d+ 個節點/.test(document.querySelector('#status').textContent));
    check('same-page large-file reload and search/graph recovery after cancellation and error');
    await page.locator('#close-model').click();
    await selectFile(exported);
    await waitFor(() => document.querySelector('#layer-count').textContent === '1' && document.querySelector('#loading-card').hidden);
    check('downloaded submodel reopens through File API');
    // Check format switching on the integrated UI, without claiming full MLIR
    // browser coverage or using the TFLite performance numbers for MLIR.
    phase = 'mlir-smoke';
    await selectFile(path.resolve('dist/demo.mlir'));
    await waitFor(() => document.querySelector('#loading-card').hidden && !document.querySelector('#mlir-info').hidden && document.querySelectorAll('#target .node').length > 0);
    assert.equal(await page.locator('#value-kind-label').textContent(), 'SSA Values');
    assert.equal(await page.locator('#export-submodel').textContent(), '匯出局部 MLIR');
    await page.locator('#query').fill('#0');
    await waitFor(() => document.querySelector('#result-count').textContent === '1 筆結果');
    await page.locator('.result-item').click();
    await waitFor(() => document.querySelector('#target').getAttribute('aria-busy') === 'false');
    check('MLIR format switch, indexed search and rendered graph smoke after large TFLite');
    await sample();
    clearInterval(sampleTimer); sampleTimer = null; await samplePending;
    report.audit = await readPage(() => globalThis.__largeFileAcceptance);
    report.network = network;
    const realms = [...(report.auditHistory || []), report.audit];
    const workers = realms.flatMap((realm) => realm.workers);
    const audits = realms.flatMap((realm) => [realm.audit, ...realm.workers.map((w) => w.audit).filter(Boolean)]);
    assert.equal(workers.filter((w) => w.stats?.fileBytes > 1024 ** 3).length, 6);
    for (const audit of audits) {
        assert.deepEqual(audit.violations, []);
        assert.ok(audit.maxRead <= MiB && audit.bytes <= 8 * MiB);
    }
    assert.ok(workers.some((w) => w.audit?.methods['FileReaderSync.readAsArrayBuffer'] > 0));
    for (const worker of workers) {
        assert.equal(worker.error, undefined, 'Unhandled worker error');
        if (worker.stats) assert.equal(worker.audit.bytes, worker.stats.bytesRead, 'Native File reads must agree with range-reader stats');
    }
    const modelWorkers = workers.filter(w => new URL(w.url).pathname.endsWith('/model-worker.js'));
    assert.ok(modelWorkers.slice(0, -1).every(w => w.terminated), 'Every replaced model worker must terminate');
    assert.equal(modelWorkers.at(-1).terminated, false, 'Current model worker remains live');
    assert.ok(realms.reduce((n, realm) => n + realm.ticks, 0) >= 5);
    for (const realm of realms) assert.ok(realm.maxGapMs < 2000, `Page heartbeat stalled: ${realm.maxGapMs}ms`);
    assert.deepEqual(errors, []);
    report.memory = { baselineRssBytes: report.samples[0].rssBytes, peakRssBytes: Math.max(...report.samples.map((s) => s.rssBytes)),
        peakMainHeapBytes: Math.max(...report.samples.map((s) => s.mainHeapBytes)), sampleIntervalMs: 100, rssGrowthBudgetBytes: 768 * MiB };
    report.memory.rssGrowthBytes = report.memory.peakRssBytes - report.memory.baselineRssBytes;
    if (os.platform() === 'linux') assert.ok(report.memory.rssGrowthBytes < report.memory.rssGrowthBudgetBytes, 'Chromium RSS growth exceeded 768 MiB');
    else report.limitations.push('Process RSS assertion unavailable off Linux; main-thread heap metrics only.');
    check('bounded native reads, heartbeat, no crash/page errors/uploads, sampled memory budget');
    report.status = 'passed';
} catch (error) {
    report.error = error.stack || String(error);
    if (readPage) report.audit = await readPage(() => globalThis.__largeFileAcceptance).catch(() => null);
    console.error(report.error);
    process.exitCode = 1;
} finally {
    releaseGate?.();
    if (sampleTimer) clearInterval(sampleTimer);
    await samplePending;
    report.errors = errors;
    if (context) await context.close().catch(() => {});
    await writeFile(reportPath, JSON.stringify(report, null, 2) + '\n');
    if (browser) {
        browser.removeAllListeners('disconnected');
        let closeTimer;
        try {
            await Promise.race([
                (async () => { await browserCDP?.send('Browser.close').catch(() => {}); await browser.close(); })(),
                new Promise((resolve) => { closeTimer = setTimeout(() => {
                    report.limitations.push('Browser.close process reaping timed out after protocol shutdown (host process wrapper).'); resolve();
                }, 5000); })
            ]);
        } catch (error) { report.limitations.push(`Browser cleanup: ${error.message}`); }
        finally { clearTimeout(closeTimer); }
    }
    if (server) { server.closeAllConnections(); await new Promise((resolve) => server.close(resolve)); }
    if (temporary) await rm(temporary, { recursive: true, force: true });
    report.finishedAt = new Date().toISOString();
    await writeFile(reportPath, JSON.stringify(report, null, 2) + '\n');
    console.log(`Report: ${reportPath} (${report.status})`);
    clearTimeout(watchdog);
    process.exit(process.exitCode || 0);
}
