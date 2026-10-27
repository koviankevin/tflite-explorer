import { search, findPatterns, snapshot, selectionSnapshot, serialize } from './model-engine.js?v=e67611582982ec3f';
import { openModelFile } from './model-adapters.js?v=e67611582982ec3f';
import { mlirDialects } from './mlir-dialect-registry.js?v=e67611582982ec3f';
import { parseGraphPattern, prepareGraphPattern, captureGraphPattern, findSubgraphPatterns } from './subgraph-pattern.js?v=e67611582982ec3f';
import { operatorKey, operatorIndex } from './pattern-utils.js?v=e67611582982ec3f';
import {foldPatternSnapshot} from './pattern-fold.js?v=e67611582982ec3f';
import {preparePatternOverview,patternOverviewSnapshot} from './pattern-overview.js?v=e67611582982ec3f';
import {createExportReport} from './export-report.js?v=e67611582982ec3f';
let index;
let overview;
let results = [];
let generation = 0;
let file;
let identity;
const send = (id, data) => postMessage({ id, data });
const withReport=(result,args)=>{
    try {
        const report=createExportReport(index,file,result,{...args,buildId:new URL(import.meta.url).searchParams.get('v')});
        const {provenance,...data}=result;return {...data,report};
    } catch(error) {const {provenance,...data}=result;return {...data,reportError:error.message};}
};
self.onmessage = async ({ data: { id, action, args } }) => {
    try {
        if (action === 'open') {
            identity=null;
            overview=null;
            file = args.file;
            const reader = new FileReaderSync();
            const progress = (stage) => postMessage({ stage });
            index = await openModelFile(file, {
                readAt: (offset, length) => new Uint8Array(reader.readAsArrayBuffer(file.slice(offset, offset + length))),
                readMetadata: async format => {
                    const response = await fetch(new URL(`../vendor/netron/${format}-metadata.json`, import.meta.url));
                    if (!response.ok) throw new Error('無法載入 operator 定義。');
                    return response.text();
                }, progress, dialects:mlirDialects
            });
            send(id, { sliceView:!!index.mlir?.slicePatterns?.size, sourceFormat: index.sourceFormat, capabilities: index.capabilities, format: index.model.format, description: index.model.description, stats: index.stats, graphs: index.graphs.map((e, i) => ({ index: i, name: e.graph.name || `Subgraph ${i}`, layers: e.graph.nodes.length, tensors: e.tensors.size, cfgExport:index.mlir?.graphs[i]?.cfgExport })), operators: [...new Set(index.graphs.flatMap((entry) => operatorIndex(entry).names))].sort() });
        } else if (action === 'workspaceIdentity') {
            const {workspaceIdentity}=await import('./workspace.js?v=e67611582982ec3f');
            identity ||= await workspaceIdentity(index,file);send(id,identity);
        } else if (action === 'exportTflite') {
            if (!index?.capabilities?.tfliteExport) throw new Error('目前模型無法轉換或匯出 TFLite，請使用 MLIR 匯出。');
            const { exportTflite } = await import('./tflite-export.js?v=e67611582982ec3f');
            send(id, withReport(exportTflite(index, args.graph, args.nodes, file),args));
        } else if (action === 'exportMLIR') {
            const { exportMLIR } = await import('./mlir-export.js?v=e67611582982ec3f');
            send(id, withReport(await exportMLIR(index, args.graph, args.nodes, {scope:args.scope,selections:args.selections,progress:stage=>postMessage({stage})}),args));
        } else if (action === 'search') {
            overview=null;
            generation++;
            results = search(index, args.kind, args.query, args.scope);
            send(id, { items: results.slice(0, 100), total: results.length, offset: 0 });
        } else if (action === 'pattern' || action === 'subgraphPattern') {
            overview=null;
            const current = ++generation;
            if(args.structure?.mode==='mlir-cfg') {
                const {findMLIRPatterns}=await import('./mlir-pattern.js?v=e67611582982ec3f');
                const result=await findMLIRPatterns(index,args.structure,args.scope,()=>generation!==current);
                if(!result){send(id,{cancelled:true});return;}
                results=result.items;send(id,{items:results.slice(0,100),total:results.length,offset:0,truncated:result.truncated,searchLimited:result.searchLimited});return;
            }
            const available = [...new Set(index.graphs.flatMap((entry) => operatorIndex(entry).names))];
            const spec = action === 'subgraphPattern' ? args.structure ? prepareGraphPattern(args.structure.nodes, args.structure.edges) : parseGraphPattern(args.text, available) : null;
            if (spec) spec.induced = Boolean(args.structure?.induced ?? args.induced);
            if (spec && args.structure) spec.label = `連接結構 · ${spec.nodes.length} 節點 · ${spec.edges.length} 連線`;
            const result = spec ? await findSubgraphPatterns(index, spec, args.scope, () => generation !== current) : await findPatterns(index, args.operators, args.scope, () => generation !== current);
            if (!result) { send(id, { cancelled: true }); return; }
            results = result.items;
            const decodedNodes = spec?.nodes.map((node) => ({ alias: node.alias, type: available.find((type) => operatorKey(type) === node.type) || node.type, present: available.some((type) => operatorKey(type) === node.type) }));
            send(id, { items: results.slice(0, 100), total: results.length, offset: 0, truncated: result.truncated, searchLimited: result.searchLimited, decodedNodes });
        } else if (action === 'capturePattern') {
            if(args.selections) {
                const {captureMLIRPattern}=await import('./mlir-pattern.js?v=e67611582982ec3f');send(id,captureMLIRPattern(index,args.selections));return;
            }
            const entry = index.graphs[args.graph];
            if (!entry) throw new Error('找不到目前 subgraph。');
            send(id, captureGraphPattern(entry, args.nodes));
        } else if (action === 'page') {
            send(id, { items: results.slice(args.offset, args.offset + 100), total: results.length, offset: args.offset });
        } else if (action === 'patternOverview') {
            const current=generation,prepared=overview || await preparePatternOverview(index,results,{name:args.patternName,cancelled:()=>current!==generation});
            if(!prepared || current!==generation){send(id,{cancelled:true});return;}
            overview=prepared;send(id,patternOverviewSnapshot(prepared,args));
        } else if(action==='overviewNode') {
            const node=index.graphs[args.graph]?.graph.nodes[args.node];if(!node)throw new Error('找不到原始 OP。');send(id,serialize(node));
        } else if (action === 'select') {
            if(index.mlir && args.item.kind==='layers') {
                const {mlirSliceSnapshot}=await import('./mlir-pattern.js?v=e67611582982ec3f'),dto=mlirSliceSnapshot(index,args.item.graph,args);
                const selected=`b${args.item.graph}:n${args.item.index}`;
                if(dto?.nodes.includes(selected)){send(id,{...dto,selected:[selected]});return;}
            }
            if(args.item.mode==='mlir-cfg') {
                const {mlirMatchSnapshot}=await import('./mlir-pattern.js?v=e67611582982ec3f');const dto=mlirMatchSnapshot(index,args.item,args);send(id,args.collapsed?foldPatternSnapshot(dto,{name:args.patternName}):dto);
            } else {const dto=selectionSnapshot(index,args.item,args);send(id,args.collapsed?foldPatternSnapshot(dto,{name:args.patternName}):dto);}
        } else if (action === 'graph') {
            const {mlirSliceSnapshot}=await import('./mlir-pattern.js?v=e67611582982ec3f');
            const slice=mlirSliceSnapshot(index,args.graph,args);
            send(id, slice || { ...snapshot(index, args.graph, args.full ? [] : [0].filter(() => index.graphs[args.graph].graph.nodes.length), args.full), item: null });
        }
    } catch (error) { postMessage({ id, error: error.message || String(error), validation:error.validation }); }
};
