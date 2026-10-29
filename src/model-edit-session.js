import {EDIT_LIMITS,modelEditDraft} from './model-edit-draft.js';
import {randomOptions,validateRandomRange} from './tensor-random.js';
export const EDIT_DRAFT_LIMIT=256*1024;
const fail=()=>{throw Error('編輯草稿格式無效、版本不支援或超過上限；未套用變更。');};
const integer=(v,max=10000000)=>Number.isSafeInteger(v)&&v>=0&&v<=max;
const id=v=>typeof v==='string'&&/^(?:op:\d+:\d+|new:\d+)$/.test(v)&&v.length<=80;
const valueId=v=>typeof v==='string'&&/^(?:t:\d+:-?\d+|m:\d+:\d+:\d+|a:\d+:\d+|new:\d+:out:\d+|const:\d+)$/.test(v)&&v.length<=100;
const keys=(v,list)=>v&&typeof v==='object'&&!Array.isArray(v)&&Object.keys(v).every(k=>list.includes(k));
function command(v){
    if(!id(v?.node))fail();
    const fields={wire:['kind','node','slot','value'],clone:['kind','node','side'],template:['kind','node','template'],builtin:['kind','node','code','version','settings','inputCount','outputLike','inferOutputs'],random:['kind','node','slot','like','seed','distribution','min','max','mean','std','probability'],remove:['kind','node','boundary'],restore:['kind','node'],expose:['kind','node','enabled'],import:['kind','node','nodes','label'],interface:['kind','node','value','side','enabled']};
    if(!Object.hasOwn(fields,v.kind)||!keys(v,fields[v.kind]))fail();
    if(v.kind==='wire'&&(!integer(v.slot,1023)||!valueId(v.value))||v.kind==='clone'&&!['before','after'].includes(v.side)||v.kind==='template'&&!id(v.template)||v.kind==='remove'&&typeof v.boundary!=='boolean'||v.kind==='expose'&&typeof v.enabled!=='boolean')fail();
    if(v.kind==='builtin'&&(!integer(v.code,10000)||!integer(v.version,100)||v.version<1||!integer(v.inputCount,32)||!Array.isArray(v.outputLike)||v.outputLike.length>32||v.outputLike.some(x=>!valueId(x))||!v.settings||typeof v.settings!=='object'||Array.isArray(v.settings)||JSON.stringify(v.settings).length>16384))fail();
    if(v.kind==='builtin'&&v.inferOutputs!==undefined&&typeof v.inferOutputs!=='boolean')fail();
    if(v.kind==='random'){
        if(!integer(v.slot,31)||!valueId(v.like)||!integer(v.seed,4294967295))fail();
        try{const spec=randomOptions(v);if(!keys(v,['kind','node','slot','like',...Object.keys(spec)]))fail();validateRandomRange('float64',spec);}catch{fail();}
    }
    if(v.kind==='import'&&(!Array.isArray(v.nodes)||!v.nodes.length||v.nodes.length>32||v.nodes.some(n=>typeof n!=='string'||!/^op:\d+:\d+$/.test(n)||!id(n))||v.node!==v.nodes[0]||typeof v.label!=='string'||v.label.length>80))fail();
    if(v.kind==='interface'&&(!valueId(v.value)||!['inputs','outputs'].includes(v.side)||typeof v.enabled!=='boolean'))fail();
    return {...v};
}
export function cleanEditSession(v){
    if(!keys(v,['format','version','source','scope','history','view','options'])||v.format!=='model-lens-edit-draft'||![1,2,3].includes(v.version))fail();
    const s=v.source,p=v.scope,h=v.history,w=v.view,o=v.options;
    if(!keys(s,['name','bytes','format','algorithm','fingerprint'])||typeof s.name!=='string'||s.name.length>1024||!integer(s.bytes,Number.MAX_SAFE_INTEGER)||!['tflite','mlir'].includes(s.format)||s.algorithm!=='sha256-chunks-v1'||!/^[a-f0-9]{64}$/.test(s.fingerprint))fail();
    if(!keys(p,['nodes','selected','signature','composition'])||!Array.isArray(p.nodes)||!p.nodes.length||p.nodes.length>EDIT_LIMITS.originals||p.nodes.some(n=>!keys(n,['graph','node'])||!integer(n.graph)||!integer(n.node))||new Set(p.nodes.map(n=>`${n.graph}:${n.node}`)).size!==p.nodes.length||!Array.isArray(p.selected)||p.selected.length>64||p.selected.some(n=>!id(n)||!p.nodes.some(t=>n===`op:${t.graph}:${t.node}`))||!/^[a-f0-9]{64}$/.test(p.signature))fail();
    if(v.version===1&&p.composition!==undefined||v.version===2&&p.composition!==true||v.version===3&&p.composition!==undefined&&p.composition!==true)fail();
    if((p.composition||v.version===3)&&(s.format!=='tflite'||p.composition&&new Set(p.nodes.map(n=>n.graph)).size!==1))fail();
    if(!keys(h,['commands','redo'])||!Array.isArray(h.commands)||!Array.isArray(h.redo)||h.commands.length+h.redo.length>128)fail();
    if(!keys(w,['selected','zoom','font','left','top'])||!(w.selected===null||id(w.selected))||!Number.isFinite(w.zoom)||w.zoom<.15||w.zoom>2||![14,16,18,20,24,28,32].includes(w.font)||![w.left,w.top].every(n=>Number.isFinite(n)&&n>=0&&n<=1e9)||!keys(o,['updateSignatures'])||typeof o.updateSignatures!=='boolean')fail();
    const result={format:v.format,version:v.version,source:{...s},scope:{nodes:p.nodes.map(n=>({...n})),selected:[...p.selected],signature:p.signature,...(p.composition?{composition:true}:{})},history:{commands:h.commands.map(command),redo:h.redo.map(command)},view:{...w},options:{...o}};
    if(!p.composition&&[...result.history.commands,...result.history.redo].some(c=>['import','interface'].includes(c.kind)))fail();
    if(v.version<3&&[...result.history.commands,...result.history.redo].some(c=>c.kind==='random'&&c.distribution!==undefined))fail();
    if(new TextEncoder().encode(JSON.stringify(result)).length>EDIT_DRAFT_LIMIT)fail();return result;
}
export function parseEditSession(text){if(typeof text!=='string'||text.length>EDIT_DRAFT_LIMIT||new TextEncoder().encode(text).length>EDIT_DRAFT_LIMIT)fail();let value;try{value=JSON.parse(text);}catch{fail();}return cleanEditSession(value);}
export const exportEditSession=value=>{const clean=cleanEditSession(value),pretty=JSON.stringify(clean,null,2)+'\n';if(new TextEncoder().encode(pretty).length<=EDIT_DRAFT_LIMIT)return pretty;return JSON.stringify(clean);};
const digest=async bytes=>new Uint8Array(await crypto.subtle.digest('SHA-256',bytes));
const hex=bytes=>[...bytes].map(b=>b.toString(16).padStart(2,'0')).join('');
export {editFileFingerprint} from './file-fingerprint.js';
export async function editScopeSignature(snapshot){const {format,prefix,nodes,values,controls,hasSignatures}=snapshot;return hex(await digest(new TextEncoder().encode(JSON.stringify({format,prefix,nodes,values,controls,hasSignatures,...(snapshot.composition?{composition:true}:{})}))));}
export async function createEditSession(file,snapshot,{history,view,options},fingerprint){
    const draft=modelEditDraft(snapshot,history.commands,history.redo);
    if(view.selected!==null&&!draft.state.nodes.some(n=>n.id===view.selected))throw Error('草稿選取的 OP 不存在。');
    const version=[...history.commands,...history.redo].some(c=>c.kind==='random'&&c.distribution!==undefined)?3:snapshot.composition?2:1;
    return cleanEditSession({format:'model-lens-edit-draft',version,source:{name:file.name,bytes:file.size,format:snapshot.format,algorithm:'sha256-chunks-v1',fingerprint},scope:{nodes:snapshot.nodes.map(n=>n.source),selected:snapshot.selected,signature:await editScopeSignature(snapshot),...(snapshot.composition?{composition:true}:{})},history,view,options});
}
export async function restoreEditSession(index,file,document,fingerprint){
    const saved=cleanEditSession(document);
    if(saved.source.bytes!==file.size||saved.source.format!==(index.mlir?'mlir':'tflite')||saved.source.fingerprint!==fingerprint)throw Error('這不是草稿的原模型：完整檔案指紋或格式／大小不符，未套用任何變更。');
    const {editWorkspaceSnapshot}=await import('./model-edit-workspace.js'),snapshot=editWorkspaceSnapshot(index,{targets:saved.scope.nodes,includeNeighbours:false,composition:saved.scope.composition===true});snapshot.selected=saved.scope.selected;
    if(await editScopeSignature(snapshot)!==saved.scope.signature)throw Error('編輯範圍的解析方式或 dialect 版本不同，未套用變更。');
    const draft=modelEditDraft(snapshot,saved.history.commands,saved.history.redo);if(saved.view.selected!==null&&!draft.state.nodes.some(n=>n.id===saved.view.selected))throw Error('草稿選取的 OP 不存在。');
    return {snapshot,saved};
}
