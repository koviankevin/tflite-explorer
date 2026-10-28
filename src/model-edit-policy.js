export const TFLITE_EDIT_MESSAGE='實際模型編輯僅支援 TFLite；MLIR 可探索、搜尋、建立 pattern 與匯出局部模型。';
export const MODEL_EDIT_ACTIONS=new Set(['editWorkspaceOpen','editWorkspaceExtend','editWorkspaceExport','editBuiltinCatalog','editDraftSave','editDraftRestore','modelEditTargets','modelEditInfo','modelEditValues','modelEditText','editModelOperation']);
export const supportsModelEditing=format=>format==='tflite';
// Check before dynamic imports, file fingerprinting, or any session mutation.
export function assertModelEditAction(index,action,args){
    if(!MODEL_EDIT_ACTIONS.has(action))return;
    if(!index?.raw||index.mlir)throw Error(TFLITE_EDIT_MESSAGE);
    if(action==='editDraftRestore'&&args?.document?.source?.format!=='tflite')throw Error('模型編輯草稿僅支援 TFLite；不會套用 MLIR 編輯草稿。');
}
