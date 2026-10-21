import { Host } from '../vendor/netron/browser.js';
import { View, Attachment } from '../vendor/netron/view.js';
import { hydrate } from './hydrate.js';
import { LORA_PATTERN } from './pattern-utils.js';

const $ = (id) => document.getElementById(id);
const element = (tag, className, text) => { const node = document.createElement(tag); if (className) node.className = className; if (text !== undefined) node.textContent = text; return node; };
const size = (bytes) => bytes >= 1073741824 ? `${(bytes / 1073741824).toFixed(2)} GiB` : `${(bytes / 1048576).toFixed(2)} MiB`;
const formatValue = (value) => typeof value === 'bigint' ? String(value) : Array.isArray(value) || ArrayBuffer.isView(value) ? `[${Array.from(value).map(String).join(', ')}]` : String(value);
const host = new Host();
host._environment.menu = false;
host.view = async (view) => { host._view = view; };
host.start = async () => host._view.show('welcome');
host.event = () => {};
host.exception = (error) => console.error(error);
host.asset = async (file) => {
    if (!/^[\w.-]+$/.test(file)) throw new Error('無效的資源名稱。');
    const response = await fetch(new URL(`../vendor/netron/${file}`, import.meta.url));
    if (!response.ok) throw new Error(`無法讀取 ${file}`);
    return response.text();
};
host.worker = (id) => new Worker(new URL(`../vendor/netron/${id}.js`, import.meta.url), { type: 'module' });
let layoutNotice = false;
host.message = async (message, alert, action) => {
    if (!message) {
        if (layoutNotice) { $('notice').hidden = true; $('notice-action').hidden = true; layoutNotice = false; }
        return 0;
    }
    if (action === 'Cancel') {
        layoutNotice = true; notice('完整圖仍在計算中；可取消繪圖後使用局部圖。');
        $('notice-action').hidden = false;
        return new Promise((resolve) => { $('notice-action').onclick = () => { $('notice').hidden = true; $('notice-action').hidden = true; layoutNotice = false; resolve(0); }; });
    }
    notice(message); return 0;
};
const view = new View(host);
view.options.weights = false;
view.options.mousewheel = 'zoom';
view.error = async (error) => { notice(error.message || String(error)); view.show(null); };
const originalNodeProperties = view.showNodeProperties.bind(view);
view.showNodeProperties = (node, source) => { $('tensor-summary').hidden = true; originalNodeProperties(node, source); };
const originalTensorProperties = view.showTensorProperties.bind(view);
const originalConnectionProperties = view.showConnectionProperties.bind(view);
view.showTensorProperties = (argument, source) => {
    const value = argument.value?.[0] || argument;
    tensorSummary(value);
    if (value.initializer && (value.initializer._data?.length || 0) <= 16 * 1024 * 1024) {
        originalTensorProperties(argument.value ? argument : { name: value.name, value: [value] }, source);
    } else {
        originalConnectionProperties(value, null, [], source);
        $('sidebar-title').textContent = 'Tensor 詳細資料';
    }
};
view.showConnectionProperties = (value, from, to, source) => { tensorSummary(value); originalConnectionProperties(value, from, to, source); };

let worker;
let requestId = 0;
let pending = new Map();
let model;
let file;
let kind = 'layers';
let operators = ['Reshape', 'Transpose', 'Reshape'];
let graphNodes = [];
let graphEdges = [];
let graphNodeNumber = 5;
function loraPreset() {
    graphNodes = ['Mul', 'FullyConnected', 'BatchMatMul', 'BatchMatMul', 'Add'].map((type, i) => ({ alias: `N${i + 1}`, type }));
    graphEdges = [[1, 2], [1, 3], [3, 4], [2, 5], [4, 5]].map(([from, to]) => ({ from: `N${from}`, to: `N${to}` }));
    graphNodeNumber = 5;
}
loraPreset();
let page = { items: [], total: 0, offset: 0 };
let activeIndex = -1;
let selection;
let currentGraph = 0;
let full = false;
let queryGeneration = 0;
let renderGeneration = 0;
let renderQueue = Promise.resolve();
let fullConfirmed = false;
let timer;

function notice(text) { $('notice-text').textContent = text; $('notice').hidden = false; }
function status(text) { $('status').textContent = text; }
function stopWorker() {
    worker?.terminate(); worker = null;
    for (const { reject } of pending.values()) reject(new DOMException('已取消', 'AbortError'));
    pending.clear();
}
function rpc(action, args = {}) {
    return new Promise((resolve, reject) => {
        if (!worker) { reject(new Error('請先開啟模型。')); return; }
        const id = ++requestId;
        pending.set(id, { resolve, reject });
        worker.postMessage({ id, action, args });
    });
}
function createWorker() {
    worker = new Worker(new URL('./model-worker.js', import.meta.url), { type: 'module' });
    worker.onmessage = ({ data }) => {
        if (data.stage) { $('loading-stage').textContent = data.stage; status(data.stage); return; }
        const entry = pending.get(data.id);
        if (!entry) return;
        pending.delete(data.id);
        if (data.error) entry.reject(new Error(data.error)); else entry.resolve(data.data);
    };
    worker.onerror = (event) => { const error = new Error(event.message || '背景解析失敗。'); for (const entry of pending.values()) entry.reject(error); pending.clear(); };
}
function reset() {
    ++queryGeneration; ++renderGeneration;
    stopWorker(); model = null; file = null; selection = null; activeIndex = -1;
    full = false; fullConfirmed = false; currentGraph = 0;
    view._sidebar.close(); view.target = null; view.model = null; view._path = [];
    $('target').replaceChildren(); view.show('welcome');
    $('target').setAttribute('aria-busy', 'false');
    $('empty-state').hidden = false; $('loading-card').hidden = true;
    $('cancel-load').hidden = true; $('close-model').hidden = true;
    $('file-name').textContent = '尚未開啟模型'; $('file-stats').textContent = '從模型結構，找到你要的連接。';
    $('layer-count').textContent = '—'; $('tensor-count').textContent = '—';
    $('query').value = ''; $('query').disabled = true; $('scope').replaceChildren(new Option('所有 subgraphs', 'all')); $('scope').disabled = true;
    $('graph-select').replaceChildren(new Option('模型圖', '0')); $('tensor-summary').hidden = true;
    $('graph-caption').textContent = '選取結果以查看連接'; $('metrics').textContent = 'LOCAL FILE · NO UPLOAD';
    $('full-graph').textContent = '完整圖'; $('notice').hidden = true;
    for (const id of ['graph-select', 'add-operator', 'run-pattern', 'local-graph', 'full-graph', 'zoom-in', 'zoom-out', 'zoom-reset', 'direction', 'previous-result', 'next-result']) $(id).disabled = true;
    showPage({ items: [], total: 0, offset: 0 });
    status('準備就緒');
}
async function openFile(nextFile) {
    reset(); file = nextFile;
    const thisFile = file;
    $('file-name').textContent = file.name; $('file-stats').textContent = `${size(file.size)} · 建立索引中`;
    $('empty-state').hidden = true; $('loading-card').hidden = false; $('cancel-load').hidden = false;
    $('loading-stage').textContent = '讀取模型結構';
    createWorker();
    try {
        const summary = await rpc('open', { file });
        if (file !== thisFile) return;
        model = summary;
        const layers = model.graphs.reduce((n, g) => n + g.layers, 0);
        const tensors = model.graphs.reduce((n, g) => n + g.tensors, 0);
        $('layer-count').textContent = layers.toLocaleString(); $('tensor-count').textContent = tensors.toLocaleString();
        $('file-stats').textContent = `${size(file.size)} · ${layers.toLocaleString()} layers · ${model.graphs.length} subgraphs`;
        $('metrics').textContent = `讀取總量 ${size(model.stats.bytesRead)} · 檔案 ${size(file.size)} · 解析 ${(model.stats.parseMs / 1000).toFixed(2)}s`;
        $('scope').replaceChildren(new Option('所有 subgraphs', 'all'), ...model.graphs.map((g) => new Option(`${g.name} · ${g.layers} layers`, String(g.index))));
        $('graph-select').replaceChildren(...model.graphs.map((g) => new Option(g.name, String(g.index))));
        for (const id of ['query', 'scope', 'graph-select', 'add-operator', 'run-pattern', 'local-graph', 'full-graph', 'zoom-in', 'zoom-out', 'zoom-reset', 'direction']) $(id).disabled = false;
        $('cancel-load').hidden = true; $('close-model').hidden = false;
        renderPattern();
        await runSearch();
        if (file.size < 1024 * 1024 * 1024 && layers <= 500 && model.graphs.length) await drawGraph(0, true);
        else {
            view.show(null);
            $('graph-caption').textContent = '索引已就緒 · 選取結果以繪製局部圖';
            status('索引已就緒。請搜尋或選取 layer／tensor，模型圖依需求繪製。');
        }
    } catch (error) {
        if (error.name !== 'AbortError') {
            reset(); notice(`無法開啟模型：${error.message}`); status('載入失敗，請重新選擇檔案。');
        }
    } finally { if (file === thisFile) { $('loading-card').hidden = true; $('cancel-load').hidden = true; } }
}
function setKind(nextKind) {
    kind = nextKind;
    document.querySelectorAll('[data-kind]').forEach((button) => button.setAttribute('aria-selected', String(button.dataset.kind === kind)));
    $('text-search').hidden = kind === 'patterns'; $('pattern-editor').hidden = kind !== 'patterns';
    renderPattern(); if (model) runSearch().catch(report);
}
function renderPattern() {
    renderVisualPattern();
    const rows = operators.map((operator, index) => {
        const row = element('div', 'pattern-row');
        row.append(element('span', 'pattern-step', String(index + 1).padStart(2, '0')));
        const select = element('select'); select.setAttribute('aria-label', `第 ${index + 1} 個 operator`);
        const choices = [...new Set([...(model?.operators || []), operator])].sort();
        select.replaceChildren(...choices.map((value) => new Option(value, value, false, value === operator)));
        select.disabled = !model;
        select.onchange = () => { operators[index] = select.value; };
        row.append(select);
        for (const [label, title, offset] of [['↑', '往前移', -1], ['↓', '往後移', 1], ['×', '移除', 0]]) {
            const button = element('button', 'icon-button', label); button.title = title; button.setAttribute('aria-label', `${title}第 ${index + 1} 個 operator`);
            button.disabled = !model || (offset ? index + offset < 0 || index + offset >= operators.length : operators.length === 1);
            button.onclick = () => { if (offset) [operators[index], operators[index + offset]] = [operators[index + offset], operators[index]]; else operators.splice(index, 1); renderPattern(); };
            row.append(button);
        }
        return row;
    });
    $('pattern-rows').replaceChildren(...rows);
}
async function runSearch() {
    if (!model) return;
    const generation = ++queryGeneration;
    activeIndex = -1;
    status(kind === 'patterns' ? '搜尋連接模式中…' : '搜尋中…');
    $('result-count').textContent = '搜尋中…';
    const graphPattern = kind === 'patterns' && $('pattern-mode').value === 'graph';
    const structure = graphPattern && $('graph-input-mode').value === 'visual' ? { nodes: graphNodes.map((n) => ({...n})), edges: graphEdges.map((e) => ({...e})) } : null;
    const result = await rpc(kind === 'patterns' ? graphPattern ? 'subgraphPattern' : 'pattern' : 'search', kind === 'patterns' ? { operators: [...operators], text: $('graph-pattern').value, structure, scope: $('scope').value } : { kind, query: $('query').value, scope: $('scope').value });
    if (generation !== queryGeneration || result.cancelled) return;
    if (result.decodedNodes) {
        const missing = result.decodedNodes.filter((node) => !node.present);
        $('pattern-decoded').textContent = '解讀：' + result.decodedNodes.map((node) => `${node.alias}:${node.type}`).join(' · ') + (missing.length ? `。模型中沒有：${[...new Set(missing.map((node) => node.type))].join('、')}` : '');
        $('pattern-decoded').classList.toggle('missing', missing.length > 0);
    }
    showPage(result);
    if (structure && result.total) $('visual-pattern-editor').open = false;
    if (result.searchLimited) notice('搜尋已達計算上限，結果可能不完整；請指定 subgraph 或加入更明確的 operator 限制。');
    status(`找到 ${result.total.toLocaleString()} 筆${kind === 'patterns' ? '路徑' : '結果'}${result.truncated ? '（已達 50,000 筆上限，請縮小範圍）' : ''}`);
}
function showPage(result) {
    page = result;
    $('result-count').textContent = model ? `${result.truncated ? '至少 ' : ''}${result.total.toLocaleString()} 筆${kind === 'patterns' ? '匹配路徑' : '結果'}` : '等待開啟模型';
    const nodes = result.items.map((item, i) => {
        const button = element('button', 'result-item');
        button.title = item.label; button.dataset.resultIndex = String(result.offset + i);
        const top = element('div', 'result-top');
        top.append(element('span', 'result-index', item.patternType === 'graph' ? item.id : `#${item.id}`), element('span', 'result-title', item.label));
        const name = model.graphs[item.graph]?.name || `Subgraph ${item.graph}`;
        const info = kind === 'tensors' ? `${name} · ${item.dtype || '?'} [${item.shape.join(', ')}]` : `${name} · ${kind === 'layers' ? item.operator : `${item.path.length} 個 operators`}`;
        button.append(top, element('span', 'result-subtitle', info));
        button.onclick = () => selectResult(result.offset + i).catch(report);
        if (result.offset + i === activeIndex) button.classList.add('active');
        return button;
    });
    if (!nodes.length) {
        const empty = element('div', 'list-empty'); empty.append(element('span', '', '⌕'), element('p', '', model ? '沒有符合的結果' : '開啟模型後，從這裡開始探索。'), element('small', '', model ? '調整搜尋字詞、連接模式或 subgraph 範圍。' : '搜尋清單會保留在模型圖旁。')); nodes.push(empty);
    }
    $('results').replaceChildren(...nodes); $('results').scrollTop = 0;
    $('pagination').hidden = result.total <= 100;
    $('page-label').textContent = `${result.offset + 1}–${Math.min(result.offset + 100, result.total)} / ${result.total}`;
    $('previous-page').disabled = result.offset === 0; $('next-page').disabled = result.offset + 100 >= result.total;
    $('previous-result').disabled = result.total === 0; $('next-result').disabled = result.total === 0;
}
async function changePage(offset) {
    const generation = queryGeneration;
    const result = await rpc('page', { offset });
    if (generation === queryGeneration) showPage(result);
}
async function selectResult(index) {
    if (!model || !page.total) return;
    const generation = queryGeneration;
    if (index < page.offset || index >= page.offset + page.items.length) await changePage(Math.floor(index / 100) * 100);
    if (generation !== queryGeneration) return;
    const item = page.items[index - page.offset];
    if (!item) return;
    activeIndex = index; selection = item; full = false;
    document.querySelectorAll('[data-result-index]').forEach((button) => button.classList.toggle('active', Number(button.dataset.resultIndex) === index));
    document.querySelector(`[data-result-index="${index}"]`)?.scrollIntoView({ block: 'nearest' });
    currentGraph = item.graph; $('graph-select').value = String(currentGraph);
    const generationRender = ++renderGeneration;
    $('target').setAttribute('aria-busy', 'true');
    status('準備局部圖…');
    const dto = await rpc('select', { item, full: false });
    await queueDraw(dto, generationRender);
}
async function drawGraph(graph, whole = false) {
    if (!model) return;
    currentGraph = graph; full = whole; selection = null;
    const generation = ++renderGeneration;
    $('target').setAttribute('aria-busy', 'true');
    status(whole ? '繪製完整圖…' : '繪製局部圖…');
    const dto = await rpc('graph', { graph, full: whole });
    await queueDraw(dto, generation);
}
async function queueDraw(dto, generation) {
    renderQueue = renderQueue.catch(() => {}).then(async () => {
        if (generation !== renderGeneration || !model) return;
        const start = performance.now();
        hydrate(dto, file);
        const graph = dto.graph;
        const currentModel = { format: model.format, description: model.description, modules: [graph], metadata: [], attachment: new Attachment() };
        view._sidebar.close();
        // SVG text must be visible when Netron measures getBBox().
        view.show('default');
        await view._updateTarget(currentModel, [{ target: graph, signature: null }]);
        if (generation !== renderGeneration) return;
        $('empty-state').hidden = true;
        $('graph-caption').textContent = `${dto.full ? '完整圖' : '局部圖'} · ${graph.nodes.length} / ${dto.total} layers`;
        const selected = dto.selected.map((index) => graph.nodes.find((node) => node.identifier === String(index))).filter(Boolean);
        if (dto.detail) {
            const values = [...graph.inputs, ...graph.outputs, ...graph.nodes.flatMap((n) => [...n.inputs, ...n.outputs])].flatMap((arg) => arg.value);
            dto.detail = values.find((v) => v.identifier === dto.detail.identifier) || dto.detail;
            tensorSummary(dto.detail); view.showTensorProperties(dto.detail, 'sidebar');
        }
        else if (selected.length === 1) { $('tensor-summary').hidden = true; view.showNodeProperties(selected[0], 'sidebar'); }
        else $('tensor-summary').hidden = true;
        if (view.target && selected.length) {
            const values = dto.detail ? [dto.detail] : selected;
            const elements = view.target.select(values, 'explorer');
            // A tensor may feed extra branches. Select the rendered edge for
            // each matched pair, rather than all edges sharing that tensor.
            const connections = dto.item?.connections || dto.selected.slice(0, -1).map((n, i) => [n, dto.selected[i + 1]]);
            if (dto.item?.kind === 'patterns') for (const [fromId, toId] of connections) {
                const from = view.target._table.get(graph.nodes.find((node) => node.identifier === String(fromId)));
                const to = view.target._table.get(graph.nodes.find((node) => node.identifier === String(toId)));
                const edge = from && to ? view.target.edge(from.name, to.name)?.label : null;
                if (edge) { elements.push(...edge.select()); view.target._selection.add(edge); }
            }
            view.target.scrollTo(elements);
        }
        status(`${model.graphs[currentGraph].name} · ${dto.full ? '完整圖' : '局部圖'} ${graph.nodes.length} 個節點 · 繪圖 ${(performance.now() - start).toFixed(0)} ms${dto.detail && !graph.nodes.length ? ' · 此 tensor 沒有相連的 operator' : ''}`);
        $('local-graph').style.background = dto.full ? '' : '#e6eee2'; $('full-graph').style.background = dto.full ? '#e6eee2' : '';
    });
    try { await renderQueue; }
    finally { if (generation === renderGeneration) $('target').setAttribute('aria-busy', 'false'); }
}
function tensorSummary(value) {
    if (!value?.type) { $('tensor-summary').hidden = true; return; }
    const section = $('tensor-summary');
    const dl = element('dl');
    const add = (label, text) => { dl.append(element('dt', '', label), element('dd', '', text)); };
    add('Tensor 編號', `#${value.identifier}`); add('Shape', `[${value.type.shape?.dimensions?.join(', ') || ''}]`); add('Dtype', value.type.dataType);
    const q = value.quantization;
    if (q) for (const [label, key] of [['Scale', 'scale'], ['Zero point', 'offset'], ['維度', 'dimension'], ['Min', 'min'], ['Max', 'max']]) {
        if (q[key] !== undefined && (!(Array.isArray(q[key]) || ArrayBuffer.isView(q[key])) || q[key].length)) {
            const val = q[key]; const long = (Array.isArray(val) || ArrayBuffer.isView(val)) && val.length > 12;
            add(label, long ? `${formatValue(Array.from(val).slice(0, 12))} …（共 ${val.length} 項）` : formatValue(val));
        }
    } else add('量化', '無量化參數');
    section.replaceChildren(element('h3', '', value.name?.split('\n')[0] || `Tensor #${value.identifier}`), dl);
    if (q) {
        const button = element('button', 'text-button', '下載完整量化參數 ↓');
        button.onclick = () => host.export(`tensor-${value.identifier}-quantization.json`, new Blob([JSON.stringify(q, (_, v) => typeof v === 'bigint' ? v.toString() : ArrayBuffer.isView(v) ? Array.from(v) : v, 2)], { type: 'application/json' }));
        section.append(button);
    }
    section.hidden = false;
}
function report(error) { if (error.name !== 'AbortError') { $('target').setAttribute('aria-busy', 'false'); notice(error.message); status('操作未完成，請調整後重試。'); } }

for (const id of ['open-model', 'welcome-open']) $(id).onclick = () => { $('model-file').value = ''; $('model-file').click(); };
$('model-file').onchange = () => { if ($('model-file').files[0]) openFile($('model-file').files[0]); };
$('open-demo').onclick = async () => { try { const r = await fetch('./demo.tflite'); if (!r.ok) throw new Error('無法讀取示範模型。'); await openFile(new File([await r.blob()], '示範模型.tflite')); } catch (error) { report(error); } };
$('open-lora-demo').onclick = async () => {
    try {
        const r = await fetch('./lora-demo.tflite'); if (!r.ok) throw new Error('無法讀取 LoRA 結構示範。');
        loraPreset(); $('graph-input-mode').value = 'visual'; updateGraphInputMode();
        $('pattern-mode').value = 'graph'; updatePatternMode(); setKind('patterns');
        await openFile(new File([await r.blob()], 'LoRA 結構示範.tflite'));
    } catch (error) { report(error); }
};
$('cancel-load').onclick = reset; $('close-model').onclick = reset;
document.querySelectorAll('[data-kind]').forEach((button) => button.onclick = () => setKind(button.dataset.kind));
$('query').oninput = () => { clearTimeout(timer); timer = setTimeout(() => runSearch().catch(report), 180); };
$('scope').onchange = () => runSearch().catch(report);
$('run-pattern').onclick = () => runSearch().catch(report);
$('reset-pattern').onclick = () => { operators = ['Reshape', 'Transpose', 'Reshape']; loraPreset(); $('graph-pattern').value = LORA_PATTERN; renderPattern(); if (model) runSearch().catch(report); };
function renderVisualPattern() {
    const nodes = graphNodes.map((node) => {
        const row = element('div', 'graph-form-row'); row.append(element('span', 'graph-node-id', node.alias));
        const select = element('select'); select.setAttribute('aria-label', `節點 ${node.alias} 的 operator`);
        const types = [...new Set([...(model?.operators || ['Mul', 'FullyConnected', 'BatchMatMul', 'Add']), node.type])].sort();
        select.replaceChildren(...types.map((type) => new Option(type, type, false, type === node.type)));
        select.onchange = () => { node.type = select.value; renderVisualPattern(); };
        const remove = element('button', 'icon-button', '×'); remove.setAttribute('aria-label', `移除節點 ${node.alias}`); remove.disabled = graphNodes.length === 1;
        remove.onclick = () => { graphNodes = graphNodes.filter((n) => n !== node); graphEdges = graphEdges.filter((e) => e.from !== node.alias && e.to !== node.alias); renderVisualPattern(); };
        row.append(select, remove); return row;
    });
    $('graph-node-rows').replaceChildren(...nodes);
    $('graph-edge-rows').replaceChildren(...graphEdges.map((edge, index) => {
        const row = element('div', 'graph-form-row');
        for (const key of ['from', 'to']) {
            const select = element('select'); select.setAttribute('aria-label', `連線 ${index + 1} 的${key === 'from' ? '起點' : '終點'}`);
            const choices = graphNodes.filter((n) => key === 'from' || n.alias !== edge.from);
            if (!choices.some((n) => n.alias === edge[key])) edge[key] = choices[0]?.alias || '';
            select.replaceChildren(...choices.map((n) => new Option(`${n.alias} · ${n.type}`, n.alias, false, n.alias === edge[key])));
            select.onchange = () => { edge[key] = select.value; renderVisualPattern(); };
            if (key === 'to') row.append(element('span', 'edge-arrow', '→'));
            row.append(select);
        }
        const remove = element('button', 'icon-button', '×'); remove.setAttribute('aria-label', `移除連線 ${index + 1}`);
        remove.onclick = () => { graphEdges.splice(index, 1); renderVisualPattern(); };
        row.append(remove); return row;
    }));
    $('visual-pattern-editor').querySelector('summary').textContent = `編輯結構 · ${graphNodes.length} 節點 · ${graphEdges.length} 連線`;
}
function updateGraphInputMode() {
    const visual = $('graph-input-mode').value === 'visual';
    $('visual-pattern-editor').hidden = !visual; $('text-pattern-editor').hidden = visual;
    if (visual) { $('visual-pattern-editor').open = true; renderVisualPattern(); }
}
$('graph-input-mode').onchange = () => {
    if ($('graph-input-mode').value === 'text' && graphNodes.every((n) => /^[A-Za-z_][A-Za-z0-9_]*$/.test(n.type))) {
        const types = new Map(graphNodes.map((n) => [n.alias, n.type]));
        $('graph-pattern').value = graphEdges.map((e) => `${e.from}:${types.get(e.from)} -> ${e.to}:${types.get(e.to)}`).join('\n');
    }
    updateGraphInputMode();
};
$('lora-preset').onclick = () => { loraPreset(); $('graph-pattern').value = LORA_PATTERN; $('visual-pattern-editor').open = true; renderVisualPattern(); };
$('add-graph-node').onclick = () => { if (graphNodes.length >= 32) { notice('一組子圖最多 32 個節點。'); return; } graphNodes.push({alias:`N${++graphNodeNumber}`,type:model?.operators[0] || 'Mul'}); renderVisualPattern(); };
$('add-graph-edge').onclick = () => { if (graphNodes.length < 2) { notice('請先加入至少兩個節點。'); return; } if (graphEdges.length >= 64) { notice('一組子圖最多 64 條連線。'); return; } graphEdges.push({from:graphNodes[0].alias,to:graphNodes.at(-1).alias}); renderVisualPattern(); };
function updatePatternMode() {
    const graph = $('pattern-mode').value === 'graph';
    $('pattern-rows').hidden = graph; $('graph-pattern-editor').hidden = !graph; $('add-operator').hidden = graph;
}
$('pattern-mode').onchange = () => { updatePatternMode(); if (model) runSearch().catch(report); };
$('graph-pattern').oninput = () => { $('pattern-decoded').textContent = '規則已變更，請按「尋找模式」重新解讀與搜尋。'; $('pattern-decoded').classList.remove('missing'); };
$('add-operator').onclick = () => { if (operators.length >= 32) { notice('一組 pattern 最多 32 個 operators。'); return; } operators.push(model?.operators[0] || 'Reshape'); renderPattern(); };
$('previous-page').onclick = () => changePage(Math.max(0, page.offset - 100)).catch(report);
$('next-page').onclick = () => changePage(page.offset + 100).catch(report);
$('previous-result').onclick = () => selectResult(activeIndex <= 0 ? page.total - 1 : activeIndex - 1).catch(report);
$('next-result').onclick = () => selectResult(activeIndex < 0 || activeIndex >= page.total - 1 ? 0 : activeIndex + 1).catch(report);
$('graph-select').onchange = () => { currentGraph = Number($('graph-select').value); selection = null; drawGraph(currentGraph).catch(report); };
$('local-graph').onclick = () => selection ? selectResult(activeIndex).catch(report) : drawGraph(currentGraph).catch(report);
$('full-graph').onclick = () => {
    if (model.graphs[currentGraph].layers > 1500 && !fullConfirmed) { fullConfirmed = true; $('full-graph').textContent = '確認繪製完整圖'; notice(`這張圖有 ${model.graphs[currentGraph].layers.toLocaleString()} 個節點，完整繪製可能耗時。再次點擊「確認繪製完整圖」即可繼續。`); return; }
    $('full-graph').textContent = '完整圖'; fullConfirmed = false; drawGraph(currentGraph, true).catch(report);
};
$('zoom-in').onclick = () => { if (view.target) view.zoomIn(); };
$('zoom-out').onclick = () => { if (view.target) view.zoomOut(); };
$('zoom-reset').onclick = () => { if (view.target) view.resetZoom(); };
$('direction').onclick = () => {
    if (!view.target) return;
    view.options.direction = view.options.direction === 'vertical' ? 'horizontal' : 'vertical';
    (selection ? selectResult(activeIndex) : drawGraph(currentGraph, full)).catch(report);
};
$('dismiss-notice').onclick = () => $('notice').hidden = true;
document.addEventListener('dragover', (e) => e.preventDefault());
document.addEventListener('drop', (e) => { e.preventDefault(); if (e.dataTransfer?.files[0]) openFile(e.dataTransfer.files[0]); });
document.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'f') { e.preventDefault(); if (kind === 'patterns') setKind('layers'); $('query').focus(); }
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'o') { e.preventDefault(); $('open-model').click(); }
});
new MutationObserver(() => document.body.classList.toggle('details-open', $('sidebar').style.opacity === '1')).observe($('sidebar'), { attributes: true, attributeFilter: ['style'] });
await view.start();
reset(); renderPattern();
