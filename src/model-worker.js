import { search, findPatterns, snapshot, selectionSnapshot, serialize } from './model-engine.js';
import { openModelFile } from './model-adapters.js';
import { mlirDialects } from './mlir-dialect-registry.js';
import { parseGraphPattern, prepareGraphPattern, captureGraphPattern, findSubgraphPatterns } from './subgraph-pattern.js';
import { operatorKey, operatorIndex } from './pattern-utils.js';
import {foldPatternSnapshot} from './pattern-fold.js';
import {preparePatternOverview,patternOverviewSnapshot} from './pattern-overview.js';
import {createExportReport} from './export-report.js';
import {assertModelEditAction} from './model-edit-policy.js';
import {prepareExportResult} from './blob-memory-parts.js';
let index;
let overview;
let results = [];
let generation = 0;
let file;
let identity;
let editInProgress=false;
let editWorkspace=null,editWorkspaceSerial=0;
let editIdentity=null,editDraftJob=0;
async function draftFingerprint(sourceFile,job){
    if(editIdentity?.file===sourceFile)return editIdentity.value;
    const {editFileFingerprint}=await import('./model-edit-session.js'),value=await editFileFingerprint(sourceFile,{cancelled:()=>file!==sourceFile||job!==editDraftJob,progress:(done,total)=>postMessage({stage:`本機核對完整原模型 ${Math.round(done/Math.max(1,total)*100)}%（不會上傳）`,editDraft:true})});
    if(file!==sourceFile||job!==editDraftJob)throw Error('已取消原模型核對。');editIdentity={file:sourceFile,value};return value;
}
const send = (id, data) => postMessage({ id, data });
const withReport=(result,args)=>{
    try {
        const report=createExportReport(index,file,result,{...args,buildId:new URL(import.meta.url).searchParams.get('v')});
        const {provenance,...data}=result;return {...data,report};
    } catch(error) {const {provenance,...data}=result;return {...data,reportError:error.message};}
};
self.onmessage = async ({ data: { id, action, args } }) => {
    try {
        assertModelEditAction(index,action,args);
        if (action === 'open') {
            editIdentity=null;editDraftJob++;
            editWorkspace=null;
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
        } else if(action==='editWorkspaceOpen'){
            const sourceIndex=index,sourceFile=file,{editWorkspaceSnapshot}=await import('./model-edit-workspace.js');
            if(index!==sourceIndex||file!==sourceFile)throw Error('模型已切換，請重新開啟編輯工作區。');
            const snapshot=editWorkspaceSnapshot(index,args);editWorkspace={index,file,snapshot,token:++editWorkspaceSerial};send(id,{...snapshot,token:editWorkspace.token});
        } else if(action==='editBuiltinCatalog'){
            if(!index?.raw)throw Error('OP 選單適用於 TFLite 模型。');
            const {builtinCatalog}=await import('./tflite-new-ops.js'),response=await fetch(new URL('../vendor/netron/tflite-metadata.json',import.meta.url));if(!response.ok)throw Error('無法載入 OP 定義。');send(id,builtinCatalog(await response.json()));
        } else if(action==='editWorkspaceClose'){
            if(editWorkspace?.token===args.token)editWorkspace=null;send(id,{closed:true});
        } else if(action==='editWorkspaceExtend'){
            if(!editWorkspace||args.token!==editWorkspace.token||editWorkspace.index!==index||editWorkspace.file!==file)throw Error('編輯工作區已過期。');
            const session=editWorkspace,{editWorkspaceSnapshot}=await import('./model-edit-workspace.js'),{modelEditDraft}=await import('./model-edit-draft.js');
            if(editWorkspace!==session)throw Error('工作區已切換，請重試。');
            if(!Array.isArray(args.targets)||args.targets.length>32||JSON.stringify(args.commands).length>1024*1024)throw Error('加入範圍或草稿過大。');
            const targets=[...new Map([...session.snapshot.nodes.map(n=>n.source),...args.targets].map(t=>[`${t.graph}:${t.node}`,t])).values()],snapshot=editWorkspaceSnapshot(index,{targets,composition:!!session.snapshot.composition});
            modelEditDraft(snapshot,args.commands,args.redo||[]);editWorkspace={index,file,snapshot,token:++editWorkspaceSerial};send(id,{...snapshot,token:editWorkspace.token});
        } else if(action==='editDraftCancel'){
            editDraftJob++;send(id,{cancelled:true});
        } else if(action==='editDraftSave'||action==='editDraftRestore'){
            const sourceFile=file,sourceIndex=index,session=editWorkspace,job=++editDraftJob;
            const {createEditSession,restoreEditSession,cleanEditSession}=await import('./model-edit-session.js');
            if(action==='editDraftSave'&&(!session||session.token!==args.token))throw Error('編輯工作區已過期。');
            const document=action==='editDraftRestore'?cleanEditSession(args.document):null;
            if(document&&(document.source.bytes!==sourceFile.size||document.source.format!==(index.mlir?'mlir':'tflite')))throw Error('原模型格式或大小不符，請重新選擇草稿的原模型。');
            const fingerprint=await draftFingerprint(sourceFile,job);
            if(index!==sourceIndex||file!==sourceFile||job!==editDraftJob||editWorkspace!==session)throw Error('模型或工作區已切換，未套用草稿。');
            if(action==='editDraftSave'){const document=await createEditSession(file,session.snapshot,args,fingerprint);if(job!==editDraftJob||file!==sourceFile)throw Error('已取消草稿儲存。');send(id,document);}
            else {const restored=await restoreEditSession(index,file,document,fingerprint);if(job!==editDraftJob||file!==sourceFile||editWorkspace!==session)throw Error('模型已切換，未套用草稿。');editWorkspace={index,file,snapshot:restored.snapshot,token:++editWorkspaceSerial};send(id,{snapshot:{...restored.snapshot,token:editWorkspace.token},saved:restored.saved});}
        } else if(action==='modelRuntimeInfo'){
            if(!index?.raw||index.mlir||!file)throw Error('執行模式僅支援目前分頁已開啟的 TFLite。');
            const {runtimePlan}=await import('./tflite-runtime-policy.js');send(id,runtimePlan(index.raw,file.size));
        } else if(action==='editWorkspaceExport'){
            if(!editWorkspace||args.token!==editWorkspace.token||editWorkspace.index!==index||editWorkspace.file!==file)throw Error('編輯工作區已過期，請重新開啟。');
            if(editInProgress)throw Error('上一筆模型修改仍在驗證。');if(JSON.stringify(args.commands).length>1024*1024)throw Error('編輯草稿超過 1 MiB。');
            editInProgress=true;const session=editWorkspace,sourceIndex=index,sourceFile=file;
            try{
                const {exportEditWorkspace}=await import('./model-edit-workspace.js'),result=await prepareExportResult(await exportEditWorkspace(index,file,session.snapshot,args.commands,{updateSignatures:args.updateSignatures,progress:stage=>postMessage({stage})}));
                const candidateFile=new File([result.blob],`edited.${result.format}`),reader=new FileReaderSync();
                const candidate=await openModelFile(candidateFile,{readAt:(offset,length)=>new Uint8Array(reader.readAsArrayBuffer(candidateFile.slice(offset,offset+length))),readMetadata:async format=>{const r=await fetch(new URL(`../vendor/netron/${format}-metadata.json`,import.meta.url));if(!r.ok)throw Error('無法載入候選模型 metadata。');return r.text();},dialects:mlirDialects});
                if(candidate.mlir){const {assertValidMLIR}=await import('./mlir-validate.js');assertValidMLIR(candidate);}
                else {const {validateTfliteModelGraph}=await import('./tflite-model-edit.js'),{validateTfliteConstants}=await import('./tflite-constant-checks.js');result.semanticValidation=[];for(const c of result.changes){validateTfliteModelGraph(candidate.raw,c.graph);result.semanticValidation.push(validateTfliteConstants(candidate.raw,c.graph,(o,n)=>new Uint8Array(reader.readAsArrayBuffer(candidateFile.slice(o,o+n)))));}}
                if(index!==sourceIndex||file!==sourceFile||editWorkspace!==session){send(id,{cancelled:true});return;}
                const verified={...result,roundTrip:true,roundTripStats:{bytesRead:candidate.stats.bytesRead,fileBytes:candidateFile.size}};
                const {replayEditDraft}=await import('./model-edit-draft.js'),state=replayEditDraft(session.snapshot,args.commands),targets=[...new Map(result.workspaceChanges.map(c=>{const n=state.nodes.find(n=>n.id===c.node);return [`${n.source.graph}:${n.source.node}`,n.source];})).values()];
                try{const {createModelEditReport}=await import('./model-edit-report.js');verified.report=createModelEditReport(sourceIndex,sourceFile,verified,candidate,{...targets[0],mode:'workspace',workspaceTargets:targets},{outputName:args.outputName,buildId:new URL(import.meta.url).searchParams.get('v')});}catch(reason){verified.reportError=reason.message;}
                send(id,verified);
            }finally{editInProgress=false;}
        } else if (['modelEditTargets','modelEditInfo','modelEditValues','modelEditText','editModelOperation'].includes(action)) {
            const {operationEditTargets,operationEditInfo,operationValueChoices,operationEditText,editModelOperation}=await import('./model-operation-edit.js');
            if(action==='modelEditTargets'){send(id,operationEditTargets(index,args));return;}
            if(action==='modelEditInfo'){send(id,operationEditInfo(index,args));return;}
            if(action==='modelEditValues'){send(id,operationValueChoices(index,args));return;}
            if(action==='modelEditText'){send(id,operationEditText(index,args));return;}
            if(editInProgress)throw Error('上一筆模型修改仍在驗證，請稍後再試。');
            editInProgress=true;
            try {
            const sourceIndex=index,sourceFile=file,result=await prepareExportResult(await editModelOperation(sourceIndex,sourceFile,args,{progress:stage=>postMessage({stage})}));
            // Verify actual serialized bytes before offering a download. The
            // candidate is local to this request; never replace the live index.
            const candidateFile=new File([result.blob],`edited.${result.format}`),reader=new FileReaderSync();
            const candidate=await openModelFile(candidateFile,{readAt:(offset,length)=>new Uint8Array(reader.readAsArrayBuffer(candidateFile.slice(offset,offset+length))),readMetadata:async format=>{const response=await fetch(new URL(`../vendor/netron/${format}-metadata.json`,import.meta.url));if(!response.ok)throw Error('無法載入候選模型 metadata。');return response.text();},dialects:mlirDialects});
            if(candidate.mlir){const {assertValidMLIR}=await import('./mlir-validate.js');assertValidMLIR(candidate);}
            else {const {validateTfliteModelGraph}=await import('./tflite-model-edit.js'),{validateTfliteConstants}=await import('./tflite-constant-checks.js');result.semanticValidation=[];for(const change of result.changes){validateTfliteModelGraph(candidate.raw,change.graph);result.semanticValidation.push(validateTfliteConstants(candidate.raw,change.graph,(o,n)=>new Uint8Array(reader.readAsArrayBuffer(candidateFile.slice(o,o+n)))));}}
            if(index!==sourceIndex||file!==sourceFile){send(id,{cancelled:true});return;}
            const verified={...result,roundTrip:true,roundTripStats:{bytesRead:candidate.stats.bytesRead,fileBytes:candidateFile.size}};
            try{const {createModelEditReport}=await import('./model-edit-report.js');verified.report=createModelEditReport(sourceIndex,sourceFile,verified,candidate,args,{outputName:args.outputName,buildId:new URL(import.meta.url).searchParams.get('v')});}
            catch(reason){verified.reportError=reason.message;}
            send(id,verified);
            } finally {editInProgress=false;}
        } else if (action === 'workspaceIdentity') {
            const {workspaceIdentity}=await import('./workspace.js');
            identity ||= await workspaceIdentity(index,file);send(id,identity);
        } else if(action==='previewTfliteExport'){
            const {tfliteExportPreview}=await import('./tflite-export-preview.js');send(id,tfliteExportPreview(index,args.graph,args.nodes));
        } else if (action === 'exportTflite') {
            if (!index?.capabilities?.tfliteExport) throw new Error('目前模型無法轉換或匯出 TFLite，請使用 MLIR 匯出。');
            const { exportTflite } = await import('./tflite-export.js');
            const sourceIndex=index,sourceFile=file,result=await prepareExportResult(exportTflite(index,args.graph,args.nodes,file));
            if(index!==sourceIndex||file!==sourceFile){send(id,{cancelled:true});return;}
            send(id,withReport(result,args));
        } else if (action === 'exportMLIR') {
            const { exportMLIR } = await import('./mlir-export.js');
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
                const {findMLIRPatterns}=await import('./mlir-pattern.js');
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
                const {captureMLIRPattern}=await import('./mlir-pattern.js');send(id,captureMLIRPattern(index,args.selections));return;
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
                const {mlirSliceSnapshot}=await import('./mlir-pattern.js'),dto=mlirSliceSnapshot(index,args.item.graph,args);
                const selected=`b${args.item.graph}:n${args.item.index}`;
                if(dto?.nodes.includes(selected)){send(id,{...dto,selected:[selected]});return;}
            }
            if(args.item.mode==='mlir-cfg') {
                const {mlirMatchSnapshot}=await import('./mlir-pattern.js');const dto=mlirMatchSnapshot(index,args.item,args);send(id,args.collapsed?foldPatternSnapshot(dto,{name:args.patternName}):dto);
            } else {const dto=selectionSnapshot(index,args.item,args);send(id,args.collapsed?foldPatternSnapshot(dto,{name:args.patternName}):dto);}
        } else if (action === 'graph') {
            let slice;
            if(index.mlir){const {mlirSliceSnapshot}=await import('./mlir-pattern.js');slice=mlirSliceSnapshot(index,args.graph,args);}
            send(id, slice || { ...snapshot(index, args.graph, args.full ? [] : [0].filter(() => index.graphs[args.graph].graph.nodes.length), args.full), item: null });
        }
    } catch (error) { postMessage({ id, error: error.message || String(error), validation:error.validation }); }
};
