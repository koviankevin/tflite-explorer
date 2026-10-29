import { Host } from '../vendor/netron/browser.js';
import { View, Attachment } from '../vendor/netron/view.js';
import { hydrate } from './hydrate.js';
import {overviewCanvas} from './overview-canvas.js';
import {resizeInFrame} from './resize-in-frame.js';
import { modelFormat } from './model-formats.js';
import {explorerResize} from './explorer-resize.js';
import {initReleaseInfo} from './release-info.js';
import {initUsageGuide} from './usage-guide-ui.js';
import {dialogKeyboard} from './dialog-keyboard.js';
import {exportReportUI} from './export-report-ui.js';
import {exportedModelUI} from './exported-model-ui.js';
import {modelEditUI} from './model-edit-ui.js';
import {modelEditWorkspaceUI} from './model-edit-workspace-ui.js';
import {modelRuntimeWorkspaceUI} from './model-runtime-workspace-ui.js';
import {modelTabs} from './model-tabs.js';
import {mlirPatternEditor} from './mlir-pattern-editor.js';
import {conditionEditor} from './pattern-condition-editor.js';
import {parseGraphPattern} from './subgraph-pattern.js';
import {WORKSPACE_KEY,LEGACY_WORKSPACE_KEY,DRAFT_FIELDS,WORKSPACE_LIMIT,exportWorkspace,parseWorkspace,checkWorkspace,resultKey,sameResultKey} from './workspace.js';
import {workspaceSessionUI} from './workspace-session-ui.js';
import {draftModelKey} from './workspace-drafts.js';
import {layerLocation,updateLayerSelection} from './pattern-selection.js';
import {rectangleSelection} from './rectangle-selection.js';
import {captureViewport,restoreViewport} from './svg-viewport.js';
import { LORA_PATTERN } from './pattern-utils.js';
import { loadPatterns, reusablePattern, exportPatterns, parsePatternFile, planPatternImport, PATTERN_FILE_LIMIT } from './pattern-library.js';
import {patternStore,PATTERN_CHANNEL} from './pattern-store.js';
import {diagnosticJournal} from './diagnostics.js';
import {diagnosticUI} from './diagnostics-ui.js';

const $ = (id) => document.getElementById(id);
const diagnostics=diagnosticJournal();
let usageGuide;
window.addEventListener('error',event=>diagnostics.record('global','error',event.error));
window.addEventListener('unhandledrejection',event=>diagnostics.record('global','error',event.reason));
const exportReports=exportReportUI({exportFile:(name,blob)=>host.export(name,blob)});
const exportedModels=exportedModelUI({button:$('open-export-model'),open:nextFile=>openFile(nextFile),error:reason=>report(reason)});
const modelEditor=modelEditUI({rpc,getSource:()=>file,getFormat:()=>model?.sourceFormat,onStart:()=>{exportedModels.clear();exportReports.clear();},onBusy:value=>{exportBusy=value;refreshPickedNodes();$('export-match').disabled=value||!canExportSubmodel();},onExport:async(result,name,source)=>{if(!result.roundTrip)throw Error('修改結果尚未重新解析，已停止下載。');if(file!==source)return;await host.export(name,result.blob);if(file!==source)return;exportedModels.remember(result.blob,name);exportReports.set(result.report,name,result.reportError);},openResult:()=>$('open-export-model').click(),downloadReport:()=>exportReports.download(),error:reason=>report(reason)});
let runWorkspace;
const editWorkspace=modelEditWorkspaceUI({rpc,getSource:()=>file,getFormat:()=>model?.sourceFormat,getGraph:()=>currentGraph,getTargets:editTargets,getCompositionTargets:compositionTargets,getCompositionLabel:()=>kind==='patterns'?$('saved-pattern').value||$('condition-pattern-name').value:'',chooseModel:()=>{$('model-file').value='';$('model-file').click();},saveFile:(name,blob)=>host.export(name,blob),onBusy:value=>{exportBusy=value;refreshPickedNodes();$('export-match').disabled=value||!canExportSubmodel();},onExport:async(result,name,source)=>{if(file!==source)return;await host.export(name,result.blob);if(file!==source)return;const token=exportedModels.remember(result.blob,name);exportReports.set(result.report,name,result.reportError);return token;},isCurrentResult:token=>exportedModels.isCurrent(token),openResult:()=>$('open-export-model').click(),downloadReport:()=>exportReports.download(),onMode:()=>runWorkspace?.leave(),isRunning:()=>!!runWorkspace?.active});
runWorkspace=modelRuntimeWorkspaceUI({rpc,getSource:()=>file,getFormat:()=>model?.sourceFormat,leaveEditor:()=>editWorkspace.explore(),saveFile:(name,blob)=>host.export(name,blob)});
const explorer=explorerResize($('explorer-resize'));
let exportBusy = false;
let sessions,queuedDraft=null,lastValidWorkspacePattern=null;
const tabs=modelTabs({capture:captureModelTab,load:loadModelTab,reset,changed:renderModelTabs,error:report,dirty:()=>editWorkspace.hasUnexported,confirmClose:()=>window.confirm('模型分頁有尚未匯出的編輯變更。要放棄並關閉嗎？')});
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
let detailNode=null,detailLocation=null;
view.showNodeProperties = (node, source) => {
    if(node.diagramKind==='pattern'){activatePatternNode(node).catch(report);return;}
    detailNode=node;
    // Sidebar display/chain nodes may have identifier=null. Never coerce that
    // into source OP #0; only the rendered source-location table is authoritative.
    const entry=renderedNodes.find(entry=>entry.node===node);
    detailLocation=entry?layerLocation(entry,currentGraph):null;
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
let patternRevision=0,editorLibrary=[],captureLibrary=[],libraryReady,libraryChannel;
let patternDeleteBusy=false,deletedPattern=null;
try{libraryChannel=new BroadcastChannel(PATTERN_CHANNEL);}catch{/* Focus refresh also works without BroadcastChannel. */}
const libraryStore=patternStore({notify:record=>libraryChannel?.postMessage({revision:record.revision})});
let pickingPattern = false;
let pickedGraph = 0;
let pickedNodes = new Set();
let cfgPattern = null;
const conditionsByAlias=new Map();
let pendingWorkspace=null,workspaceBusy=false,workspaceImport=0;
const cfgSelections = new Map();
let renderedNodes = [];
let renderedGraph = null;
let sliceDetails=false;
let sliceExpanded=new Set();
let slicePages=new Map();
let virtualOverview=null;
function disposeVirtualOverview(){if(virtualOverview){view.target=null;virtualOverview.dispose();virtualOverview=null;}}
try { patternLibrary = loadPatterns(localStorage); } catch { /* Storage may be unavailable; saving will report the error. */ }
function loraPreset() {
    conditionsByAlias.clear();
    $('condition-pattern-name').value='';
    cfgPattern=null;
    graphNodes = ['Mul', 'FullyConnected', 'BatchMatMul', 'BatchMatMul', 'Add'].map((type, i) => ({ alias: `N${i + 1}`, type }));
    graphEdges = [[1, 2], [1, 3], [3, 4], [2, 5], [4, 5]].map(([from, to]) => ({ from: `N${from}`, to: `N${to}` }));
    graphNodeNumber = 5;
}
function chainPreset() {
    conditionsByAlias.clear();
    $('condition-pattern-name').value='';
    cfgPattern=null;
    graphNodes = ['Reshape', 'Transpose', 'Reshape'].map((type, i) => ({ alias: `N${i + 1}`, type }));
    graphEdges = [{ from: 'N1', to: 'N2' }, { from: 'N2', to: 'N3' }];
    graphNodeNumber = 3;
}
chainPreset();
function conditionNodes() {
    if(cfgPattern)return cfgPattern.nodes.filter(n=>n.kind==='operator');
    if($('graph-input-mode').value==='text') {try{return parseGraphPattern($('graph-pattern').value,model?.operators || []).nodes;}catch{return [];}}
    return graphNodes;
}
function currentPattern() {
    const structure=cfgPattern || ($('graph-input-mode').value==='visual'?{nodes:graphNodes,edges:graphEdges,induced:$('graph-induced').checked}:parseGraphPattern($('graph-pattern').value,model?.operators || []));
    return {...structure,induced:cfgPattern?cfgPattern.induced:$('graph-induced').checked,nodes:structure.nodes.map(n=>{const {conditions,...base}=n;const rules=conditionsByAlias.get(n.alias);return {...base,...(rules?.length?{conditions:rules}:{})};})};
}
const conditionUI=conditionEditor({getNodes:conditionNodes,getRules:alias=>conditionsByAlias.get(alias),setRules:(alias,rules)=>{conditionsByAlias.set(alias,rules);status('條件已變更，按「尋找模式」套用。');},error:report});
const cfgEditor=mlirPatternEditor({root:$('cfg-pattern-editor'),getPattern:()=>cfgPattern,getTypes:()=>model?.operators||[],change:pattern=>{
    cfgPattern=pattern;
    const aliases=new Set(pattern.nodes.map(n=>n.alias));for(const alias of conditionsByAlias.keys())if(!aliases.has(alias))conditionsByAlias.delete(alias);
    conditionUI.render();status('跨 block pattern 草稿已變更；按「尋找模式」套用。原模型保持唯讀。');
},error:report});
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
function status(text) { $('status').textContent = text;sessions?.change(); }
function stopWorker() {
    worker?.terminate(); worker = null;
    for (const { reject } of pending.values()) reject(new DOMException('已取消', 'AbortError'));
    pending.clear();
    usageGuide?.refresh();
}
function rpc(action, args = {}) {
    return new Promise((resolve, reject) => {
        const finish=diagnostics.begin(action);
        const fail=error=>{finish(error?.name==='AbortError'?'cancelled':'error',error);reject(error);};
        if (!worker) { fail(new Error('請先開啟模型。')); return; }
        const id = ++requestId;
        pending.set(id, { resolve:data=>{finish(data?.cancelled?'cancelled':'success');resolve(data);},reject:fail });
        usageGuide?.refresh();
        try{worker.postMessage({ id, action, args });}catch(error){pending.delete(id);fail(error);usageGuide?.refresh();}
    });
}
function createWorker() {
    worker = new Worker(new URL('./model-worker.js', import.meta.url), { type: 'module' });
    worker.onmessage = ({ data }) => {
        if (data.stage) { $('loading-stage').textContent = data.stage;status(data.stage);if(data.editDraft)editWorkspace.progress(data.stage);return; }
        const entry = pending.get(data.id);
        if (!entry) return;
        pending.delete(data.id);
        if (data.error) entry.reject(Object.assign(new Error(data.error),{validation:data.validation})); else entry.resolve(data.data);
        usageGuide?.refresh();
    };
    worker.onerror = (event) => { const error = new Error(event.message || '背景解析失敗。');diagnostics.record('worker','error',error); for (const entry of pending.values()) entry.reject(error); pending.clear();usageGuide?.refresh(); };
}
function reset() {
    sessions?.detach();
    runWorkspace.reset();
    editWorkspace.reset();
    detailNode=null;detailLocation=null;modelEditor.clear();
    $('results').setAttribute('aria-busy','false');delete $('results').dataset.searchQuery;
    $('save-workspace').disabled=true;
    sliceExpanded.clear();slicePages.clear();$('slice-connection-controls').hidden=true;
    sliceDetails=false;$('toggle-slice-details').hidden=true;
    disposeVirtualOverview();
    exportBusy = false; $('validation-dialog').close();exportReports.clear();exportedModels.clear();
    ++queryGeneration; ++renderGeneration;
    stopWorker(); model = null; file = null; $('model-file').value=''; selection = null; activeIndex = -1; patternCollapsed=false; $('toggle-pattern-fold').hidden=true;
    editWorkspace.enable(false);runWorkspace.enable(false);
    overviewMode=false;patternSearchReady=false;overviewExpanded.clear();$('fold-all-patterns').hidden=true;$('pattern-overview-controls').hidden=true;
    pickedNodes=new Set();pickedGraph=0;cfgSelections.clear(); $('capture-cfg').checked=false; $('capture-cfg-option').hidden=true; $('match-blocks').hidden=true; renderedNodes = []; renderedGraph = null; setPickingPattern(false);
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
    for (const id of ['pick-pattern', 'graph-select', 'run-pattern', 'run-pattern-laptop', 'local-graph', 'full-graph', 'zoom-in', 'zoom-out', 'zoom-reset', 'direction', 'previous-result', 'next-result']) $(id).disabled = true;
    showPage({ items: [], total: 0, offset: 0 });
    status('準備就緒');
}
async function openFile(nextFile) {
    try { await viewReady; modelFormat(nextFile.name); } catch (error) { diagnostics.record('open','error',error);notice(error.message); return; }
    if(tabs.busy){notice('請等待目前模型載入或切換完成。');return false;}
    return tabs.open(nextFile);
}
async function loadModelTab(nextFile,saved) {
    reset(); file = nextFile;
    const thisFile = file;
    let resumedDraft;
    $('file-name').textContent = file.name; $('file-stats').textContent = `${size(file.size)} · 建立索引中`;
    $('empty-state').hidden = true; $('loading-card').hidden = false; $('cancel-load').hidden = false;
    $('loading-stage').textContent = '讀取模型結構';
    createWorker();
    try {
        const summary = await rpc('open', { file });
        if (file !== thisFile) return;
        model = summary;
        const editable=model.sourceFormat==='tflite';editWorkspace.enable(editable);
        runWorkspace.enable(editable);
        for(const id of ['edit-mode','compose-mode','compose-capture']){$(id).hidden=!editable;$(id).title=editable?(id==='compose-mode'?'將選取或目前匹配加入獨立組合草稿':'編輯實際 TFLite 模型'):'實際模型編輯僅支援 TFLite';}
        if(model.sourceFormat!=='mlir' && cfgPattern && kind==='patterns')setKind('layers',false);
        if(kind==='patterns')try{reusablePattern('開模搜尋',currentPattern());}catch{setKind('layers',false);notice('未完成的 pattern 草稿已保留；先以 Layers 開啟模型，修正規則後再搜尋。');}
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
        if(model.stats.deferredPayloads) $('metrics').textContent+=` · 結構 ${model.stats.structureBytes.toLocaleString()} bytes · ${model.stats.deferredPayloads} 段權重 ${size(model.stats.deferredBytes)} 留在原始檔案`;
        $('scope').replaceChildren(new Option('目前 subgraph（子圖 0）', 'current'), new Option('所有 subgraphs', 'all'), ...model.graphs.map((g) => new Option(`子圖 ${g.index} · ${g.name} · ${g.layers} layers`, String(g.index))));
        $('graph-select').replaceChildren(...model.graphs.map((g) => new Option(`子圖 ${g.index} · ${g.name}`, String(g.index))));
        for (const id of ['pick-pattern', 'query', 'scope', 'graph-select', 'run-pattern', 'run-pattern-laptop', 'local-graph', 'full-graph', 'zoom-in', 'zoom-out', 'zoom-reset', 'direction']) $(id).disabled = false;
        $('cancel-load').hidden = true; $('close-model').hidden = false;
        $('save-workspace').disabled=false;
        renderPattern();
        if(saved){await restoreWorkspace(saved.workspace);await editWorkspace.restoreTab(saved.edit);if(saved.running)runWorkspace.open();return true;}
        if(pendingWorkspace) {
            const workspace=pendingWorkspace,draft=queuedDraft;pendingWorkspace=null;queuedDraft=null;
            try {await restoreWorkspace(workspace);resumedDraft=draft;return true;}
            catch(error){if(file!==thisFile)return;notice(error.message);$('workspace-hint').hidden=true;$('choose-workspace-model').hidden=true;}
        }
        await runSearch();
        if (model.graphs.length && (model.sliceView || (file.size < 1024 * 1024 * 1024 && layers <= 500))) {
            await drawGraph(0, true);
            if(currentGraph!==0 && $('scope').value==='current')await runSearch();
        }
        else {
            // The explorer has a model even before Netron receives a graph.
            // Its automatic page choice would hide mobile search as "welcome".
            view.show('default');
            $('graph-caption').textContent = '索引已就緒 · 選取結果以繪製局部圖';
            status('索引已就緒。請搜尋或選取 layer／tensor，模型圖依需求繪製。');
        }
        return true;
    } catch (error) {
        if (error.name !== 'AbortError') {
            reset(); notice(`無法開啟模型：${error.message}`); status('載入失敗，請重新選擇檔案。');
        }
        return false;
    } finally {
        if (file === thisFile) {
            $('loading-card').hidden = true; $('cancel-load').hidden = true;
            if(model&&sessions)try{const identity=await rpc('workspaceIdentity');if(file===thisFile)await sessions.attach(identity,{resumed:resumedDraft});}catch(error){if(file===thisFile)sessions.fail(error);}
            if(file===thisFile&&model)await editWorkspace.restorePending();
        }
    }
}
function setKind(nextKind, searchNow = true) {
    kind = nextKind;
    $('run-pattern-laptop').hidden=kind!=='patterns';
    document.querySelectorAll('[data-kind]').forEach((button) => {const active=button.dataset.kind===kind;button.setAttribute('aria-selected',String(active));button.tabIndex=active?0:-1;if(active)$('search-controls').setAttribute('aria-labelledby',button.id);});
    $('text-search').hidden = kind === 'patterns'; $('pattern-editor').hidden = kind !== 'patterns';
    renderPattern(); if (model && searchNow) runSearch().catch(report);
}
function renderPattern() {
    conditionUI.render();
    cfgEditor.render();
    updatePatternExport();
    $('graph-pattern-editor').hidden=Boolean(cfgPattern);
    $('cfg-pattern-summary').hidden=!cfgPattern;
    $('pattern-match-hint').textContent=cfgPattern ? '依 SSA ports 與控制流程匹配，包含分支、匯合及迴圈；不比對 block／SSA 名稱。指定的條件需全部符合。' : '依 tensor 直接連接的順序匹配，允許分支；指定的條件需全部符合，未加條件的 OP 不限制參數。';
    if(cfgPattern) $('cfg-pattern-summary').textContent=`跨 block pattern · 比對 SSA ports、block arguments、successor 順序及迴圈；目前範圍會搜尋所在的完整 region。可在結構編輯器調整 OP、block 歸屬及連線；原模型保持唯讀。`;
    else renderVisualPattern();
}
function suspendResults(){
    $('results').setAttribute('aria-busy','true');$('result-count').textContent='搜尋中…';
    for(const button of $('results').querySelectorAll('button'))button.disabled=true;
    for(const id of ['previous-page','next-page','previous-result','next-result'])$(id).disabled=true;
}
async function runSearch() {
    if (!model) return;
    const generation = ++queryGeneration;
    const searchQuery=$('query').value;suspendResults();
    overviewMode=false;patternSearchReady=false;overviewExpanded.clear();$('pattern-overview-controls').hidden=true;
    activeIndex = -1;
    selection = null;
    refreshPatternFold();
    $('match-blocks').hidden=true;
    $('export-match').hidden = true;
    status(kind === 'patterns' ? '搜尋連接模式中…' : '搜尋中…');
    $('result-count').textContent = '搜尋中…';
    const structure = kind==='patterns' ? currentPattern() : null;
    const scope = $('scope').value === 'current' ? String(currentGraph) : $('scope').value;
    const result = await rpc(kind === 'patterns' ? 'subgraphPattern' : 'search', kind === 'patterns' ? { text: $('graph-pattern').value, structure, induced: $('graph-induced').checked, scope } : { kind, query: searchQuery, scope });
    if (generation !== queryGeneration || result.cancelled) return;
    if (result.decodedNodes) {
        const missing = result.decodedNodes.filter((node) => !node.present);
        $('pattern-decoded').textContent = '解讀：' + result.decodedNodes.map((node) => `${node.alias}:${node.type}`).join(' · ') + (missing.length ? `。模型中沒有：${[...new Set(missing.map((node) => node.type))].join('、')}` : '');
        $('pattern-decoded').classList.toggle('missing', missing.length > 0);
    }
    patternSearchReady=kind==='patterns';showPage(result,searchQuery);refreshPatternFold();
    if (structure && result.total) $('visual-pattern-editor').open = false;
    if (result.searchLimited) notice('搜尋已達計算上限，結果可能不完整；請指定 subgraph 或加入更明確的 operator 限制。');
    status(`找到 ${result.total.toLocaleString()} 筆${kind === 'patterns' ? '路徑' : '結果'}${result.searchLimited ? '（已達計算上限，結果可能不完整）' : result.truncated ? '（已達 50,000 筆上限，請縮小範圍）' : ''}`);
}
function showPage(result,searchQuery=$('query').value) {
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
    $('results').dataset.searchQuery=searchQuery;$('results').setAttribute('aria-busy','false');
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
            if($('target').getAttribute('aria-busy')==='true')return;
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
async function changeSliceExpansion(next,{key,segment,point,page}={}) {
    const connection=key?.split('>') || [],preferred=[...new Set([segment?.from,segment?.to,...connection].filter(Boolean))];
    const entries=viewportEntries().filter(e=>preferred.length || renderedGraph.nodes.get(e.id)?.diagramKind==='operator');
    const viewport=captureViewport($('target'),view.target?.zoom,entries,{preferred,point});
    const previous=sliceExpanded,previousPages=new Map(slicePages);sliceExpanded=next;
    if(Number.isInteger(page))slicePages.set(key,page);
    for(const key of slicePages.keys())if(!next.has(key))slicePages.delete(key);
    try {await (selection?selectResult(activeIndex,{forceDraw:true,viewport}):drawGraph(currentGraph,full,undefined,viewport));}
    catch(error){sliceExpanded=previous;slicePages=previousPages;throw error;}
}
function renderSliceConnections(dto) {
    const nav=$('slice-connection-controls'),connections=dto.compactSlice && !dto.folded && !dto.overview ? dto.sliceConnections || [] : [];
    sliceExpanded=new Set(connections.filter(c=>c.expanded).map(c=>c.key));nav.hidden=!sliceExpanded.size;
    slicePages=new Map(connections.filter(c=>c.expanded).map(c=>[c.key,c.pending?(slicePages.get(c.key) ?? c.page):c.page]));
    nav.replaceChildren(element('strong','',`局部展開 · ${sliceExpanded.size} 段路徑`));
    for(const c of connections.filter(c=>c.expanded)) {
        if(c.pending) {
            const more=element('button','quiet',`繼續分析：${c.label}`);more.dataset.connectionKey=c.key;
            more.onclick=()=>changeSliceExpansion(new Set(sliceExpanded),{key:c.key}).catch(report);nav.append(more);
        } else if(c.pages>1) {
            const row=element('div','slice-page-controls');row.dataset.connectionKey=c.key;
            row.append(element('span','',`${c.label} · 第 ${c.page+1} / ${c.pages} 段（本段 ${c.shown}／共 ${c.helpers} 個輔助節點）`));
            for(const [label,offset] of [['上一段',-1],['下一段',1]]) {
                const button=element('button','quiet',label),page=c.page+offset;
                button.dataset.unavailable=String(page<0 || page>=c.pages);button.disabled=button.dataset.unavailable==='true';
                button.onclick=()=>changeSliceExpansion(new Set(sliceExpanded),{key:c.key,page,segment:{from:offset>0?c.pageEnd:c.pageStart}}).catch(report);row.append(button);
            }
            nav.append(row);
        }
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
    for(const button of $('slice-connection-controls').querySelectorAll('button'))button.disabled=button.dataset.unavailable==='true' || $('target').getAttribute('aria-busy')==='true';
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
    activeIndex=index;selection=item;setCurrentGraph(item.graph);editWorkspace.selectionChanged();
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
    if(collapsed){sliceExpanded.clear();slicePages.clear();}
    await selectResult(activeIndex,{forceDraw:true});
}
$('toggle-pattern-fold').onclick=()=>togglePatternFold().catch(report);
$('toggle-slice-details').onclick=()=>{
    sliceDetails=!sliceDetails;
    if(!sliceDetails){sliceExpanded.clear();slicePages.clear();}
    (selection?selectResult(activeIndex,{forceDraw:true}):drawGraph(currentGraph,full)).catch(report);
};
async function selectResult(index, { whole, forceDraw = false, zoom, blockGraph,viewport } = {}) {
    if (!model || !page.total) return;
    const generation = queryGeneration;
    if (index < page.offset || index >= page.offset + page.items.length) await changePage(Math.floor(index / 100) * 100);
    if (generation !== queryGeneration) return;
    const item = page.items[index - page.offset];
    detailLocation=null;
    if (!item) return;
    if(overviewMode && renderedGraph?.overview && !forceDraw){focusOverviewMatch(item,index);return;}
    whole ??= item.blocks && !selection?.blocks ? false : full;
    if(item===selection && blockGraph!==undefined && renderedGraph?.combined && !forceDraw && whole===full){focusMatchBlock(blockGraph);return;}
    const targetGraph=blockGraph ?? (item===selection && item.blocks?.some(b=>b.graph===currentGraph) ? currentGraph : item.graph);
    activeIndex = index; selection = item; full = whole;
    editWorkspace.selectionChanged();
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
    const dto = await rpc('select', { item, full: whole, metadataOnly, blockGraph:targetGraph, boundaryContext:true, collapsed, patternName, sliceDetails, expandedConnections:[...sliceExpanded], connectionPages:Object.fromEntries(slicePages) });
    await queueDraw(dto, generationRender, zoom,viewport);
}
async function drawGraph(graph, whole = false, zoom,viewport) {
    if (!model) return;
    setCurrentGraph(graph); full = whole; selection = null;editWorkspace.selectionChanged();
    overviewMode=false;$('pattern-overview-controls').hidden=true;
    refreshPatternFold();
    $('match-blocks').hidden=true;
    $('export-match').hidden = true;
    const generation = ++renderGeneration;
    $('target').setAttribute('aria-busy', 'true');
    status(whole ? '繪製完整圖…' : '繪製局部圖…');
    const dto = await rpc('graph', { graph, full: whole, sliceDetails, expandedConnections:[...sliceExpanded], connectionPages:Object.fromEntries(slicePages) });
    await queueDraw(dto, generation, zoom,viewport);
}
async function queueDraw(dto, generation, zoom,viewport) {
    renderQueue = renderQueue.catch(() => {}).then(async () => {
        if (generation !== renderGeneration || !model) return;
        const finish=diagnostics.begin('layout');
        try {
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
                // Cross-block changes already update cfgSelections directly.
                // Never flush a stale local buffer under its previous graph:
                // after Clear/reflow that can alias two blocks to the same Set.
                if($('capture-cfg').checked) {pickedNodes=cfgSelections.get(currentGraph) || new Set();cfgSelections.set(currentGraph,pickedNodes);}
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
        }catch(error){finish('error',error);throw error;}
        finally{finish(generation===renderGeneration?'success':'cancelled');}
    });
    try { await renderQueue; }
    finally { if (generation === renderGeneration) { $('target').setAttribute('aria-busy', 'false'); refreshPatternFold(); } }
}
async function activateOverviewNode(node) {
    if(node.diagramKind==='pattern'){const source=file,query=queryGeneration;await activatePatternNode(node);if(file===source&&query===queryGeneration&&overviewMode&&virtualOverview)return $('target').querySelector('.overview-canvas');return;}
    if(pickingPattern){if(node.diagramKind==='operator')commitCanvasLayers([node],{toggle:true});else status('這是控制流程／邊界顯示標記，未加入 pattern；請選取原始 OP。');return;}
    if(node.diagramKind!=='operator')return;
    const controller=virtualOverview,generation=renderGeneration;
    const detail=await rpc('overviewNode',{graph:node.sourceGraph,node:node.sourceNode});
    if(!controller || controller!==virtualOverview || generation!==renderGeneration)return;
    hydrate(detail,file);view.showNodeProperties(detail,'sidebar');
    detailLocation={graph:node.sourceGraph,node:node.sourceNode};
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
function report(error) { if (error.name !== 'AbortError') { diagnostics.record('ui','error',error);$('target').setAttribute('aria-busy', 'false'); notice(error.message); status('操作未完成，請調整後重試。'); } }

function refreshPatternLibrary(selectedName = '') {
    $('saved-pattern').replaceChildren(new Option('選擇已儲存的 pattern…', ''), ...patternLibrary.map((pattern) => new Option(pattern.name, pattern.name)));
    $('saved-pattern').value = selectedName;
    updatePatternExport();
}
function acceptPatternLibrary(record) {
    if(record.revision<patternRevision)return;
    patternRevision=record.revision;patternLibrary=record.patterns;
    refreshPatternLibrary($('saved-pattern').value);
}
async function refreshStoredPatterns({remote=false}={}) {
    try {
        const record=await libraryStore.load(),changed=record.revision>patternRevision;
        acceptPatternLibrary(record);
        if(changed && remote)$('pattern-library-status').textContent='另一分頁已更新清單；目前編輯與圈選保留。同名內容不同時會另存副本。';
        return record;
    }catch(error){diagnostics.record('pattern-read','error',error);$('pattern-library-status').textContent=error.message;throw error;}
}
if(libraryChannel)libraryChannel.onmessage=event=>{
    if(Number.isSafeInteger(event.data?.revision) && event.data.revision>patternRevision)refreshStoredPatterns({remote:true}).catch(()=>{});
};
window.addEventListener('focus',()=>{if(libraryReady)refreshStoredPatterns({remote:true}).catch(()=>{});});
window.addEventListener('storage',event=>{
    if(['model-lens.patterns.v1','model-lens.patterns.v2','model-lens.patterns.v3'].includes(event.key))$('pattern-library-status').textContent='舊版分頁更新了舊清單；新版清單未覆蓋它。請從舊分頁匯出 JSON，再於此匯入合併。';
});
async function saveStoredPattern(pattern,base) {
    await (libraryReady || refreshStoredPatterns()).catch(()=>refreshStoredPatterns());
    const result=await diagnostics.track('pattern-save',()=>libraryStore.save(pattern,base));acceptPatternLibrary(result.record);
    $('pattern-library-status').textContent=result.conflict?`同名 pattern 已被其他分頁修改；已保留原項目，另存為「${result.pattern.name}」。`:`已保存「${result.pattern.name}」· 本機清單第 ${result.record.revision} 版`;
    return result;
}
function updatePatternExport() {
    $('export-pattern').disabled = !patternLibrary.some((pattern) => pattern.name === $('saved-pattern').value);
    $('export-patterns').disabled = !patternLibrary.length;
    $('delete-pattern').disabled=patternDeleteBusy||$('export-pattern').disabled;
    $('undo-delete-pattern').hidden=!deletedPattern;$('undo-delete-pattern').disabled=patternDeleteBusy;
}
$('delete-pattern').onclick=async()=>{
    const pattern=patternLibrary.find(p=>p.name===$('saved-pattern').value);if(!pattern||patternDeleteBusy)return;
    patternDeleteBusy=true;updatePatternExport();
    try{const result=await diagnostics.track('pattern-delete',()=>libraryStore.remove(pattern));acceptPatternLibrary(result.record);deletedPattern=result.removed?result.pattern:null;refreshPatternLibrary('');$('pattern-library-status').textContent=result.removed?`已刪除「${pattern.name}」；目前查詢保留，可按「復原刪除」。`:'此 pattern 已不在已儲存清單；目前查詢保留。';}
    catch(error){await refreshStoredPatterns().catch(()=>{});$('pattern-library-status').textContent=error.message;}
    finally{patternDeleteBusy=false;updatePatternExport();}
};
$('undo-delete-pattern').onclick=async()=>{
    if(!deletedPattern||patternDeleteBusy)return;const pattern=deletedPattern;patternDeleteBusy=true;updatePatternExport();
    try{const result=await libraryStore.save(pattern,[]);acceptPatternLibrary(result.record);deletedPattern=null;refreshPatternLibrary('');$('pattern-library-status').textContent=result.conflict?`同名項目已更新，已另存復原為「${result.pattern.name}」；目前查詢保留。`:`已復原「${result.pattern.name}」；目前查詢保留。`;}
    catch(error){$('pattern-library-status').textContent=error.message;}
    finally{patternDeleteBusy=false;updatePatternExport();}
};
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
$('confirm-import').onclick = async () => {
    const generation=importGeneration,text=$('import-json').value;
    $('confirm-import').disabled=true;
    try {
        await (libraryReady || refreshStoredPatterns()).catch(()=>refreshStoredPatterns());
        const selectedName = $('saved-pattern').value;
        const plan = await diagnostics.track('pattern-import',()=>libraryStore.import(text));
        acceptPatternLibrary(plan.record);refreshPatternLibrary(selectedName);
        if(generation===importGeneration){++importGeneration;$('import-dialog').close();}
        $('pattern-library-status').textContent=`已合併匯入 · 本機清單第 ${plan.record.revision} 版`;
        status(`已匯入 ${plan.added.length} 組 patterns · 略過 ${plan.skipped} 組 · 更名 ${plan.renamed} 組。從已儲存清單選擇即可套用。`);
    } catch (error) { if(generation===importGeneration)importError(error); }
};
function applyPattern(pattern) {
    editorLibrary=patternLibrary.filter(p=>p.name!==pattern.name);
    if(pattern.name)editorLibrary.push(pattern);
    conditionsByAlias.clear();for(const node of pattern.nodes)if(node.conditions?.length)conditionsByAlias.set(node.alias,node.conditions);
    $('condition-pattern-name').value=pattern.name || '';
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
    editWorkspace.selectionChanged();
    const cfg=model?.graphs[($('capture-cfg').checked?captureSelections()[0]?.graph:undefined) ?? currentGraph]?.cfgExport;
    const across=$('capture-cfg').checked,count=across ? [...cfgSelections.values()].reduce((n,set)=>n+set.size,0) : pickedNodes.size;
    $('capture-cfg').disabled=!!renderedGraph?.combined;
    $('add-visible-layers').hidden=!renderedGraph?.combined;
    $('add-capture-block').textContent=renderedGraph?.combined?'加入此 block 可見 layers':'加入目前 block 全部 layers';
    $('capture-hint').textContent=virtualOverview?'Canvas 拖曳框選切換原始 OP（已選取消、未選加入），可跨 blocks；Alt＋拖曳平移，滾輪縮放，點選加入／取消。鍵盤 Tab 到節點，Enter／Space 切換；方向鍵平移，＋／－縮放。綠色為已選；收合節點點開後再選，控制標記不加入。':renderedGraph?.combined?`拖曳框選切換 layers（已選取消、未選加入），可跨 block；點選可加入／取消，Alt＋拖曳平移。${renderedGraph.compactSlice?'點連線可展開／收起，已選 layers 會保留。':''}綠色為已選取；控制標記不會存入 pattern。`:'拖曳框選切換 layers（已選取消、未選加入）；點選可加入／取消，Alt＋拖曳平移。';
    $('add-visible-layers').textContent=virtualOverview?'加入視窗內 layers':'選取圖中全部 layers';
    const whole=$('mlir-export-scope').value==='function';
    $('capture-count').textContent = `已選取 ${count} 個 layers${across ? ` · ${[...cfgSelections.values()].filter(s=>s.size).length} 個 blocks` : ''}${cfg ? whole ? ` · MLIR 匯出保留 @${cfg.function} 的完整 ${cfg.blocks} 個 blocks` : ' · 局部匯出將補足必要的控制節點與迴圈運算' : ''}`;
    if(model?.capabilities?.mlirExport) {
        $('export-submodel').textContent=cfg && whole ? '匯出完整控制流程 MLIR' : '匯出局部 MLIR';
        const matched=model.graphs[selection?.graph]?.cfgExport;
        $('export-match').textContent=matched && whole ? `匯出匹配所在 function（${matched.blocks} blocks）↓` : '匯出此匹配為局部 MLIR ↓';
    }
    $('save-capture').disabled = !model || count < (across ? 1 : 2);
    $('edit-capture').disabled = $('save-capture').disabled;
    $('edit-capture').textContent = '編輯選取 pattern';
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
    const sourceFile = file,opener=document.activeElement;
    const mlir = model.capabilities.mlirExport;
    exportBusy = true;
    exportedModels.clear();
    $('export-submodel').disabled = true;
    $('export-match').disabled = true;
    try {
        status(mlir ? '擷取局部 MLIR，保留原始型別、屬性與 SSA 連線…' : '建立 TFLite 子模型，保留所需權重與參數…');
        const outputName=`${sourceFile.name.replace(/\.[^.]+$/, '')}-submodel.${mlir ? 'mlir' : 'tflite'}`;
        const result = await rpc(mlir ? 'exportMLIR' : 'exportTflite', { graph, nodes, outputName, ...(mlir ? {scope:$('mlir-export-scope').value,selections}: {}) });
        if (file !== sourceFile) return;
        await host.export(outputName, result.blob);
        if(file!==sourceFile)return;
        exportedModels.remember(result.blob,outputName);
        exportReports.set(result.report,outputName,result.reportError);
        if (mlir) {
            const checks=result.validation?.deferredPayloads ? '結構語法／SSA／dominance 已檢查；大型權重保留原文，未逐值驗證' : '已通過本機語法／SSA／dominance 檢查';
            if(result.slice) {
                const added=result.slice.added.length ? ` 補入迴圈必要運算：${[...new Set(result.slice.added)].join('、')}（${result.slice.added.length} 個）。` : '';
                const conditional=result.slice.conditionalOutputs ? ` ${result.slice.conditionalOutputs} 個條件輸出以 (valid, value) 回傳；未執行時 valid=false，需提供同型別備援輸入。` : '';
                notice(`已匯出 ${result.slice.selected} 個選取 layers 的局部 MLIR，含 ${result.slice.blocks} 個控制流程 blocks、${result.inputs.length} 個輸入、${result.outputs.length} 個資料輸出。${added}${conditional}${result.slice.exitTag?' 第一個回傳值是原始出口編號。':''} 輸入／輸出對照已寫在檔案註解，並保留既有 pattern 所需的結構對照。`);
                status(`MLIR 下載已啟動 · ${size(result.blob.size)} · ${checks}`);
                return;
            }
            notice(result.controlFlow ? `開始下載 @${result.controlFlow.function} 的完整控制流程 MLIR：${result.controlFlow.blocks} 個 blocks、${result.layers} layers。保留分支、迴圈、block arguments、returns 與 custom op 原文。` : `開始下載 ${result.layers} layers 的局部 MLIR；${result.inputs.length} 個輸入、${result.outputs.length} 個輸出。外部 SSA 值已轉為 function arguments；已保留 custom op 原始型別、properties、attributes 與內部連線。`);
            status(`MLIR 下載已啟動 · ${size(result.blob.size)} · ${checks}`);
            return;
        }
        const customInfo = result.preservedIds ? ` 含 custom op：${result.customOperators.join('、')}。保留原始 tensor／buffer 編號及全部 ${result.retainedBuffers} 個 buffers，檔案可能較大；執行需原 custom runtime。` : '';
        notice(`開始下載 ${result.layers} layers；${result.inputs.length} 個輸入、${result.outputs.length} 個輸出。範圍外的中間 tensor 是新輸入；需提供對應數值。${customInfo}`);
        status(`子模型下載已啟動 · ${size(result.blob.size)} · 已保留權重、量化資料與 operator 參數`);
    } catch (error) {
        if(file!==sourceFile) return;
        if(error.validation) showValidation(error.validation,opener);
        else report(error);
    }
    finally { if(file===sourceFile) { exportBusy=false;refreshPickedNodes(); $('export-match').disabled = !canExportSubmodel() || selection?.kind !== 'patterns'; } }
}
function showValidation(validation,opener) {
    const dialog=$('validation-dialog'),source=file;
    $('validation-stage').textContent = `${validation.stage}的檢查未通過，未下載檔案。請依下列位置修正後重新開啟。`;
    $('validation-errors').replaceChildren(...validation.diagnostics.map(item=> {
        const row=element('li');
        const location=item.line ? `第 ${item.line} 行，第 ${item.column || 1} 欄` : '位置未提供';
        row.append(element('strong','',`${location}${item.operator ? ' · '+item.operator : ''}`));
        row.append(element('code','',item.code),element('p','',item.message));
        if(item.excerpt) row.append(element('pre','',item.excerpt));
        return row;
    }));
    // The export control was disabled during async validation, so native dialog
    // restoration can retain focus on its now-hidden close button. Restore the
    // original live control after close, without stealing a later user focus.
    dialog.addEventListener('close',()=>{const active=document.activeElement;if(file===source&&opener?.isConnected&&!opener.disabled&&(active===document.body||dialog.contains(active)||active===opener))opener.focus({preventScroll:true});},{once:true});
    dialog.showModal();
    status('MLIR 語法／SSA 檢查未通過，已停止匯出。');
}
for(const id of ['close-validation','dismiss-validation']) $(id).onclick=()=> $('validation-dialog').close();
function setPickingPattern(enabled) {
    layerMarquee.cancel();
    if (enabled && (!renderedNodes.length || (!virtualOverview && (renderedGraph?.folded || renderedGraph?.overview)) || $('target').getAttribute('aria-busy') === 'true')) { notice('請先等待模型圖繪製完成；SVG 收合總覽需返回匹配圖，Canvas 可直接框選。'); return; }
    if(enabled && renderedGraph?.combined)$('capture-cfg').checked=true;
    if(enabled && !pickingPattern)captureLibrary=patternLibrary.slice();
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
    candidates:()=>renderedNodes.map(entry=>{const location=layerLocation(entry,currentGraph);return {element:entry.element,location,selected:!!location&&!!($('capture-cfg').checked?cfgSelections.get(location.graph):pickedNodes)?.has(location.node)};}).filter(c=>c.element && c.location),
    commit:locations=>{
        const across=$('capture-cfg').checked,selections=across?cfgSelections:new Map([[currentGraph,pickedNodes]]);
        if(!updateLayerSelection(selections,locations,{toggle:true})){notice('框選後會超過 32 個 layers；已保留原選取，請縮小選框。');return;}
        if(across)syncCaptureGraph();refreshPickedNodes();
        status(locations.length?`已切換框選範圍內 ${locations.length} 個 layers；已選的取消，未選的加入。`:'框選範圍內沒有可選取的 layers。');
    }
});
$('target').addEventListener('click', captureNodeEvent, true);
$('target').addEventListener('keydown', captureNodeEvent, true);
$('pick-pattern').onclick = () => setPickingPattern(!pickingPattern);
$('cancel-capture').onclick = () => setPickingPattern(false);
$('clear-capture').onclick = () => { pickedNodes=new Set();pickedGraph=currentGraph;cfgSelections.clear();if($('capture-cfg').checked)cfgSelections.set(currentGraph,pickedNodes);refreshPickedNodes(); };
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
function compositionTargets(){
    if(!pickingPattern&&selection?.kind==='patterns'&&Array.isArray(selection.path))return [...new Set(selection.path)].map(node=>({graph:selection.graph,node}));
    return editTargets();
}
function editTargets(){
    let targets=pickingPattern?($('capture-cfg').checked?captureSelections().flatMap(s=>s.nodes.map(node=>({graph:s.graph,node}))):[...pickedNodes].map(node=>({graph:pickedGraph,node}))):[];
    if(!targets.length&&!pickingPattern){const location=detailLocation||(selection?.kind==='layers'?{graph:selection.graph,node:selection.index}:null);if(location)targets=[location];}
    return targets;
}
$('edit-advanced').onclick=()=>{const location=editWorkspace.advancedLocation();if(model?.sourceFormat==='tflite'&&location&&!exportBusy)modelEditor.open([location]).catch(report);};
$('edit-capture').onclick = async () => {
    if ($('target').getAttribute('aria-busy') === 'true') { notice('請等待模型圖繪製完成。'); return; }
    const generation=renderGeneration,sourceFile=file,graph=currentGraph;
    const payload=()=>$('capture-cfg').checked ? {selections:captureSelections()} : {graph:currentGraph,nodes:[...pickedNodes]};
    const selected=payload(),signature=JSON.stringify(selected),base=captureLibrary.slice();
    $('edit-capture').disabled=true;
    try {
        const structure=await rpc('capturePattern',selected);
        // A result from an old file, drawing or selection must not replace a
        // newer query draft. Capturing does not save or start a search.
        if(file!==sourceFile || !pickingPattern || generation!==renderGeneration || graph!==currentGraph || signature!==JSON.stringify(payload()))return;
        const pattern=reusablePattern($('capture-name').value,structure);
        applyPattern(pattern);editorLibrary=base;$('saved-pattern').value='';updatePatternExport();
        setPickingPattern(false);
        if(cfgPattern)cfgEditor.focus();
        else {$('visual-pattern-editor').open=true;$('graph-node-rows').querySelector('select').focus();}
        status('已將圈選結果載入結構編輯器；可調整 pattern 節點及連線，按「尋找模式」套用。原模型保持唯讀。');
    } catch(error) { if(file===sourceFile)report(error); }
    finally { refreshPickedNodes(); }
};
$('save-capture').onclick = async () => {
    if ($('target').getAttribute('aria-busy') === 'true') { notice('請等待模型圖繪製完成。'); return; }
    const generation = renderGeneration;
    const graph = currentGraph;
    const fromCanvas=!!virtualOverview;
    $('save-capture').disabled = true;
    try {
        const structure = await rpc('capturePattern', $('capture-cfg').checked ? {selections:captureSelections()} : { graph, nodes: [...pickedNodes] });
        if (!pickingPattern || generation !== renderGeneration || graph !== currentGraph) return;
        let pattern = reusablePattern($('capture-name').value, structure);
        let stored = true;
        try { pattern=(await saveStoredPattern(pattern,captureLibrary)).pattern; }
        catch (error) { stored = false; notice(`${error.message} 已保留目前結構，可繼續搜尋或下載工作階段備份。`); }
        if(!pickingPattern || generation!==renderGeneration || graph!==currentGraph)return;
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
async function openDemo(){const r=await fetch('./demo.tflite');if(!r.ok)throw new Error('無法讀取示範模型。');return openFile(new File([await r.blob()],'示範模型.tflite'));}
$('open-demo').onclick=()=>openDemo().catch(report);
async function openMLIRDemo(){const r=await fetch('./demo.mlir');if(!r.ok)throw new Error('無法讀取 MLIR 示範。');setKind('layers',false);return openFile(new File([await r.blob()],'示範分支.mlir'));}
$('open-mlir-demo').onclick=()=>openMLIRDemo().catch(report);
$('open-lora-demo').onclick = async () => {
    try {
        const r = await fetch('./lora-demo.tflite'); if (!r.ok) throw new Error('無法讀取 LoRA 結構示範。');
        loraPreset(); $('graph-induced').checked = false; $('graph-input-mode').value = 'visual'; updateGraphInputMode();
        setKind('patterns', false);
        await openFile(new File([await r.blob()], 'LoRA 結構示範.tflite'));
    } catch (error) { report(error); }
};
async function captureModelTab(){
    if(!workspaceReady())throw Error('請等待搜尋、繪圖或匯出完成後再切換模型分頁。');
    const source=file,edit=editWorkspace.captureTab(),identity=await rpc('workspaceIdentity');
    if(file!==source)throw new DOMException('已取消','AbortError');
    const workspace=parseWorkspace(exportWorkspace(captureSession(identity)));
    return {workspace,edit,running:runWorkspace.active};
}
function renderModelTabs(state){
    $('model-tabs').hidden=!state.tabs.length;
    $('model-tabs').setAttribute('aria-busy',String(state.busy));
    if(!state.busy)sessions?.change();
    for(const selector of ['#explorer-panel','#target','#edit-workspace','#run-workspace','.graph-bar','#capture-toolbar','.model-modes','#open-model','#close-model']){const node=document.querySelector(selector);if(node)node.inert=state.busy;}
    $('model-tab-list').replaceChildren(...state.tabs.map(item=>{
        const group=document.createElement('div');group.className='model-tab';const tab=document.createElement('button');tab.type='button';tab.id=`model-tab-${item.id}`;tab.dataset.modelTab=String(item.id);tab.setAttribute('role','tab');tab.setAttribute('aria-selected',String(item.id===state.current));tab.tabIndex=item.id===state.current?0:-1;tab.textContent=item.name;tab.title=`${item.name}（背景分頁切回時重新讀取本機檔案）`;tab.disabled=state.busy;tab.onclick=async()=>{await tabs.activate(item.id);$(`model-tab-${item.id}`)?.focus();};
        const close=document.createElement('button');close.type='button';close.className='close-model-tab';close.textContent='×';close.setAttribute('aria-label',`關閉 ${item.name}`);close.disabled=state.busy;close.onclick=()=>tabs.close(item.id).catch(report);group.append(tab,close);return group;
    }));
}
$('model-tab-list').addEventListener('keydown',event=>{
    if(event.ctrlKey||event.metaKey||event.altKey)return;const items=[...$('model-tab-list').querySelectorAll('[role=tab]')],index=items.indexOf(event.target);if(index<0)return;const next=event.key==='ArrowRight'?(index+1)%items.length:event.key==='ArrowLeft'?(index+items.length-1)%items.length:event.key==='Home'?0:event.key==='End'?items.length-1:-1;if(next<0)return;event.preventDefault();event.stopPropagation();items.forEach((tab,i)=>{tab.tabIndex=i===next?0:-1;});items[next].focus();
});
$('model-tab-list').addEventListener('focusout',event=>{if(!$('model-tab-list').contains(event.relatedTarget))for(const tab of $('model-tab-list').querySelectorAll('[role=tab]'))tab.tabIndex=tab.getAttribute('aria-selected')==='true'?0:-1;});
resizeInFrame(document.querySelector('.app-header'),()=>document.documentElement.style.setProperty('--head',`${Math.ceil(document.querySelector('.app-header').getBoundingClientRect().height)}px`));
window.addEventListener('beforeunload',event=>{if(tabs.hasUnexported){event.preventDefault();event.returnValue='';}});
$('cancel-load').onclick = ()=>tabs.cancel(); $('close-model').onclick = ()=>tabs.closeAll();
document.querySelectorAll('[data-kind]').forEach((button) => button.onclick = () => setKind(button.dataset.kind));
const searchTabs=document.querySelector('#explorer-panel [role="tablist"]');
searchTabs.addEventListener('keydown',event=>{
    if(event.defaultPrevented||event.isComposing||event.ctrlKey||event.metaKey||event.altKey||event.shiftKey)return;
    const tabs=[...searchTabs.querySelectorAll('[role="tab"]')],index=tabs.indexOf(event.target);
    if(index<0)return;
    const next=event.key==='ArrowRight'?(index+1)%tabs.length:event.key==='ArrowLeft'?(index+tabs.length-1)%tabs.length:event.key==='Home'?0:event.key==='End'?tabs.length-1:-1;
    if(next<0)return;event.preventDefault();event.stopPropagation();
    // Focus navigation is cheap; native Enter/Space activates the button and
    // starts a search only after the user confirms the desired category.
    tabs.forEach((tab,i)=>{tab.tabIndex=i===next?0:-1;});tabs[next].focus();
});
searchTabs.addEventListener('focusout',event=>{if(!searchTabs.contains(event.relatedTarget))for(const tab of searchTabs.querySelectorAll('[role="tab"]'))tab.tabIndex=tab.getAttribute('aria-selected')==='true'?0:-1;});
for(const dialog of document.querySelectorAll('dialog'))dialogKeyboard(dialog);
$('query').oninput = () => { clearTimeout(timer);++queryGeneration;if(model)suspendResults();timer = setTimeout(() => runSearch().catch(report), 180); };
$('scope').onchange = () => runSearch().catch(report);
$('run-pattern').onclick = () => runSearch().catch(report);
$('run-pattern-laptop').onclick=$('run-pattern').onclick;
$('reset-pattern').onclick = () => { editorLibrary=patternLibrary.slice();chainPreset(); $('graph-induced').checked = false; $('saved-pattern').value = ''; $('graph-input-mode').value = 'visual'; $('graph-pattern').value = 'N1:Reshape -> N2:Transpose -> N3:Reshape'; updateGraphInputMode(); renderPattern(); if (model) runSearch().catch(report); };
function renderVisualPattern() {
    conditionUI.render();
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
    conditionUI.render();
}
$('graph-input-mode').onchange = () => {
    if ($('graph-input-mode').value === 'text' && graphNodes.every((n) => /^[A-Za-z_][A-Za-z0-9_]*$/.test(n.type))) {
        const types = new Map(graphNodes.map((n) => [n.alias, n.type]));
        $('graph-pattern').value = graphEdges.map((e) => `${e.from}:${types.get(e.from)} -> ${e.to}:${types.get(e.to)}`).join('\n');
    }
    updateGraphInputMode();
};
$('lora-preset').onclick = () => { editorLibrary=patternLibrary.slice();loraPreset(); $('graph-induced').checked = false; $('saved-pattern').value = ''; $('graph-pattern').value = LORA_PATTERN; $('visual-pattern-editor').open = true; renderVisualPattern(); };
$('add-graph-node').onclick = () => { if (graphNodes.length >= 32) { notice('一組子圖最多 32 個節點。'); return; } graphNodes.push({alias:`N${++graphNodeNumber}`,type:model?.operators[0] || 'Mul'}); renderVisualPattern(); };
$('add-graph-edge').onclick = () => { if (graphNodes.length < 2) { notice('請先加入至少兩個節點。'); return; } if (graphEdges.length >= 64) { notice('一組子圖最多 64 條連線。'); return; } graphEdges.push({from:graphNodes[0].alias,to:graphNodes.at(-1).alias}); renderVisualPattern(); };
$('graph-pattern').oninput = () => { conditionUI.render();$('pattern-decoded').textContent = '規則已變更，請按「尋找模式」重新解讀與搜尋。'; $('pattern-decoded').classList.remove('missing'); };
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
    if(e.defaultPrevented||e.isComposing||e.altKey||document.querySelector('dialog[open]'))return;
    if(tabs.busy)return;
    if(runWorkspace.active){if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==='o'){e.preventDefault();$('open-model').click();}return;}
    if(editWorkspace.active){if(editWorkspace.handleKey(e))return;if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==='o'){e.preventDefault();$('open-model').click();}return;}
    if (e.key === 'Escape' && pickingPattern) setPickingPattern(false);
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'f') { e.preventDefault(); if (kind === 'patterns') setKind('layers'); $('query').focus(); }
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'o') { e.preventDefault(); $('open-model').click(); }
});
$('save-edited-pattern').onclick=async()=>{
    $('save-edited-pattern').disabled=true;
    const sourceFile=file;
    try {
        const title=$('condition-pattern-name').value,structure=JSON.stringify(currentPattern());
        const incoming=reusablePattern(title || '我的條件 pattern',JSON.parse(structure));
        const {pattern}=await saveStoredPattern(incoming,editorLibrary);
        let unchanged=false;
        try{unchanged=structure===JSON.stringify(currentPattern()) && title===$('condition-pattern-name').value;}catch{/* An unfinished new edit is retained. */}
        if(file!==sourceFile || !unchanged)return;
        refreshPatternLibrary(pattern.name);applyPattern(pattern);
        if(model)await runSearch();status(`已儲存「${pattern.name}」及條件。`);
    }catch(error){report(error);}finally{$('save-edited-pattern').disabled=false;}
};
function workspaceCamera() {
    if(virtualOverview)return virtualOverview.snapshot();
    if(!renderedGraph || !view.target)return null;
    const snapshot=captureViewport($('target'),view.target.zoom,viewportEntries());
    if(!snapshot)return null;
    return {...snapshot,kind:'svg',page:snapshot.page || null,candidates:snapshot.candidates.slice(0,8).map(({id,x,y})=>({id,x,y}))};
}
function workspaceState({draft=false}={}) {
    const across=$('capture-cfg').checked;
    let pattern;
    try{pattern=reusablePattern('工作階段 pattern',currentPattern());lastValidWorkspacePattern=pattern;}
    catch(error){if(!draft)throw error;pattern=lastValidWorkspacePattern || {nodes:[{alias:'N1',type:'Reshape'},{alias:'N2',type:'Transpose'}],edges:[{from:'N1',to:'N2'}],induced:false};}
    const state={kind,query:$('query').value,scope:$('scope').value,graph:currentGraph,
        pattern,patternText:$('graph-pattern').value,patternMode:$('graph-input-mode').value,patternName:$('condition-pattern-name').value || $('saved-pattern').value,
        view:!renderedGraph?'none':overviewMode?'overview':selection?'result':'graph',activeIndex,resultKey:resultKey(selection),full,collapsed:patternCollapsed,
        overviewExpanded:[...overviewExpanded],sliceDetails,expanded:[...sliceExpanded],pages:[...slicePages],
        picking:pickingPattern,across,captureName:$('capture-name').value,selections:across?captureSelections():pickedNodes.size && pickedGraph===currentGraph?[{graph:currentGraph,nodes:[...pickedNodes]}]:[],
        font:$('graph-font-size').value,direction:view.options.direction,sidebarWidth:Number($('explorer-resize').getAttribute('aria-valuenow')),exportScope:$('mlir-export-scope').value,camera:workspaceCamera()};
    if(draft)state.editor={nodes:graphNodes,edges:graphEdges,nextNode:graphNodeNumber,cfg:cfgPattern,conditions:[...conditionsByAlias],induced:$('graph-induced').checked,visualOpen:$('visual-pattern-editor').open,fields:Object.fromEntries(DRAFT_FIELDS.map(id=>[id,$(id).value]))};
    return state;
}
$('save-workspace').onclick=async()=>{
    if(!model || workspaceBusy)return;
    if(exportBusy || pending.size || $('target').getAttribute('aria-busy')==='true'){notice('請等待搜尋、繪圖或匯出完成後再儲存。');return;}
    const source=file,query=queryGeneration,render=renderGeneration;
    workspaceBusy=true;$('save-workspace').disabled=true;
    try {
        const state=workspaceState({draft:true});
        status('建立工作階段結構指紋（不讀取權重）…');
        const identity=await rpc('workspaceIdentity');
        if(source!==file || query!==queryGeneration || render!==renderGeneration)throw new Error('畫面已變更，請再次儲存工作階段。');
        const text=exportWorkspace({format:'model-lens-workspace',version:2,identity,state});
        let stored=true;try{localStorage.setItem(WORKSPACE_KEY,text);$('last-workspace').disabled=false;}catch{stored=false;}
        await host.export(`${source.name.replace(/\.[^.]+$/,'')}-workspace.json`,new Blob([text+'\n'],{type:'application/json'}));
        status(`工作階段下載已啟動${stored?'，也已記住此瀏覽器的上次儲存':''}。檔案不含模型或權重。`);
    }catch(error){report(error);}finally{workspaceBusy=false;$('save-workspace').disabled=!model;}
};
async function restoreWorkspace(workspace) {
    const source=file,identity=await rpc('workspaceIdentity');
    if(source!==file)throw new DOMException('已取消','AbortError');
    checkWorkspace(workspace,identity,model.graphs);
    const s=workspace.state;
    lastValidWorkspacePattern=s.pattern;
    setPickingPattern(false);applyPattern(s.pattern);refreshPatternLibrary(patternLibrary.some(p=>p.name===s.patternName)?s.patternName:'');
    $('condition-pattern-name').value=s.patternName;$('graph-pattern').value=s.patternText;$('graph-input-mode').value=s.editor?'visual':s.patternMode;updateGraphInputMode();
    $('graph-font-size').value=s.font;document.documentElement.style.setProperty('--graph-font-size',`${s.font}px`);view.options.direction=s.direction;explorer.setWidth(s.sidebarWidth);
    $('mlir-export-scope').value=s.exportScope;$('query').value=s.query;$('scope').value=s.scope;setCurrentGraph(s.graph);setKind(s.kind,false);
    const expectedQuery=queryGeneration+1;
    const current=()=>{if(source!==file || queryGeneration!==expectedQuery)throw new DOMException('已取消','AbortError');};
    await runSearch();current();
    sliceDetails=s.sliceDetails;sliceExpanded=new Set(s.expanded);slicePages=new Map(s.pages);patternCollapsed=s.collapsed;
    await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
    current();
    let exact=true,limited=false;
    if((s.view==='result' || s.view==='overview') && s.activeIndex>=0 && s.activeIndex<page.total) {
        await changePage(Math.floor(s.activeIndex/100)*100);
        current();
        exact=sameResultKey(s.resultKey,page.items[s.activeIndex-page.offset]);
        if(exact) {
            if(s.view==='overview')await drawPatternOverview({expanded:new Set(s.overviewExpanded),active:s.activeIndex});
            else {
                const item=page.items[s.activeIndex-page.offset],layers=item.blocks?item.blocks.reduce((n,b)=>n+model.graphs[b.graph].layers,0):model.graphs[s.graph].layers;
                limited=s.full && layers>1500;
                await selectResult(s.activeIndex,{whole:s.full && !limited,forceDraw:true,blockGraph:s.graph});
            }
        }
    }else if(s.view==='result' || s.view==='overview')exact=false;
    if(s.view==='graph' || (!exact && s.view!=='none')){limited=s.full && model.graphs[s.graph].layers>1500;await drawGraph(s.graph,s.full && !limited);}
    current();
    $('capture-cfg').checked=s.across;cfgSelections.clear();for(const b of s.selections)cfgSelections.set(b.graph,new Set(b.nodes));
    pickedGraph=s.graph;pickedNodes=cfgSelections.get(s.graph) || new Set();$('capture-name').value=s.captureName;
    setPickingPattern(s.picking);refreshPickedNodes();
    await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
    current();
    if(exact && s.camera?.kind==='canvas' && virtualOverview)virtualOverview.restore(s.camera);
    else if(exact && s.camera?.kind==='svg' && !virtualOverview && view.target)restoreViewport($('target'),view.target,$('canvas'),viewportEntries(),s.camera);
    if(s.editor)restoreDraftEditor(s);
    if(!renderedGraph){view.show('default');$('graph-caption').textContent='索引已就緒 · 選取結果以繪製局部圖';}
    $('workspace-hint').hidden=true;
    $('choose-workspace-model').hidden=true;
    status(exact?'已恢復工作階段：搜尋、選取、收合與圖形位置。':'已恢復搜尋與選取；儲存時的搜尋結果不符，已顯示目前 subgraph。');
    if(limited)notice('搜尋與選取已恢復；超過 1,500 個 OP 的 SVG 完整圖先以局部圖開啟，可手動確認繪製或使用 Canvas 總覽。');
    else if([...$('slice-connection-controls').querySelectorAll('button')].some(b=>b.textContent.startsWith('繼續分析')))notice('已保留路徑展開與目標分段；新開模型的路徑快取需重建，請按「繼續分析」逐步完成。');
}
function restoreDraftEditor(s) {
    const e=s.editor;graphNodes=structuredClone(e.nodes);graphEdges=structuredClone(e.edges);graphNodeNumber=e.nextNode;cfgPattern=e.cfg?structuredClone(e.cfg):null;
    conditionsByAlias.clear();for(const [alias,rules] of e.conditions)conditionsByAlias.set(alias,structuredClone(rules));
    $('graph-induced').checked=e.induced;$('graph-pattern').value=s.patternText;$('graph-input-mode').value=s.patternMode;updateGraphInputMode();renderPattern();
    $('visual-pattern-editor').open=e.visualOpen;for(const id of DRAFT_FIELDS)$(id).value=e.fields[id];conditionUI.render();cfgEditor.render();
    try{reusablePattern('草稿',currentPattern());}catch{$('pattern-decoded').textContent='已恢復未完成的 pattern 草稿；請修正後再搜尋。';}
}
function captureSession(identity){return {format:'model-lens-workspace',version:2,identity,state:workspaceState({draft:true})};}
function workspaceReady(){return !!model && !exportBusy && !workspaceBusy && !pending.size && $('target').getAttribute('aria-busy')!=='true' && $('loading-card').hidden;}
const settleWorkspace=()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
async function applySession(workspace) {
    const source=file,query=queryGeneration,render=renderGeneration;
    const currentView=()=>{if(file!==source || queryGeneration!==query || renderGeneration!==render)throw new DOMException('已取消','AbortError');};
    checkWorkspace(workspace,sessions.identity,model.graphs);
    const current=parseWorkspace(exportWorkspace(captureSession(sessions.identity))).state,s=workspace.state;
    const scene=value=>{const copy={...value};for(const key of ['selections','picking','captureName','camera'])delete copy[key];return JSON.stringify(copy);};
    if(scene(current)!==scene(s)){await restoreWorkspace(workspace);return;}
    cfgSelections.clear();for(const b of s.selections)cfgSelections.set(b.graph,new Set(b.nodes));pickedGraph=s.graph;pickedNodes=cfgSelections.get(s.graph) || new Set();$('capture-name').value=s.captureName;setPickingPattern(s.picking);refreshPickedNodes();
    await settleWorkspace();
    currentView();
    if(s.camera?.kind==='canvas' && virtualOverview)virtualOverview.restore(s.camera);
    else if(s.camera?.kind==='svg' && !virtualOverview && view.target)restoreViewport($('target'),view.target,$('canvas'),viewportEntries(),s.camera);
    await settleWorkspace();
    currentView();
}
function queueWorkspace(workspace,chooseNow=true) {
    pendingWorkspace=workspace;
    $('workspace-hint').textContent=`請重新選取「${workspace.identity.name}」。將核對檔案大小與結構指紋；不讀取權重內容。`;$('workspace-hint').hidden=false;
    $('choose-workspace-model').hidden=false;
    if(chooseNow){$('model-file').value='';$('model-file').click();}
}
$('choose-workspace-model').onclick=()=>{$('model-file').value='';$('model-file').click();};
$('open-workspace').onclick=()=>{$('workspace-file').value='';$('workspace-file').click();};
$('workspace-file').onchange=async()=>{
    const selected=$('workspace-file').files[0],generation=++workspaceImport;if(!selected)return;
    try{if(selected.size>WORKSPACE_LIMIT)throw new Error('工作階段檔案不得超過 2 MiB。');const workspace=parseWorkspace(await selected.text());if(generation===workspaceImport){queuedDraft=null;queueWorkspace(workspace,false);}}catch(error){report(error);}
};
$('last-workspace').onclick=()=>{try{queuedDraft=null;queueWorkspace(parseWorkspace(localStorage.getItem(WORKSPACE_KEY) ?? localStorage.getItem(LEGACY_WORKSPACE_KEY) ?? ''));}catch(error){report(error);}};
$('model-file').addEventListener('cancel',()=>{if(pendingWorkspace){pendingWorkspace=null;queuedDraft=null;$('workspace-hint').hidden=true;$('choose-workspace-model').hidden=true;status('已取消恢復工作階段。');}});
try{$('last-workspace').disabled=!(localStorage.getItem(WORKSPACE_KEY) ?? localStorage.getItem(LEGACY_WORKSPACE_KEY));}catch{/* File import remains available. */}
new MutationObserver(() => {
    const open=$('sidebar').style.opacity==='1',opening=open&&!document.body.classList.contains('details-open');
    document.body.classList.toggle('details-open',open);
    if(opening && innerWidth>900 && innerWidth<=1600 && detailNode && !virtualOverview) {
        const node=detailNode,generation=renderGeneration;
        requestAnimationFrame(()=>{if(generation!==renderGeneration || !document.body.classList.contains('details-open'))return;const entry=renderedNodes.find(e=>e.node===node || e.node.identifier===node.identifier);if(entry?.element)view.target?.scrollTo([entry.element]);});
    }
}).observe($('sidebar'), { attributes: true, attributeFilter: ['style'] });
resizeInFrame($('capture-toolbar'),()=>document.documentElement.style.setProperty('--capture-space',`${Math.ceil($('capture-toolbar').getBoundingClientRect().height)+24}px`));
// Version metadata is independent of graph startup and must respond immediately.
initReleaseInfo({exportFile:host.export});
usageGuide=initUsageGuide({
    getContext:()=>({hasModel:!!model,format:model?.sourceFormat,mode:runWorkspace.active?'run':editWorkspace.active?'edit':'explore',busy:exportBusy||workspaceBusy||tabs.busy||pending.size>0||!$('loading-card').hidden||$('target').getAttribute('aria-busy')==='true'||$('run-workspace').getAttribute('aria-busy')==='true'}),
    perform:async action=>{
        if(action==='open'){$('open-model').click();return;}
        if(action==='demo'){if(await openDemo()===false)throw Error('未能開啟示範模型，請確認本機原分頁狀態後再試。');return;}
        if(action==='mlir-demo'){if(await openMLIRDemo()===false)throw Error('未能開啟 MLIR 示範，請確認本機原分頁狀態後再試。');return;}
        if(action==='drafts'){$('open-edit-draft').click();return;}
        if(action==='edit'){await editWorkspace.open();$('edit-find').focus({preventScroll:true});return;}
        if(action==='run'){runWorkspace.open();$('edit-runtime-check').focus({preventScroll:true});return;}
        editWorkspace.explore();const target=kind==='patterns'?$('patterns-tab'):$('query');target.focus({preventScroll:true});
    }
});
const viewReady = view.start().then(() => { reset(); renderPattern(); });
await viewReady;
libraryReady=refreshStoredPatterns();
libraryReady.then(()=>{$('pattern-library-status').textContent=`本機清單第 ${patternRevision} 版 · 多分頁更新會合併，同名衝突另存副本`;}).catch(()=>{});
sessions=workspaceSessionUI({capture:captureSession,apply:applySession,ready:workspaceReady,settle:settleWorkspace,exportFile:host.export,error:report,restoreDraft:async(workspace,record)=>{
    if(model&&sessions.identity&&draftModelKey(workspace.identity)===draftModelKey(sessions.identity))await sessions.resume(record);
    else {queuedDraft=record;queueWorkspace(workspace,false);}
}});

diagnosticUI({journal:diagnostics,exportFile:host.export,context:()=>({
    modelLoaded:!!model,format:model?.sourceFormat || 'none',fileBytes:file?.size,
    layers:model?.graphs.reduce((n,g)=>n+g.layers,0),scopes:model?.graphs.length,
    selected:$('capture-cfg').checked?[...cfgSelections.values()].reduce((n,set)=>n+set.size,0):pickedNodes.size,
    renderer:virtualOverview?'canvas':renderedGraph?'svg':'none',view:overviewMode?'overview':full?'full':'local',fontPx:Number($('graph-font-size').value),
    layoutBusy:$('target').getAttribute('aria-busy')==='true',exportBusy,modelWorkerPresent:!!worker,pendingRequests:pending.size,
    bytesRead:model?.stats.bytesRead,parseMs:model?.stats.parseMs,autosave:sessions?.diagnosticState()
})});
