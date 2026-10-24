import { Host } from '../vendor/netron/browser.js';
import { View, Attachment } from '../vendor/netron/view.js';
import { hydrate } from './hydrate.js';
import {overviewCanvas} from './overview-canvas.js';
import { modelFormat } from './model-formats.js';
import {layerLocation,updateLayerSelection} from './pattern-selection.js';
import {rectangleSelection} from './rectangle-selection.js';
import {captureViewport,restoreViewport} from './svg-viewport.js';
import { LORA_PATTERN } from './pattern-utils.js';
import { loadPatterns, reusablePattern, savePattern, exportPatterns, parsePatternFile, planPatternImport, importPatterns, PATTERN_FILE_LIMIT } from './pattern-library.js';

const $ = (id) => document.getElementById(id);
let exportBusy = false;
const graphFontSizes = ['14', '16', '18', '20', '24', '28', '32'];
const graphFontKey = 'model-lens.graph-font-size.v1';
try {
    const saved = localStorage.getItem(graphFontKey);
    if (graphFontSizes.includes(saved)) $('graph-font-size').value = saved;
} catch { /* The control still works when preference storage is unavailable. */ }
document.documentElement.style.setProperty('--graph-font-size', `${$('graph-font-size').value}px`);
const element = (tag, className, text) => { const node = document.createElement(tag); if (className) node.className = className; if (text !== undefined) node.textContent = text; return node; };
const size = (bytes) => bytes >= 1073741824 ? `${(bytes / 1073741824).toFixed(2)} GiB` : `${(bytes / 1048576).toFixed(2)} MiB`;
const formatValue = (value) => typeof value === 'bigint' ? String(value) : Array.isArray(value) || ArrayBuffer.isView(value) ? `[${Array.from(value).map(String).join(', ')}]` : String(value);
const host = new Host();
host._environment.menu = false;
host.view = async (view) => { host._view = view; };
host.start = async () => host._view.show('welcome');
host.event = () => {};
host.exception = (error) => console.error(error);
host.export = async (name, blob) => {
    const link = document.createElement('a');
    const url = URL.createObjectURL(blob);
    link.href = url; link.download = name;
    document.body.append(link); link.click(); link.remove();
    // Keep file-backed/worker Blob URLs alive while the browser starts reading.
    setTimeout(() => URL.revokeObjectURL(url), 60000);
};
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
view.showNodeProperties = (node, source) => {
    if(node.diagramKind==='pattern'){activatePatternNode(node).catch(report);return;}
    $('tensor-summary').hidden = true;
    if(renderedGraph?.compactSlice && Number.isInteger(node.sourceGraph) && Number.isInteger(node.sourceNode)) {
        const generation=renderGeneration;
        rpc('overviewNode',{graph:node.sourceGraph,node:node.sourceNode}).then(original=>{
            if(generation===renderGeneration){hydrate(original,file);originalNodeProperties(original,source);}
        }).catch(report);return;
    }
    originalNodeProperties(node, source);
};
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
let graphNodes = [];
let graphEdges = [];
let graphNodeNumber = 5;
let patternLibrary = [];
let pickingPattern = false;
let pickedGraph = 0;
let pickedNodes = new Set();
let cfgPattern = null;
const cfgSelections = new Map();
let renderedNodes = [];
let renderedGraph = null;
let sliceDetails=false;
let sliceExpanded=new Set();
let virtualOverview=null;
function disposeVirtualOverview(){if(virtualOverview){view.target=null;virtualOverview.dispose();virtualOverview=null;}}
try { patternLibrary = loadPatterns(localStorage); } catch { /* Storage may be unavailable; saving will report the error. */ }
function loraPreset() {
    cfgPattern=null;
    graphNodes = ['Mul', 'FullyConnected', 'BatchMatMul', 'BatchMatMul', 'Add'].map((type, i) => ({ alias: `N${i + 1}`, type }));
    graphEdges = [[1, 2], [1, 3], [3, 4], [2, 5], [4, 5]].map(([from, to]) => ({ from: `N${from}`, to: `N${to}` }));
    graphNodeNumber = 5;
}
function chainPreset() {
    cfgPattern=null;
    graphNodes = ['Reshape', 'Transpose', 'Reshape'].map((type, i) => ({ alias: `N${i + 1}`, type }));
    graphEdges = [{ from: 'N1', to: 'N2' }, { from: 'N2', to: 'N3' }];
    graphNodeNumber = 3;
}
chainPreset();
let page = { items: [], total: 0, offset: 0 };
let activeIndex = -1;
let selection;
let currentGraph = 0;
let full = false;
let patternCollapsed = false;
let overviewMode=false,patternSearchReady=false;
let overviewExpanded=new Set();
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
        if (data.error) entry.reject(Object.assign(new Error(data.error),{validation:data.validation})); else entry.resolve(data.data);
    };
    worker.onerror = (event) => { const error = new Error(event.message || '背景解析失敗。'); for (const entry of pending.values()) entry.reject(error); pending.clear(); };
}
function reset() {
    sliceExpanded.clear();$('slice-connection-controls').hidden=true;
    sliceDetails=false;$('toggle-slice-details').hidden=true;
    disposeVirtualOverview();
    exportBusy = false; $('validation-dialog').close();
    ++queryGeneration; ++renderGeneration;
    stopWorker(); model = null; file = null; selection = null; activeIndex = -1; patternCollapsed=false; $('toggle-pattern-fold').hidden=true;
    overviewMode=false;patternSearchReady=false;overviewExpanded.clear();$('fold-all-patterns').hidden=true;$('pattern-overview-controls').hidden=true;
    pickedNodes.clear(); cfgSelections.clear(); $('capture-cfg').checked=false; $('capture-cfg-option').hidden=true; $('match-blocks').hidden=true; renderedNodes = []; renderedGraph = null; setPickingPattern(false);
    full = false; fullConfirmed = false; currentGraph = 0;
    $('export-match').hidden = true; $('export-match').disabled = true;
    $('value-kind-label').textContent = 'Tensors'; $('mlir-info').hidden = true;
    $('mlir-export-option').hidden=true;
    $('export-submodel').hidden = false;
    $('query').placeholder = '搜尋名稱、operator、#編號';
    view._sidebar.close(); view.target = null; view.model = null; view._path = [];
    $('target').replaceChildren(); view.show('welcome');
    $('target').setAttribute('aria-busy', 'false');
    $('empty-state').hidden = false; $('loading-card').hidden = true;
    $('cancel-load').hidden = true; $('close-model').hidden = true;
    $('file-name').textContent = '尚未開啟模型'; $('file-stats').textContent = '從模型結構，找到你要的連接。';
    $('layer-count').textContent = '—'; $('tensor-count').textContent = '—';
    $('query').value = ''; $('query').disabled = true; $('scope').replaceChildren(new Option('目前 subgraph', 'current'), new Option('所有 subgraphs', 'all')); $('scope').disabled = true;
    $('graph-select').replaceChildren(new Option('模型圖', '0')); $('tensor-summary').hidden = true;
    $('graph-caption').textContent = '選取結果以查看連接'; $('metrics').textContent = 'LOCAL FILE · NO UPLOAD';
    $('zoom-reset').textContent='100%';
    $('full-graph').textContent = '完整圖'; $('notice').hidden = true;
    for (const id of ['pick-pattern', 'graph-select', 'run-pattern', 'local-graph', 'full-graph', 'zoom-in', 'zoom-out', 'zoom-reset', 'direction', 'previous-result', 'next-result']) $(id).disabled = true;
    showPage({ items: [], total: 0, offset: 0 });
    status('準備就緒');
}
async function openFile(nextFile) {
    try { await viewReady; modelFormat(nextFile.name); } catch (error) { notice(error.message); return; }
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
        if(model.sourceFormat!=='mlir' && cfgPattern && kind==='patterns')setKind('layers',false);
        $('capture-cfg-option').hidden=model.sourceFormat!=='mlir';
        $('value-kind-label').textContent = model.sourceFormat === 'mlir' ? 'SSA Values' : 'Tensors';
        $('query').placeholder = model.sourceFormat === 'mlir' ? '搜尋 dialect.op、%SSA 名稱、#編號' : '搜尋名稱、operator、#編號';
        $('mlir-info').hidden = model.sourceFormat !== 'mlir';
        $('mlir-export-option').hidden=model.sourceFormat!=='mlir';
        $('export-submodel').hidden = !canExportSubmodel();
        $('export-submodel').textContent = model.capabilities.mlirExport ? '匯出局部 MLIR' : '匯出 TFLite 子模型';
        $('export-match').textContent = model.capabilities.mlirExport ? '匯出此匹配為局部 MLIR ↓' : '匯出此匹配為 TFLite 子模型 ↓';
        const layers = model.graphs.reduce((n, g) => n + g.layers, 0);
        const tensors = model.graphs.reduce((n, g) => n + g.tensors, 0);
        $('layer-count').textContent = layers.toLocaleString(); $('tensor-count').textContent = tensors.toLocaleString();
        $('file-stats').textContent = `${model.format} · ${size(file.size)} · ${layers.toLocaleString()} layers · ${model.graphs.length} ${model.sourceFormat === 'mlir' ? 'scopes' : 'subgraphs'}`;
        $('metrics').textContent = `讀取總量 ${size(model.stats.bytesRead)} · 檔案 ${size(file.size)} · 解析 ${(model.stats.parseMs / 1000).toFixed(2)}s`;
        $('scope').replaceChildren(new Option('目前 subgraph（子圖 0）', 'current'), new Option('所有 subgraphs', 'all'), ...model.graphs.map((g) => new Option(`子圖 ${g.index} · ${g.name} · ${g.layers} layers`, String(g.index))));
        $('graph-select').replaceChildren(...model.graphs.map((g) => new Option(`子圖 ${g.index} · ${g.name}`, String(g.index))));
        for (const id of ['pick-pattern', 'query', 'scope', 'graph-select', 'run-pattern', 'local-graph', 'full-graph', 'zoom-in', 'zoom-out', 'zoom-reset', 'direction']) $(id).disabled = false;
        $('cancel-load').hidden = true; $('close-model').hidden = false;
        renderPattern();
        await runSearch();
        if (model.graphs.length && (model.sliceView || (file.size < 1024 * 1024 * 1024 && layers <= 500))) {
            await drawGraph(0, true);
            if(currentGraph!==0 && $('scope').value==='current')await runSearch();
        }
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
function setKind(nextKind, searchNow = true) {
    kind = nextKind;
    document.querySelectorAll('[data-kind]').forEach((button) => button.setAttribute('aria-selected', String(button.dataset.kind === kind)));
    $('text-search').hidden = kind === 'patterns'; $('pattern-editor').hidden = kind !== 'patterns';
    renderPattern(); if (model && searchNow) runSearch().catch(report);
}
function renderPattern() {
    updatePatternExport();
    $('graph-pattern-editor').hidden=Boolean(cfgPattern);
    $('cfg-pattern-summary').hidden=!cfgPattern;
    $('pattern-match-hint').textContent=cfgPattern ? '依 SSA ports 與控制流程匹配，包含分支、匯合及迴圈；不比對 block／SSA 名稱。' : '依 tensor 直接連接的順序匹配，允許分支；不限制參數。';
    if(cfgPattern) $('cfg-pattern-summary').textContent=`跨 block pattern · ${cfgPattern.nodes.filter(n=>n.kind==='block').length} blocks · ${cfgPattern.nodes.filter(n=>n.kind==='operator').length} operators。比對 SSA ports、block arguments、successor 順序及迴圈；目前範圍會搜尋所在的完整 region。重新圈選可建立另一組。`;
    else renderVisualPattern();
}
async function runSearch() {
    if (!model) return;
    const generation = ++queryGeneration;
    overviewMode=false;patternSearchReady=false;overviewExpanded.clear();$('pattern-overview-controls').hidden=true;
    activeIndex = -1;
    selection = null;
    refreshPatternFold();
    $('match-blocks').hidden=true;
    $('export-match').hidden = true;
    status(kind === 'patterns' ? '搜尋連接模式中…' : '搜尋中…');
    $('result-count').textContent = '搜尋中…';
    const structure = kind==='patterns' && cfgPattern ? cfgPattern : kind === 'patterns' && $('graph-input-mode').value === 'visual' ? { nodes: graphNodes.map((n) => ({...n})), edges: graphEdges.map((e) => ({...e})), induced: $('graph-induced').checked } : null;
    const scope = $('scope').value === 'current' ? String(currentGraph) : $('scope').value;
    const result = await rpc(kind === 'patterns' ? 'subgraphPattern' : 'search', kind === 'patterns' ? { text: $('graph-pattern').value, structure, induced: $('graph-induced').checked, scope } : { kind, query: $('query').value, scope });
    if (generation !== queryGeneration || result.cancelled) return;
    if (result.decodedNodes) {
        const missing = result.decodedNodes.filter((node) => !node.present);
        $('pattern-decoded').textContent = '解讀：' + result.decodedNodes.map((node) => `${node.alias}:${node.type}`).join(' · ') + (missing.length ? `。模型中沒有：${[...new Set(missing.map((node) => node.type))].join('、')}` : '');
        $('pattern-decoded').classList.toggle('missing', missing.length > 0);
    }
    patternSearchReady=kind==='patterns';showPage(result);refreshPatternFold();
    if (structure && result.total) $('visual-pattern-editor').open = false;
    if (result.searchLimited) notice('搜尋已達計算上限，結果可能不完整；請指定 subgraph 或加入更明確的 operator 限制。');
    status(`找到 ${result.total.toLocaleString()} 筆${kind === 'patterns' ? '路徑' : '結果'}${result.searchLimited ? '（已達計算上限，結果可能不完整）' : result.truncated ? '（已達 50,000 筆上限，請縮小範圍）' : ''}`);
}
function showPage(result) {
    page = result;
    $('result-count').textContent = model ? `${result.truncated ? '至少 ' : ''}${result.total.toLocaleString()} 筆${kind === 'patterns' ? '匹配路徑' : '結果'}` : '等待開啟模型';
    const nodes = result.items.map((item, i) => {
        const button = element('button', 'result-item');
        button.title = item.label; button.dataset.resultIndex = String(result.offset + i);
        const top = element('div', 'result-top');
        top.append(element('span', 'result-index', item.patternType === 'graph' || (model.sourceFormat === 'mlir' && item.kind === 'tensors') ? item.id : `#${item.id}`), element('span', 'result-title', item.label));
        const name = model.graphs[item.graph]?.name || `Subgraph ${item.graph}`;
        const info = kind === 'tensors' ? `${name} · ${item.dtype || '?'} [${item.shape.join(', ')}]` : `${name} · ${kind === 'layers' ? item.operator : `${item.operatorCount || item.path.length} 個 operators`}`;
        const context = element('span', 'result-subtitle');
        context.append(element('strong', 'result-subgraph', `子圖 ${item.graph}`), document.createTextNode(` · ${info}`));
        button.append(top, context);
        button.title = `子圖 ${item.graph} · ${info} · ${item.label}`;
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
function setCurrentGraph(graph) {
    currentGraph = graph;
    $('graph-select').value = String(graph);
    const option = $('scope').querySelector('option[value="current"]');
    if (option) option.textContent = `目前 subgraph（子圖 ${graph}）`;
}
function renderMatchBlocks(item) {
    const nav=$('match-blocks');nav.hidden=overviewMode || !item.blocks;
    if(overviewMode)return;
    if(!item.blocks)return;
    nav.replaceChildren(element('strong','',`同圖總覽 · ${item.blocks.length} blocks`),element('span','match-control','藍色虛線：控制流程／出口與回跳；實線：SSA／block argument 傳值。點 block 在同圖定位；可直接跨 block 選取 layers 建立 pattern。'),...item.blocks.map(block=>{
        const button=element('button','quiet',`block ${block.graph} · ${model.graphs[block.graph].name.split('/').at(-1)} · ${block.path.length} layers`);
        button.title=model.graphs[block.graph].name;button.setAttribute('aria-pressed',String(block.graph===currentGraph));
        button.onclick=()=>selectResult(activeIndex,{blockGraph:block.graph}).catch(report);return button;
    }));
    const overview=element('button','quiet','全部 blocks');overview.onclick=()=>focusMatchBlock();nav.append(overview);
}
function focusMatchBlock(graph) {
    if(!renderedGraph?.combined || !view.target)return;
    if(graph!==undefined){setCurrentGraph(graph);if(pickingPattern)syncCaptureGraph();}
    for(const {node,element:el} of renderedNodes)el?.classList.toggle('cfg-focused',graph!==undefined && node.sourceGraph===graph);
    if(selection?.blocks)renderMatchBlocks(selection);
    if(pickingPattern)refreshPickedNodes();
    const ids=graph===undefined?Object.values(renderedGraph.focus).flat():renderedGraph.focus[graph] || [];
    if(graph===undefined)fitCombinedGraph();
    view.target.scrollTo(ids.map(id=>view.target._table.get(renderedGraph.nodes.get(id))?.element).filter(Boolean));
    status(graph===undefined?'同圖顯示所有相關 blocks。':`已在同圖定位 block ${graph}，保留排版與縮放。`);
}
function fitCombinedGraph() {
    const target=$('target');
    if(view.target)view.target.zoom=Math.min(1,(target.clientWidth-32)/view.target._width,(target.clientHeight-32)/view.target._height);
}
function decorateCombinedGraph(dto) {
    $('target').classList.toggle('cfg-combined',!!dto.combined);
    if(!dto.combined)return;
    const marker=$('target').querySelector('#arrowhead')?.cloneNode(true);
    if(marker){marker.id='cfg-control-arrow';$('target').querySelector('defs')?.append(marker);}
    const matched=new Set(dto.selected.map(String));
    for(const {node,element:el} of renderedNodes) {
        el?.setAttribute('data-block',String(node.sourceGraph));
        el?.classList.toggle('cfg-match',matched.has(node.identifier));
        if(node.diagramKind!=='operator')el?.classList.add('cfg-context');
    }
    for(const link of dto.links || [])if(link.kind==='control') {
        const from=view.target._table.get(renderedGraph.nodes.get(link.from)),to=view.target._table.get(renderedGraph.nodes.get(link.to));
        const edge=from && to?view.target.edge(from.name,to.name)?.label:null;
        edge?.element?.classList.add('cfg-control');edge?.labelElement?.classList.add('cfg-control-label');
    }
    for(const action of dto.sliceEdgeActions || []) {
        const from=view.target._table.get(renderedGraph.nodes.get(action.from)),to=view.target._table.get(renderedGraph.nodes.get(action.to));
        const edge=from && to?view.target.edge(from.name,to.name)?.label:null;if(!edge)continue;
        const connections=action.keys.map(key=>dto.sliceConnections.find(c=>c.key===key)),expanded=connections.some(c=>c.expanded);
        const label=`${expanded?'收起':'展開'}連線路徑：${connections.map(c=>c.label).join('；')}`;
        const activate=event=>{
            if(event.type==='keydown' && !['Enter',' '].includes(event.key))return;
            event.preventDefault();event.stopImmediatePropagation();
            if(pickingPattern || $('target').getAttribute('aria-busy')==='true')return;
            const key=action.keys.findLast(k=>sliceExpanded.has(k)) || action.keys[0];
            const next=new Set(sliceExpanded);if(next.has(key))next.delete(key);else next.add(key);
            changeSliceExpansion(next,{key,segment:action,point:event.type==='click'?{x:event.clientX,y:event.clientY}:undefined}).catch(report);
        };
        for(const el of [edge.element,edge.hitTest,edge.labelElement].filter(Boolean)) {
            el.dataset.sliceFrom=action.from;el.dataset.sliceTo=action.to;el.classList.add('slice-connection');el.setAttribute('aria-label',label);el.addEventListener('click',activate,true);
        }
        if(edge.hitTest){edge.hitTest.classList.add('slice-connection-hit');edge.hitTest.setAttribute('role','button');edge.hitTest.setAttribute('tabindex','0');edge.hitTest.setAttribute('aria-expanded',String(expanded));edge.hitTest.addEventListener('keydown',activate,true);}
    }
}
function viewportEntries(){return renderedNodes.map(e=>({id:e.node.identifier,element:e.element}));}
async function changeSliceExpansion(next,{key,segment,point}={}) {
    const connection=key?.split('>') || [],preferred=[...new Set([segment?.from,segment?.to,...connection].filter(Boolean))];
    const entries=viewportEntries().filter(e=>preferred.length || renderedGraph.nodes.get(e.id)?.diagramKind==='operator');
    const viewport=captureViewport($('target'),view.target?.zoom,entries,{preferred,point});
    const previous=sliceExpanded;sliceExpanded=next;
    try {await (selection?selectResult(activeIndex,{forceDraw:true,viewport}):drawGraph(currentGraph,full,undefined,viewport));}
    catch(error){sliceExpanded=previous;throw error;}
}
function renderSliceConnections(dto) {
    const nav=$('slice-connection-controls'),connections=dto.compactSlice && !dto.folded && !dto.overview ? dto.sliceConnections || [] : [];
    sliceExpanded=new Set(connections.filter(c=>c.expanded).map(c=>c.key));nav.hidden=!sliceExpanded.size;
    nav.replaceChildren(element('strong','',`局部展開 · ${sliceExpanded.size} 段路徑`));
    for(const c of connections.filter(c=>c.expanded)) {
        const button=element('button','quiet',`收起：${c.label}`);button.title=c.label;
        button.onclick=()=>{const next=new Set(sliceExpanded);next.delete(c.key);changeSliceExpansion(next,{key:c.key}).catch(report);};nav.append(button);
    }
    const all=element('button','quiet','收起全部路徑');all.onclick=()=>changeSliceExpansion(new Set()).catch(report);nav.append(all);
}
function refreshPatternFold() {
    const sliceButton=$('toggle-slice-details');
    sliceButton.hidden=!renderedGraph?.sliceView || overviewMode;
    sliceButton.textContent=sliceDetails?'收起輔助節點':'展開輔助節點';
    sliceButton.setAttribute('aria-expanded',String(sliceDetails));
    sliceButton.disabled=pickingPattern || $('target').getAttribute('aria-busy')==='true';
    for(const button of $('slice-connection-controls').querySelectorAll('button'))button.disabled=sliceButton.disabled;
    const button=$('toggle-pattern-fold');button.hidden=overviewMode || selection?.kind!=='patterns';
    button.textContent=patternCollapsed?'展開 pattern':'收合 pattern';
    button.setAttribute('aria-expanded',String(!patternCollapsed));
    button.disabled=pickingPattern || $('target').getAttribute('aria-busy')==='true';
    button.title=pickingPattern?'完成圈選後即可收合':'保留對外資料與控制連線；點收合節點可展開';
    $('pick-pattern').disabled=!model || $('target').getAttribute('aria-busy')==='true' || (!virtualOverview && (!!renderedGraph?.folded || !!renderedGraph?.overview));
    $('fold-all-patterns').hidden=!patternSearchReady || kind!=='patterns' || !page.total;
    $('fold-all-patterns').textContent=overviewMode?'返回匹配圖':'收合所有匹配';
    $('fold-all-patterns').disabled=button.disabled;
    for(const id of ['toggle-overview-match','expand-overview-all','collapse-overview-all'])$(id).disabled=button.disabled || (id==='toggle-overview-match' && !renderedGraph?.overviewMatches?.find(m=>m.index===activeIndex)?.foldable);
}
function patternDisplayName() {const option=$('saved-pattern').selectedOptions[0];return option?.value?option.textContent:'Pattern';}
function activatePatternNode(node) {return Number.isInteger(node.matchIndex)?toggleOverviewOccurrence(node.matchIndex):togglePatternFold(false);}
function overviewOption(m) {return new Option(`匹配 #${m.index+1} · ${m.operatorCount} OP · ${!m.foldable?'重疊，未另建節點':m.collapsed?'收合':'展開'}`,String(m.index),false,m.index===activeIndex);}
function renderOverviewControls(dto) {
    $('pattern-overview-controls').hidden=!dto.overview;
    if(!dto.overview)return;
    $('slice-connection-controls').hidden=true;
    $('match-blocks').hidden=true;
    // A broad pattern may have tens of thousands of overlapping matches. Keep
    // the dropdown bounded; all results remain available in the paginated list.
    const choices=dto.overviewMatches.length>1500?dto.overviewMatches.filter(m=>m.foldable).slice(0,1000):dto.overviewMatches;
    if(!choices.some(m=>m.index===activeIndex))choices.push(dto.overviewMatches[activeIndex]);
    $('overview-match').replaceChildren(...choices.map(overviewOption));
    $('toggle-overview-match').textContent=dto.overviewMatches[activeIndex]?.collapsed?'展開此匹配':'收合此匹配';
    $('overview-summary').textContent=`原始 ${dto.total.toLocaleString()} OP → ${dto.nodes.length.toLocaleString()} 個總覽節點 · ${dto.overviewMatches.length.toLocaleString()} 筆匹配 · ${dto.collapsedCount} 個收合節點。${dto.virtual?'Canvas 虛擬總覽只繪製視窗範圍；拖曳平移、滾輪縮放，「全圖」還原總覽。選取 pattern 可跨 block 框選已展開的原始 OP，Alt＋拖曳平移；收合節點點開後再選。藍色虛線為控制流程。':''}${dto.overlapCount?`${dto.overlapCount} 組與其他匹配共用 OP，未另建節點，仍可從分頁清單定位。`:''}${dto.overviewMatches.length>1500?'下拉選單列前 1,000 組獨立匹配及目前選取；所有結果可從分頁清單定位。':''}未匹配的 OP 保留。${dto.virtual?'':'需圈選時請返回匹配圖。'}`;
}
async function drawPatternOverview({expanded=overviewExpanded,active=activeIndex>=0?activeIndex:0,zoom}={}) {
    if(!model || !patternSearchReady || (pickingPattern && !virtualOverview))return;
    const query=queryGeneration,generation=++renderGeneration;
    $('target').setAttribute('aria-busy','true');refreshPatternFold();status('建立全模型 pattern 總覽…');
    try {
        const dto=await rpc('patternOverview',{expanded:[...expanded],active,patternName:patternDisplayName(),font:Number($('graph-font-size').value),direction:view.options.direction});
        if(query!==queryGeneration || generation!==renderGeneration || dto.cancelled)return;
        overviewMode=true;overviewExpanded=new Set(expanded);activeIndex=dto.activeIndex;selection=dto.item;full=true;setCurrentGraph(dto.graphIndex);
        $('export-match').hidden=false;$('export-match').disabled=exportBusy || !canExportSubmodel();
        await queueDraw(dto,generation,zoom);
    } finally {if(generation===renderGeneration){$('target').setAttribute('aria-busy','false');refreshPatternFold();}}
}
function focusOverviewMatch(item,index) {
    const match=renderedGraph.overviewMatches.find(m=>m.index===index);if(!match)return;
    activeIndex=index;selection=item;setCurrentGraph(item.graph);
    if(![...$('overview-match').options].some(option=>option.value===String(index))) {
        for(const option of [...$('overview-match').options])if(option.dataset.temporary)option.remove();
        const option=overviewOption(match);option.dataset.temporary='true';$('overview-match').add(option);
    }
    $('overview-match').value=String(index);$('toggle-overview-match').textContent=match.collapsed?'展開此匹配':'收合此匹配';
    document.querySelectorAll('[data-result-index]').forEach(b=>b.classList.toggle('active',Number(b.dataset.resultIndex)===index));
    if(virtualOverview){virtualOverview.focus(match.nodes);if(pickingPattern){if($('capture-cfg').checked)syncCaptureGraph();refreshPickedNodes();}refreshPatternFold();status(`已在全模型虛擬總覽定位匹配 #${index+1}，其餘節點依視窗載入。`);return;}
    const nodes=match.nodes.map(id=>renderedGraph.nodes.get(id)).filter(Boolean);
    const marked=new Set(match.nodes);for(const {node,element:el} of renderedNodes)if(renderedGraph.combined)el?.classList.toggle('cfg-match',marked.has(node.identifier));
    if(view.target)view.target.scrollTo(view.target.select(nodes,'explorer'));
    refreshPatternFold();status(`已在全模型圖定位匹配 #${index+1}，保留其他匹配的收合狀態。`);
}
async function toggleOverviewOccurrence(index) {
    if(!overviewMode)return;
    const match=renderedGraph?.overviewMatches?.find(m=>m.index===index);if(!match?.foldable)return;
    const expanded=new Set(overviewExpanded);if(expanded.has(index))expanded.delete(index);else expanded.add(index);
    await drawPatternOverview({expanded,active:index});
}
$('fold-all-patterns').onclick=async()=>{
    try {if(overviewMode){overviewMode=false;$('pattern-overview-controls').hidden=true;await selectResult(activeIndex,{whole:false,forceDraw:true});}else await drawPatternOverview();}catch(error){report(error);}
};
$('overview-match').onchange=()=>selectResult(Number($('overview-match').value)).catch(report);
$('toggle-overview-match').onclick=()=>toggleOverviewOccurrence(activeIndex).catch(report);
$('expand-overview-all').onclick=()=>drawPatternOverview({expanded:new Set(renderedGraph.overviewMatches.filter(m=>m.foldable).map(m=>m.index))}).catch(report);
$('collapse-overview-all').onclick=()=>drawPatternOverview({expanded:new Set()}).catch(report);
async function togglePatternFold(collapsed=!patternCollapsed) {
    if(selection?.kind!=='patterns' || pickingPattern)return;
    patternCollapsed=collapsed;
    if(collapsed)sliceExpanded.clear();
    await selectResult(activeIndex,{forceDraw:true});
}
$('toggle-pattern-fold').onclick=()=>togglePatternFold().catch(report);
$('toggle-slice-details').onclick=()=>{
    sliceDetails=!sliceDetails;
    if(!sliceDetails)sliceExpanded.clear();
    (selection?selectResult(activeIndex,{forceDraw:true}):drawGraph(currentGraph,full)).catch(report);
};
async function selectResult(index, { whole, forceDraw = false, zoom, blockGraph,viewport } = {}) {
    if (!model || !page.total) return;
    const generation = queryGeneration;
    if (index < page.offset || index >= page.offset + page.items.length) await changePage(Math.floor(index / 100) * 100);
    if (generation !== queryGeneration) return;
    const item = page.items[index - page.offset];
    if (!item) return;
    if(overviewMode && renderedGraph?.overview && !forceDraw){focusOverviewMatch(item,index);return;}
    whole ??= item.blocks && !selection?.blocks ? false : full;
    if(item===selection && blockGraph!==undefined && renderedGraph?.combined && !forceDraw && whole===full){focusMatchBlock(blockGraph);return;}
    const targetGraph=blockGraph ?? (item===selection && item.blocks?.some(b=>b.graph===currentGraph) ? currentGraph : item.graph);
    activeIndex = index; selection = item; full = whole;
    $('export-match').hidden = item.kind !== 'patterns' || !canExportSubmodel();
    $('export-match').disabled = exportBusy || !canExportSubmodel();
    document.querySelectorAll('[data-result-index]').forEach((button) => button.classList.toggle('active', Number(button.dataset.resultIndex) === index));
    if(!viewport)document.querySelector(`[data-result-index="${index}"]`)?.scrollIntoView({ block: 'nearest' });
    setCurrentGraph(targetGraph); renderMatchBlocks(item);
    const generationRender = ++renderGeneration;
    $('target').setAttribute('aria-busy', 'true');
    refreshPatternFold();
    const collapsed=item.kind==='patterns' && patternCollapsed;
    const metadataOnly = !collapsed && !renderedGraph?.folded && !renderedGraph?.virtual && !item.blocks && whole && !forceDraw && renderedGraph?.full && !renderedGraph.combined && renderedGraph.index === targetGraph;
    status(metadataOnly ? '定位搜尋結果…' : whole ? '準備完整圖…' : '準備局部圖…');
    const patternName=$('saved-pattern').selectedOptions[0]?.value ? $('saved-pattern').selectedOptions[0].textContent : 'Pattern';
    const dto = await rpc('select', { item, full: whole, metadataOnly, blockGraph:targetGraph, boundaryContext:true, collapsed, patternName, sliceDetails, expandedConnections:[...sliceExpanded] });
    await queueDraw(dto, generationRender, zoom,viewport);
}
async function drawGraph(graph, whole = false, zoom,viewport) {
    if (!model) return;
    setCurrentGraph(graph); full = whole; selection = null;
    overviewMode=false;$('pattern-overview-controls').hidden=true;
    refreshPatternFold();
    $('match-blocks').hidden=true;
    $('export-match').hidden = true;
    const generation = ++renderGeneration;
    $('target').setAttribute('aria-busy', 'true');
    status(whole ? '繪製完整圖…' : '繪製局部圖…');
    const dto = await rpc('graph', { graph, full: whole, sliceDetails, expandedConnections:[...sliceExpanded] });
    await queueDraw(dto, generation, zoom,viewport);
}
async function queueDraw(dto, generation, zoom,viewport) {
    renderQueue = renderQueue.catch(() => {}).then(async () => {
        if (generation !== renderGeneration || !model) return;
        const start = performance.now();
        if(dto.virtual){
            const previousZoom=virtualOverview?.zoomValue;disposeVirtualOverview();view.target=null;view.show('default');view._sidebar.close();layerMarquee.cancel();
            const graph=dto.graph;view.model={format:model.format,description:model.description,modules:[graph],metadata:[],attachment:new Attachment()};view._path=[{target:graph,signature:null}];renderedGraph={index:dto.graphIndex,full:true,graph,virtual:true,combined:dto.combined,overview:true,folded:dto.folded,overviewMatches:dto.overviewMatches,nodes:new Map(graph.nodes.map(n=>[n.identifier,n])),values:new Map()};
            renderedNodes=graph.nodes.map(n=>({node:n,index:n.identifier}));
            renderedGraph.captureScopes=new Map();for(const n of graph.nodes)for(const g of n.sourceGraphs || [n.sourceGraph])if(Number.isInteger(g))renderedGraph.captureScopes.set(g,n.group?.split('/')[0]);
            virtualOverview=overviewCanvas($('target'),dto.layout,{selected:dto.selected,activate:node=>activateOverviewNode(node).catch(report),capture:commitCanvasLayers});
            if(previousZoom!==undefined || Number.isFinite(zoom))virtualOverview.focus(dto.selected,zoom ?? previousZoom);
            // Netron's detail sidebar emits focus/select/activate events. Keep
            // those events on the Canvas camera instead of a stale SVG target.
            const controller=virtualOverview;
            view.target={on(){},off(){},register(){},unregister(){},selection:new Set(),nodes:new Map(),get zoom(){return controller.zoomValue;},set zoom(value){controller.zoom(value/controller.zoomValue);},select(values){return values || [];},focus(){},blur(){},scrollTo(){},activate(value){view.showTensorProperties(value,'sidebar');return[];}};
            $('empty-state').hidden=true;$('tensor-summary').hidden=true;renderOverviewControls(dto);refreshPickedNodes();$('graph-caption').textContent=`全模型虛擬總覽 · ${dto.nodes.length.toLocaleString()} 節點 · ${dto.collapsedCount.toLocaleString()} 個收合節點`;
            $('zoom-reset').textContent='全圖';$('local-graph').style.background='';$('full-graph').style.background='#e6eee2';status(`全模型虛擬總覽 · ${dto.nodes.length.toLocaleString()} 節點 · 建立視窗 ${(performance.now()-start).toFixed(0)} ms`);return;
        }
        if (!dto.metadataOnly) {
            disposeVirtualOverview();
            $('zoom-reset').textContent='100%';
            hydrate(dto, file);
            const graph = dto.graph;
            view.options.names = model.sourceFormat === 'mlir';
            const currentModel = { format: model.format, description: model.description, modules: [graph], metadata: [], attachment: new Attachment() };
            view._sidebar.close();
            // SVG text must be visible when Netron measures getBBox().
            view.show('default');
            layerMarquee.cancel();
            renderedGraph = null;
            await view._updateTarget(currentModel, [{ target: graph, signature: null }]);
            if (generation !== renderGeneration) { renderedGraph = null; return; }
            if (Number.isFinite(zoom) && view.target) view.target.zoom = zoom;
            else if(!viewport && (dto.combined || dto.overview))fitCombinedGraph();
            renderedGraph = {
                index: dto.graphIndex, full: dto.full, graph, combined: dto.combined, focus: dto.focus, folded:dto.folded,
                sliceView:dto.sliceView,compactSlice:dto.compactSlice,
                overview:dto.overview,overviewMatches:dto.overviewMatches,
                nodes: new Map(graph.nodes.map((node) => [node.identifier, node])),
                values: new Map([...graph.inputs, ...graph.outputs, ...graph.nodes.flatMap((node) => [...node.inputs, ...node.outputs])].flatMap((arg) => arg.value).map((value) => [value.identifier, value]))
            };
            if (pickedGraph !== currentGraph) {
                if($('capture-cfg').checked) {cfgSelections.set(pickedGraph,pickedNodes);pickedNodes=cfgSelections.get(currentGraph) || new Set();cfgSelections.set(currentGraph,pickedNodes);}
                else pickedNodes=new Set();
                pickedGraph = currentGraph;
            }
            renderedNodes = graph.nodes.map((node, i) => ({ node, index: dto.nodes[i], element: view.target?._table.get(node)?.element }));
            for (const entry of renderedNodes) if (entry.element) entry.element.dataset.modelNode = String(entry.index);
            decorateCombinedGraph(dto);
        }
        if (!renderedGraph || renderedGraph.index !== dto.graphIndex) return;
        const graph = renderedGraph.graph;
        renderSliceConnections(dto);
        if(dto.sliceView && !selection)setCurrentGraph(dto.graphIndex);
        refreshPickedNodes();
        renderOverviewControls(dto);
        $('empty-state').hidden = true;
        $('graph-caption').textContent = dto.compactSlice?`精簡圖 · ${dto.item.blocks.length} blocks · ${dto.total} 個原始 OP · ${dto.sliceHelperCount?`局部展開 ${dto.sliceHelperCount} 個輔助節點`:"輔助節點已收起 · 點連線展開"}`:dto.overview?`全模型 · ${dto.overviewMatches.length} 筆匹配 · ${dto.collapsedCount} 個收合節點${dto.overlapCount?` · ${dto.overlapCount} 組重疊`:''}`:dto.folded?`已收合 ${dto.matchedOperatorCount} 個匹配 OP · 點節點展開 · 對外連線保留`:dto.combined?`同圖總覽 · ${dto.item.blocks.length} blocks · ${dto.selected.length} 個匹配 layers${dto.full?' · 含相關 blocks 全部 operators':' · 匹配與控制節點'}`:`${dto.full ? '完整圖' : '局部圖'} · ${graph.nodes.length} / ${dto.total} layers`;
        const selected = dto.selected.map((index) => renderedGraph.nodes.get(String(index))).filter(Boolean);
        if (dto.detail) {
            dto.detail = renderedGraph.values.get(dto.detail.identifier) || hydrate(dto.detail, file);
            tensorSummary(dto.detail); view.showTensorProperties(dto.detail, 'sidebar');
        }
        else if (selected.length === 1 && !dto.folded) { $('tensor-summary').hidden = true; view.showNodeProperties(selected[0], 'sidebar'); }
        else { $('tensor-summary').hidden = true; view._sidebar.close(); }
        if (view.target) {
            const values = dto.detail ? [dto.detail] : selected;
            const elements = view.target.select(values, 'explorer');
            // A tensor may feed extra branches. Select the rendered edge for
            // each matched pair, rather than all edges sharing that tensor.
            const connections = dto.item?.connections || dto.selected.slice(0, -1).map((n, i) => [n, dto.selected[i + 1]]);
            if (dto.item?.kind === 'patterns') for (const [fromId, toId] of connections) {
                const from = view.target._table.get(renderedGraph.nodes.get(String(fromId)));
                const to = view.target._table.get(renderedGraph.nodes.get(String(toId)));
                const edge = from && to ? view.target.edge(from.name, to.name)?.label : null;
                if (edge) { elements.push(...edge.select()); view.target._selection.add(edge); }
            }
            if(!viewport)view.target.scrollTo(elements);
        }
        if(viewport)restoreViewport($('target'),view.target,$('canvas'),viewportEntries(),viewport);
        if (pickingPattern) view._sidebar.close();
        status(`${model.graphs[currentGraph].name} · ${dto.full ? '完整圖' : '局部圖'} ${graph.nodes.length} 個節點 · ${dto.metadataOnly ? '定位' : '繪圖'} ${(performance.now() - start).toFixed(0)} ms${dto.detail && !dto.selected.length ? ' · 此 tensor 沒有相連的 operator' : ''}`);
        if(dto.sliceDirectConnection)status('這段是原始 OP 之間的直接連線，沒有隱藏的輔助節點。');
        $('local-graph').style.background = dto.full ? '' : '#e6eee2'; $('full-graph').style.background = dto.full ? '#e6eee2' : '';
    });
    try { await renderQueue; }
    finally { if (generation === renderGeneration) { $('target').setAttribute('aria-busy', 'false'); refreshPatternFold(); } }
}
async function activateOverviewNode(node) {
    if(node.diagramKind==='pattern'){await activatePatternNode(node);return;}
    if(pickingPattern){if(node.diagramKind==='operator')commitCanvasLayers([node],{toggle:true});else status('這是控制流程／邊界顯示標記，未加入 pattern；請選取原始 OP。');return;}
    if(node.diagramKind!=='operator')return;
    const controller=virtualOverview,generation=renderGeneration;
    const detail=await rpc('overviewNode',{graph:node.sourceGraph,node:node.sourceNode});
    if(!controller || controller!==virtualOverview || generation!==renderGeneration)return;
    hydrate(detail,file);view.showNodeProperties(detail,'sidebar');
}
function tensorSummary(value) {
    if (!value?.type) { $('tensor-summary').hidden = true; return; }
    const section = $('tensor-summary');
    const dl = element('dl');
    const add = (label, text) => { dl.append(element('dt', '', label), element('dd', '', text)); };
    add(model.sourceFormat === 'mlir' ? 'SSA 名稱' : 'Tensor 編號', model.sourceFormat === 'mlir' ? value.identifier : `#${value.identifier}`); add('Shape', `[${value.type.shape?.dimensions?.join(', ') || ''}]`); add('Dtype', value.type.dataType);
    if (value.type.spelling) add('MLIR type', value.type.spelling);
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

function refreshPatternLibrary(selectedName = '') {
    $('saved-pattern').replaceChildren(new Option('選擇已儲存的 pattern…', ''), ...patternLibrary.map((pattern) => new Option(pattern.name, pattern.name)));
    $('saved-pattern').value = selectedName;
    updatePatternExport();
}
function updatePatternExport() {
    $('export-pattern').disabled = !patternLibrary.some((pattern) => pattern.name === $('saved-pattern').value);
    $('export-patterns').disabled = !patternLibrary.length;
}
async function downloadPatterns(patterns) {
    try { await host.export(patterns.length === 1 ? 'model-lens-pattern.json' : 'model-lens-patterns.json', new Blob([exportPatterns(patterns) + '\n'], { type: 'application/json' })); }
    catch (error) { report(error); }
}
$('export-pattern').onclick = () => downloadPatterns(patternLibrary.filter((pattern) => pattern.name === $('saved-pattern').value));
$('export-patterns').onclick = () => downloadPatterns(patternLibrary);
let importGeneration = 0;
function importError(error) {
    $('import-preview').textContent = error.message;
    $('import-preview').classList.add('invalid'); $('confirm-import').disabled = true;
}
function previewImport() {
    try {
        const plan = planPatternImport(patternLibrary, parsePatternFile($('import-json').value));
        $('import-preview').textContent = `將新增 ${plan.added.length} 組 · 略過 ${plan.skipped} 組重複 · 自動改名 ${plan.renamed} 組` + (plan.added.length ? '\n' + plan.added.slice(0, 8).map((pattern) => `${pattern.name} · ${pattern.nodes.length} 節點 / ${pattern.edges.length} 連線`).join('\n') + (plan.added.length > 8 ? '\n…' : '') : '');
        $('import-preview').classList.remove('invalid'); $('confirm-import').disabled = false;
    } catch (error) { importError(error); }
}
$('open-import').onclick = () => {
    ++importGeneration;
    $('pattern-file').value = ''; $('import-json').value = ''; $('import-file-name').textContent = '';
    $('import-preview').textContent = '尚未選擇檔案。'; $('import-preview').classList.remove('invalid'); $('confirm-import').disabled = true;
    $('import-dialog').querySelector('details').open = false;
    $('import-dialog').showModal();
};
for (const id of ['close-import', 'cancel-import']) $(id).onclick = () => { ++importGeneration; $('import-dialog').close(); };
$('import-dialog').addEventListener('cancel', () => ++importGeneration);
$('choose-pattern-file').onclick = () => { $('pattern-file').value = ''; $('pattern-file').click(); };
$('pattern-file').onchange = async () => {
    const selected = $('pattern-file').files[0]; if (!selected) return;
    const generation = ++importGeneration;
    $('confirm-import').disabled = true; $('import-file-name').textContent = selected.name;
    try {
        if (selected.size > PATTERN_FILE_LIMIT) throw new Error('Pattern 檔案不得超過 1 MiB。');
        const text = await selected.text();
        if (generation !== importGeneration) return;
        $('import-json').value = text; previewImport();
    } catch (error) { if (generation === importGeneration) importError(error); }
};
$('import-json').oninput = () => { ++importGeneration; previewImport(); };
$('confirm-import').onclick = () => {
    try {
        const selectedName = $('saved-pattern').value;
        const plan = importPatterns(localStorage, patternLibrary, $('import-json').value);
        patternLibrary = plan.patterns; refreshPatternLibrary(selectedName);
        ++importGeneration; $('import-dialog').close();
        status(`已匯入 ${plan.added.length} 組 patterns · 略過 ${plan.skipped} 組 · 更名 ${plan.renamed} 組。從已儲存清單選擇即可套用。`);
    } catch (error) { importError(error); }
};
function applyPattern(pattern) {
    cfgPattern=pattern.mode==='mlir-cfg' ? {...pattern} : null;
    if(cfgPattern) {setKind('patterns',false);return;}
    graphNodes = pattern.nodes.map((node) => ({ ...node }));
    graphEdges = pattern.edges.map((edge) => ({ ...edge }));
    graphNodeNumber = Math.max(0, ...graphNodes.map((node) => Number(node.alias.replace(/^N/, '')) || 0));
    $('graph-induced').checked = Boolean(pattern.induced);
    $('graph-input-mode').value = 'visual';
    updateGraphInputMode(); setKind('patterns', false);
}
function refreshPickedNodes() {
    document.body.classList.toggle('pattern-picking',pickingPattern);
    const cfg=model?.graphs[($('capture-cfg').checked?captureSelections()[0]?.graph:undefined) ?? currentGraph]?.cfgExport;
    const across=$('capture-cfg').checked,count=across ? [...cfgSelections.values()].reduce((n,set)=>n+set.size,0) : pickedNodes.size;
    $('capture-cfg').disabled=!!renderedGraph?.combined;
    $('add-visible-layers').hidden=!renderedGraph?.combined;
    $('add-capture-block').textContent=renderedGraph?.combined?'加入此 block 可見 layers':'加入目前 block 全部 layers';
    $('capture-hint').textContent=virtualOverview?'Canvas 拖曳框選原始 OP，可跨 blocks；Alt＋拖曳平移，滾輪縮放，點選加入／取消。綠色為已選；收合節點點開後再選，控制標記不加入。':renderedGraph?.combined?'拖曳框選可跨 block 加入 layers；點選可加入／取消，Alt＋拖曳平移。綠色為已選取；控制標記不會存入 pattern。':'拖曳框選加入多個 layers；點選可加入／取消，Alt＋拖曳平移。';
    $('add-visible-layers').textContent=virtualOverview?'加入視窗內 layers':'選取圖中全部 layers';
    const whole=$('mlir-export-scope').value==='function';
    $('capture-count').textContent = `已選取 ${count} 個 layers${across ? ` · ${[...cfgSelections.values()].filter(s=>s.size).length} 個 blocks` : ''}${cfg ? whole ? ` · MLIR 匯出保留 @${cfg.function} 的完整 ${cfg.blocks} 個 blocks` : ' · 局部匯出將補足必要的控制節點與迴圈運算' : ''}`;
    if(model?.capabilities?.mlirExport) {
        $('export-submodel').textContent=cfg && whole ? '匯出完整控制流程 MLIR' : '匯出局部 MLIR';
        const matched=model.graphs[selection?.graph]?.cfgExport;
        $('export-match').textContent=matched && whole ? `匯出匹配所在 function（${matched.blocks} blocks）↓` : '匯出此匹配為局部 MLIR ↓';
    }
    $('save-capture').disabled = !model || count < (across ? 1 : 2);
    renderCaptureBlocks();
    $('export-submodel').disabled = exportBusy || !canExportSubmodel() || !count;
    if(virtualOverview)virtualOverview.setPicking(pickingPattern,pickingPattern?renderedNodes.filter(entry=>{const loc=layerLocation(entry,currentGraph);return loc && (across?cfgSelections.get(loc.graph)?.has(loc.node):pickedGraph===loc.graph && pickedNodes.has(loc.node));}).map(entry=>entry.node.identifier):[]);
    for (const entry of renderedNodes) if (entry.element) {
        const location=layerLocation(entry,currentGraph),picked=location && (across?cfgSelections.get(location.graph)?.has(location.node):pickedNodes.has(location.node));
        entry.element.classList.toggle('pattern-picked',!!(pickingPattern && picked));
        if (pickingPattern && location) {
            entry.element.setAttribute('role', 'button'); entry.element.setAttribute('tabindex', '0');
            entry.element.setAttribute('aria-label', `${across?`block ${location.graph} · `:''}選取 layer #${location.node} ${entry.node.type.name}`);
            entry.element.setAttribute('aria-pressed', String(!!picked));
        } else {
            for (const attribute of ['role', 'tabindex', 'aria-label', 'aria-pressed']) entry.element.removeAttribute(attribute);
        }
        if(entry.node.diagramKind==='pattern') {
            entry.element.classList.add('pattern-capsule');entry.element.setAttribute('role','button');entry.element.setAttribute('tabindex','0');
            entry.element.setAttribute('aria-expanded','false');entry.element.setAttribute('aria-label',`展開 pattern：${entry.node.name}`);
            if(!entry.element.dataset.foldActivation) {
                entry.element.dataset.foldActivation='true';
                entry.element.addEventListener('click',event=>{event.preventDefault();event.stopImmediatePropagation();activatePatternNode(entry.node).catch(report);},true);
            }
            entry.element.onkeydown=event=>{if(event.key==='Enter' || event.key===' '){event.preventDefault();event.stopPropagation();activatePatternNode(entry.node).catch(report);}};
        }
    }
}
$('export-submodel').onclick = async () => {
    if(exportBusy)return;
    if(!$('capture-cfg').checked)return downloadSubmodel(currentGraph,[...pickedNodes]);
    const selections=captureSelections(),sourceFile=file;$('export-submodel').disabled=true;
    try {if(file===sourceFile && selections.length)await downloadSubmodel(selections[0].graph,selections[0].nodes,selections);}catch(error){report(error);}finally{refreshPickedNodes();}
};
$('export-match').onclick = () => { if (selection?.kind === 'patterns') downloadSubmodel(selection.graph, [...selection.path],selection.blocks?.map(b=>({graph:b.graph,nodes:[...b.path]}))); };
$('mlir-export-scope').onchange=refreshPickedNodes;
function canExportSubmodel() { return Boolean(model?.capabilities?.tfliteExport || model?.capabilities?.mlirExport); }
async function downloadSubmodel(graph, nodes, selections) {
    if (!canExportSubmodel() || exportBusy) return;
    const sourceFile = file;
    const mlir = model.capabilities.mlirExport;
    exportBusy = true;
    $('export-submodel').disabled = true;
    $('export-match').disabled = true;
    try {
        status(mlir ? '擷取局部 MLIR，保留原始型別、屬性與 SSA 連線…' : '建立 TFLite 子模型，保留所需權重與參數…');
        const result = await rpc(mlir ? 'exportMLIR' : 'exportTflite', { graph, nodes, ...(mlir ? {scope:$('mlir-export-scope').value,selections}: {}) });
        if (file !== sourceFile) return;
        await host.export(`${sourceFile.name.replace(/\.[^.]+$/, '')}-submodel.${mlir ? 'mlir' : 'tflite'}`, result.blob);
        if (mlir) {
            if(result.slice) {
                const added=result.slice.added.length ? ` 補入迴圈必要運算：${[...new Set(result.slice.added)].join('、')}（${result.slice.added.length} 個）。` : '';
                const conditional=result.slice.conditionalOutputs ? ` ${result.slice.conditionalOutputs} 個條件輸出以 (valid, value) 回傳；未執行時 valid=false，需提供同型別備援輸入。` : '';
                notice(`已匯出 ${result.slice.selected} 個選取 layers 的局部 MLIR，含 ${result.slice.blocks} 個控制流程 blocks、${result.inputs.length} 個輸入、${result.outputs.length} 個資料輸出。${added}${conditional}${result.slice.exitTag?' 第一個回傳值是原始出口編號。':''} 輸入／輸出對照已寫在檔案註解，並保留既有 pattern 所需的結構對照。`);
                status(`MLIR 下載已啟動 · ${size(result.blob.size)} · 已通過本機語法／SSA／dominance 檢查`);
                return;
            }
            notice(result.controlFlow ? `開始下載 @${result.controlFlow.function} 的完整控制流程 MLIR：${result.controlFlow.blocks} 個 blocks、${result.layers} layers。保留分支、迴圈、block arguments、returns 與 custom op 原文。` : `開始下載 ${result.layers} layers 的局部 MLIR；${result.inputs.length} 個輸入、${result.outputs.length} 個輸出。外部 SSA 值已轉為 function arguments；已保留 custom op 原始型別、properties、attributes 與內部連線。`);
            status(`MLIR 下載已啟動 · ${size(result.blob.size)} · 已通過本機語法／SSA／dominance 檢查`);
            return;
        }
        const customInfo = result.preservedIds ? ` 含 custom op：${result.customOperators.join('、')}。保留原始 tensor／buffer 編號及全部 ${result.retainedBuffers} 個 buffers，檔案可能較大；執行需原 custom runtime。` : '';
        notice(`開始下載 ${result.layers} layers；${result.inputs.length} 個輸入、${result.outputs.length} 個輸出。範圍外的中間 tensor 是新輸入；需提供對應數值。${customInfo}`);
        status(`子模型下載已啟動 · ${size(result.blob.size)} · 已保留權重、量化資料與 operator 參數`);
    } catch (error) {
        if(file!==sourceFile) return;
        if(error.validation) showValidation(error.validation);
        else report(error);
    }
    finally { if(file===sourceFile) { exportBusy=false;refreshPickedNodes(); $('export-match').disabled = !canExportSubmodel() || selection?.kind !== 'patterns'; } }
}
function showValidation(validation) {
    $('validation-stage').textContent = `${validation.stage}的檢查未通過，未下載檔案。請依下列位置修正後重新開啟。`;
    $('validation-errors').replaceChildren(...validation.diagnostics.map(item=> {
        const row=element('li');
        const location=item.line ? `第 ${item.line} 行，第 ${item.column || 1} 欄` : '位置未提供';
        row.append(element('strong','',`${location}${item.operator ? ' · '+item.operator : ''}`));
        row.append(element('code','',item.code),element('p','',item.message));
        if(item.excerpt) row.append(element('pre','',item.excerpt));
        return row;
    }));
    $('validation-dialog').showModal();
    status('MLIR 語法／SSA 檢查未通過，已停止匯出。');
}
for(const id of ['close-validation','dismiss-validation']) $(id).onclick=()=> $('validation-dialog').close();
function setPickingPattern(enabled) {
    layerMarquee.cancel();
    if (enabled && (!renderedNodes.length || (!virtualOverview && (renderedGraph?.folded || renderedGraph?.overview)) || $('target').getAttribute('aria-busy') === 'true')) { notice('請先等待模型圖繪製完成；SVG 收合總覽需返回匹配圖，Canvas 可直接框選。'); return; }
    if(enabled && renderedGraph?.combined)$('capture-cfg').checked=true;
    pickingPattern = enabled;
    if(enabled && $('capture-cfg').checked)syncCaptureGraph();
    else if (enabled && pickedGraph !== currentGraph) { pickedNodes.clear(); pickedGraph = currentGraph; }
    $('capture-toolbar').hidden = !enabled;
    $('pick-pattern').setAttribute('aria-pressed', String(enabled));
    document.body.classList.toggle('pattern-picking', enabled);
    if (enabled) {
        view._sidebar.close(); $('tensor-summary').hidden = true;
        if (!$('capture-name').value.trim()) $('capture-name').value = `我的 pattern ${patternLibrary.length + 1}`;
        status('拖曳框選加入 layers，可跨 block；點選取消，Alt＋拖曳平移，Esc 取消正在拖曳的選框。');
    }
    refreshPickedNodes();
    refreshPatternFold();
}
function commitCanvasLayers(nodes,{toggle=false}={}) {
    if(!pickingPattern || $('target').getAttribute('aria-busy')==='true')return;
    const locations=nodes.map(node=>layerLocation({node,index:node.identifier},currentGraph)).filter(Boolean),across=$('capture-cfg').checked;
    const selections=across?cfgSelections:new Map([[pickedGraph,pickedNodes]]);
    try {
        if(!updateLayerSelection(selections,locations,{toggle,scopeForGraph:g=>model.sourceFormat==='mlir'?renderedGraph.captureScopes.get(g):g})){notice('框選後會超過 32 個 layers；已保留原選取，請縮小選框。');return;}
        if(locations.length){setCurrentGraph(locations[0].graph);if(across)syncCaptureGraph();else{pickedGraph=currentGraph;pickedNodes=selections.get(currentGraph);}}
        refreshPickedNodes();status(locations.length?`${toggle?'已切換':'已加入框選範圍內'} ${locations.length} 個原始 layers；跨 block 選取會保留，重複 layers 不重複加入。`:'範圍內沒有可選取的原始 OP；收合節點及控制標記未加入。');
    }catch(error){report(error);}
}
function syncCaptureGraph() {
    if(!cfgSelections.has(currentGraph))cfgSelections.set(currentGraph,pickedGraph===currentGraph?pickedNodes:new Set());
    pickedNodes=cfgSelections.get(currentGraph);pickedGraph=currentGraph;
}
function togglePickedNode(location) {
    if($('capture-cfg').checked) {
        if(!updateLayerSelection(cfgSelections,[location],{toggle:true})){notice('一組 pattern 最多選取 32 個 layers。');return;}
        if(renderedGraph?.combined){setCurrentGraph(location.graph);if(selection?.blocks)renderMatchBlocks(selection);}
        syncCaptureGraph();refreshPickedNodes();return;
    }
    const index=location.node;
    const count=$('capture-cfg').checked ? captureSelections().reduce((n,b)=>n+b.nodes.length,0) : pickedNodes.size;
    if (!pickedNodes.has(index) && count >= 32) { notice('一組 pattern 最多選取 32 個 layers。'); return; }
    if (pickedNodes.has(index)) pickedNodes.delete(index); else pickedNodes.add(index);
    refreshPickedNodes();
}
function captureNodeEvent(event) {
    if (!pickingPattern) return;
    const node = event.target.closest('[data-model-node]');
    if (!node || !$('target').contains(node)) return;
    if (event.type === 'keydown' && !['Enter', ' '].includes(event.key)) return;
    event.preventDefault(); event.stopImmediatePropagation();
    if ($('target').getAttribute('aria-busy') === 'true') return;
    const entry=renderedNodes.find(entry=>String(entry.index)===node.dataset.modelNode),location=entry && layerLocation(entry,currentGraph);
    if(!location){status('這是控制流程顯示標記；請選取原始 operator layer。');return;}
    togglePickedNode(location);
}
const layerMarquee=rectangleSelection($('target'),{
    enabled:()=>pickingPattern && !virtualOverview && $('target').getAttribute('aria-busy')!=='true',
    candidates:()=>renderedNodes.map(entry=>({element:entry.element,location:layerLocation(entry,currentGraph)})).filter(c=>c.element && c.location),
    commit:locations=>{
        const across=$('capture-cfg').checked,selections=across?cfgSelections:new Map([[currentGraph,pickedNodes]]);
        if(!updateLayerSelection(selections,locations)){notice('框選後會超過 32 個 layers；已保留原選取，請縮小選框。');return;}
        if(across)syncCaptureGraph();refreshPickedNodes();
        status(locations.length?`已加入框選範圍內 ${locations.length} 個 layers；重複的 layers 不會重複加入。`:'框選範圍內沒有可選取的 layers。');
    }
});
$('target').addEventListener('click', captureNodeEvent, true);
$('target').addEventListener('keydown', captureNodeEvent, true);
$('pick-pattern').onclick = () => setPickingPattern(!pickingPattern);
$('cancel-capture').onclick = () => setPickingPattern(false);
$('clear-capture').onclick = () => { pickedNodes.clear();cfgSelections.clear();if($('capture-cfg').checked)cfgSelections.set(currentGraph,pickedNodes);refreshPickedNodes(); };
function captureSelections() {return [...cfgSelections].filter(([,set])=>set.size).map(([graph,set])=>({graph,nodes:[...set]}));}
function renderCaptureBlocks() {
    $('capture-blocks').hidden=!$('capture-cfg').checked;
    $('add-capture-block').hidden=!$('capture-cfg').checked;
    $('capture-blocks').replaceChildren(...captureSelections().map(block=>{
        const row=element('div'),button=element('button','text-button',`block ${block.graph} · ${model?.graphs[block.graph]?.name.split('/').at(-1)} · ${block.nodes.length} layers`);
        button.onclick=()=>{if(virtualOverview){setCurrentGraph(block.graph);syncCaptureGraph();virtualOverview.focus(renderedNodes.filter(e=>e.node.sourceGraph===block.graph).map(e=>e.node.identifier));refreshPickedNodes();}else if(renderedGraph?.combined)focusMatchBlock(block.graph);else drawGraph(block.graph,full).catch(report);};
        const remove=element('button','icon-button','×');remove.setAttribute('aria-label',`移除 block ${block.graph} 的選取`);
        remove.onclick=()=>{cfgSelections.get(block.graph)?.clear();refreshPickedNodes();};row.append(button,remove);return row;
    }));
}
$('capture-cfg').onchange=()=>{cfgSelections.clear();if($('capture-cfg').checked)cfgSelections.set(currentGraph,pickedNodes);refreshPickedNodes();};
$('add-capture-block').onclick=()=>{
    if(renderedGraph?.combined){addVisibleLayers(currentGraph);return;}
    const total=captureSelections().reduce((n,b)=>n+b.nodes.length,0),layers=model?.graphs[currentGraph]?.layers || 0;
    if(total+layers-pickedNodes.size>32){notice('加入整個 block 會超過 32 個 operators；請改為點選需要的 layers。');return;}
    for(let n=0;n<layers;n++)pickedNodes.add(n);cfgSelections.set(currentGraph,pickedNodes);refreshPickedNodes();
};
function addVisibleLayers(graph) {
    if(virtualOverview){commitCanvasLayers(virtualOverview.visibleLayers().filter(node=>graph===undefined || node.sourceGraph===graph));return;}
    const locations=renderedNodes.map(entry=>layerLocation(entry,currentGraph)).filter(location=>location && (graph===undefined || location.graph===graph));
    if(!updateLayerSelection(cfgSelections,locations)){notice('加入可見 layers 會超過 32 個 operators；請改為點選需要的 layers。');return;}
    syncCaptureGraph();refreshPickedNodes();
}
$('add-visible-layers').onclick=()=>addVisibleLayers();
$('save-capture').onclick = async () => {
    if ($('target').getAttribute('aria-busy') === 'true') { notice('請等待模型圖繪製完成。'); return; }
    const generation = renderGeneration;
    const graph = currentGraph;
    const fromCanvas=!!virtualOverview;
    $('save-capture').disabled = true;
    try {
        const structure = await rpc('capturePattern', $('capture-cfg').checked ? {selections:captureSelections()} : { graph, nodes: [...pickedNodes] });
        if (!pickingPattern || generation !== renderGeneration || graph !== currentGraph) return;
        const pattern = reusablePattern($('capture-name').value, structure);
        let stored = true;
        try { patternLibrary = savePattern(localStorage, patternLibrary, pattern); }
        catch { stored = false; notice('瀏覽器無法儲存 pattern（儲存空間、權限或數量限制）；已套用，可繼續搜尋。'); }
        refreshPatternLibrary(stored ? pattern.name : '');
        applyPattern(pattern); setPickingPattern(false);
        await runSearch();
        if (page.total) {if(fromCanvas)await drawPatternOverview({active:0});else await selectResult(0);}
        if (stored) status(`已儲存「${pattern.name}」· ${pattern.nodes.length} 節點 · ${pattern.edges.length} 連線 · 找到 ${page.total} 筆匹配`);
    } catch (error) { report(error); }
    finally { refreshPickedNodes(); }
};
$('saved-pattern').onchange = () => {
    updatePatternExport();
    const pattern = patternLibrary.find((item) => item.name === $('saved-pattern').value);
    if (pattern) { applyPattern(pattern); if (model) runSearch().catch(report); }
};
refreshPatternLibrary();

for (const id of ['open-model', 'welcome-open']) $(id).onclick = () => { $('model-file').value = ''; $('model-file').click(); };
$('model-file').onchange = () => { if ($('model-file').files[0]) openFile($('model-file').files[0]); };
$('open-demo').onclick = async () => { try { const r = await fetch('./demo.tflite'); if (!r.ok) throw new Error('無法讀取示範模型。'); await openFile(new File([await r.blob()], '示範模型.tflite')); } catch (error) { report(error); } };
$('open-mlir-demo').onclick = async () => {
    try {
        const r = await fetch('./demo.mlir'); if (!r.ok) throw new Error('無法讀取 MLIR 示範。');
        setKind('layers', false);
        await openFile(new File([await r.blob()], '示範分支.mlir'));
    } catch (error) { report(error); }
};
$('open-lora-demo').onclick = async () => {
    try {
        const r = await fetch('./lora-demo.tflite'); if (!r.ok) throw new Error('無法讀取 LoRA 結構示範。');
        loraPreset(); $('graph-induced').checked = false; $('graph-input-mode').value = 'visual'; updateGraphInputMode();
        setKind('patterns', false);
        await openFile(new File([await r.blob()], 'LoRA 結構示範.tflite'));
    } catch (error) { report(error); }
};
$('cancel-load').onclick = reset; $('close-model').onclick = reset;
document.querySelectorAll('[data-kind]').forEach((button) => button.onclick = () => setKind(button.dataset.kind));
$('query').oninput = () => { clearTimeout(timer); timer = setTimeout(() => runSearch().catch(report), 180); };
$('scope').onchange = () => runSearch().catch(report);
$('run-pattern').onclick = () => runSearch().catch(report);
$('reset-pattern').onclick = () => { chainPreset(); $('graph-induced').checked = false; $('saved-pattern').value = ''; $('graph-input-mode').value = 'visual'; $('graph-pattern').value = 'N1:Reshape -> N2:Transpose -> N3:Reshape'; updateGraphInputMode(); renderPattern(); if (model) runSearch().catch(report); };
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
$('lora-preset').onclick = () => { loraPreset(); $('graph-induced').checked = false; $('saved-pattern').value = ''; $('graph-pattern').value = LORA_PATTERN; $('visual-pattern-editor').open = true; renderVisualPattern(); };
$('add-graph-node').onclick = () => { if (graphNodes.length >= 32) { notice('一組子圖最多 32 個節點。'); return; } graphNodes.push({alias:`N${++graphNodeNumber}`,type:model?.operators[0] || 'Mul'}); renderVisualPattern(); };
$('add-graph-edge').onclick = () => { if (graphNodes.length < 2) { notice('請先加入至少兩個節點。'); return; } if (graphEdges.length >= 64) { notice('一組子圖最多 64 條連線。'); return; } graphEdges.push({from:graphNodes[0].alias,to:graphNodes.at(-1).alias}); renderVisualPattern(); };
$('graph-pattern').oninput = () => { $('pattern-decoded').textContent = '規則已變更，請按「尋找模式」重新解讀與搜尋。'; $('pattern-decoded').classList.remove('missing'); };
$('previous-page').onclick = () => changePage(Math.max(0, page.offset - 100)).catch(report);
$('next-page').onclick = () => changePage(page.offset + 100).catch(report);
$('previous-result').onclick = () => selectResult(activeIndex <= 0 ? page.total - 1 : activeIndex - 1).catch(report);
$('next-result').onclick = () => selectResult(activeIndex < 0 || activeIndex >= page.total - 1 ? 0 : activeIndex + 1).catch(report);
$('graph-select').onchange = async () => {
    try {
        const graph=Number($('graph-select').value);
        if(overviewMode && renderedGraph?.overview) {
            setCurrentGraph(graph);
            const nodes=renderedNodes.filter(e=>e.node.sourceGraph===graph || e.node.sourceGraphs?.includes(graph));
            if(virtualOverview){virtualOverview.focus(nodes.map(e=>e.node.identifier));if(pickingPattern){if($('capture-cfg').checked)syncCaptureGraph();refreshPickedNodes();}status(`已在全模型虛擬總覽定位 subgraph/block ${graph}。`);return;}
            view.target?.scrollTo(nodes.map(e=>e.element).filter(Boolean));status(`已在全模型圖定位 subgraph/block ${graph}。`);return;
        }
        if(renderedGraph?.combined && selection?.blocks?.some(b=>b.graph===graph)){focusMatchBlock(graph);return;}
        if(!pickingPattern && selection?.blocks?.some(b=>b.graph===graph)){await selectResult(activeIndex,{blockGraph:graph});return;}
        await drawGraph(graph, full);
        if ($('scope').value === 'current') await runSearch();
    } catch (error) { report(error); }
};
$('local-graph').onclick = () => {if(renderedGraph?.sliceView)sliceDetails=false;overviewMode=false;$('pattern-overview-controls').hidden=true;(selection ? selectResult(activeIndex, { whole: false,forceDraw:true }) : drawGraph(currentGraph, false)).catch(report);};
$('full-graph').onclick = () => {
    if(renderedGraph?.sliceView)sliceDetails=true;
    if(overviewMode){drawPatternOverview({expanded:new Set(renderedGraph.overviewMatches.filter(m=>m.foldable).map(m=>m.index))}).catch(report);return;}
    const layerCount=selection?.blocks?selection.blocks.reduce((n,b)=>n+model.graphs[b.graph].layers,0):model.graphs[currentGraph].layers;
    if(selection?.blocks && layerCount>1500){notice('相關 blocks 超過 1,500 個 operators；請使用局部圖或縮小 pattern。');return;}
    if (layerCount > 1500 && !fullConfirmed) { fullConfirmed = true; $('full-graph').textContent = '確認繪製完整圖'; notice(`這張圖有 ${layerCount.toLocaleString()} 個節點，完整繪製可能耗時。再次點擊「確認繪製完整圖」即可繼續。`); return; }
    $('full-graph').textContent = '完整圖'; fullConfirmed = false;
    (selection ? selectResult(activeIndex, { whole: true }) : drawGraph(currentGraph, true)).catch(report);
};
$('zoom-in').onclick = () => { if(virtualOverview)virtualOverview.zoom(1.5);else if (view.target) view.zoomIn(); };
$('zoom-out').onclick = () => { if(virtualOverview)virtualOverview.zoom(1/1.5);else if (view.target) view.zoomOut(); };
$('zoom-reset').onclick = () => { if(virtualOverview)virtualOverview.fit();else if (view.target) view.resetZoom(); };
$('graph-font-size').onchange = () => {
    const value = $('graph-font-size').value;
    if (!graphFontSizes.includes(value)) return;
    document.documentElement.style.setProperty('--graph-font-size', `${value}px`);
    try { localStorage.setItem(graphFontKey, value); } catch { /* Apply for this session. */ }
    if (!model || !view.target) return;
    const zoom = view.target.zoom;
    (overviewMode?drawPatternOverview({zoom}):selection ? selectResult(activeIndex, { forceDraw: true, zoom }) : drawGraph(currentGraph, full, zoom)).catch(report);
};
$('direction').onclick = () => {
    if (!view.target) return;
    view.options.direction = view.options.direction === 'vertical' ? 'horizontal' : 'vertical';
    (overviewMode?drawPatternOverview():selection ? selectResult(activeIndex, { forceDraw: true }) : drawGraph(currentGraph, full)).catch(report);
};
$('dismiss-notice').onclick = () => $('notice').hidden = true;
document.addEventListener('dragover', (e) => e.preventDefault());
document.addEventListener('drop', (e) => { e.preventDefault(); if (e.dataTransfer?.files[0]) openFile(e.dataTransfer.files[0]); });
document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && pickingPattern) setPickingPattern(false);
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'f') { e.preventDefault(); if (kind === 'patterns') setKind('layers'); $('query').focus(); }
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'o') { e.preventDefault(); $('open-model').click(); }
});
new MutationObserver(() => document.body.classList.toggle('details-open', $('sidebar').style.opacity === '1')).observe($('sidebar'), { attributes: true, attributeFilter: ['style'] });
new ResizeObserver(()=>document.documentElement.style.setProperty('--capture-space',`${Math.ceil($('capture-toolbar').getBoundingClientRect().height)+24}px`)).observe($('capture-toolbar'));
const viewReady = view.start().then(() => { reset(); renderPattern(); });
await viewReady;
