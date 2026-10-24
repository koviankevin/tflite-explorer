import {reusablePattern} from './pattern-library.js';
export const WORKSPACE_KEY='model-lens.workspace.v1';
export const WORKSPACE_LIMIT=2*1024*1024;
const integer=(n,max=10000000)=>Number.isSafeInteger(n) && n>=0 && n<=max;
const text=(value,max=4096)=>typeof value==='string' && value.length<=max;
const number=n=>Number.isFinite(n) && Math.abs(n)<=1e12;
const unique=(list,max,count)=>Array.isArray(list) && list.length<=count && list.every(n=>integer(n,max)) && new Set(list).size===list.length;
const fail=()=>{throw new Error('工作階段格式無效或超過支援的上限。');};
// Overview projections omit detailed edge arrays; the physical operator path
// and block membership remain stable across projections of the same query.
export const resultKey=item=>item?JSON.stringify([item.kind,item.graph,item.index,item.id,item.path,item.blocks]):null;
export function sameResultKey(saved,item) {
    try {return JSON.stringify(JSON.parse(saved).slice(0,6))===resultKey(item);}catch{return false;}
}

export function cleanWorkspace(value) {
    if(value?.format!=='model-lens-workspace' || value.version!==1)fail();
    const {identity,state:s}=value;
    if(!identity || !text(identity.name,1024) || !integer(identity.bytes,Number.MAX_SAFE_INTEGER) || !['tflite','mlir'].includes(identity.sourceFormat) || !/^[a-f0-9]{64}$/.test(identity.signature))fail();
    if(!s || !['layers','tensors','patterns'].includes(s.kind) || !text(s.query) || !text(s.scope,32) || !/^(current|all|\d+)$/.test(s.scope) || !integer(s.graph) || !['none','graph','result','overview'].includes(s.view) || !integer(s.activeIndex+1,50000) || !(s.resultKey===null || text(s.resultKey,65536)))fail();
    if(s.view==='overview' && s.kind!=='patterns')fail();
    if(!['14','16','18','20','24','28','32'].includes(s.font) || !['vertical','horizontal'].includes(s.direction) || !integer(s.sidebarWidth,720) || s.sidebarWidth<280 || !['slice','function'].includes(s.exportScope))fail();
    for(const key of ['full','collapsed','picking','across','sliceDetails'])if(typeof s[key]!=='boolean')fail();
    if(!text(s.captureName,80) || !text(s.patternName,80) || !text(s.patternText,16384) || !['visual','text'].includes(s.patternMode))fail();
    if(!unique(s.overviewExpanded,49999,50000) || !Array.isArray(s.expanded) || s.expanded.length>512 || s.expanded.some(k=>!text(k,512)) || new Set(s.expanded).size!==s.expanded.length)fail();
    if(!Array.isArray(s.pages) || s.pages.length>512 || s.pages.some(p=>!Array.isArray(p) || p.length!==2 || !s.expanded.includes(p[0]) || !integer(p[1])))fail();
    if(!Array.isArray(s.selections) || s.selections.length>32 || new Set(s.selections.map(b=>b?.graph)).size!==s.selections.length || s.selections.some(b=>!integer(b.graph) || !unique(b.nodes,10000000,32)) || s.selections.reduce((n,b)=>n+b.nodes.length,0)>32)fail();
    if(!s.across && (s.selections.length>1 || s.selections.some(b=>b.graph!==s.graph)))fail();
    if(s.camera!==null) {
        const c=s.camera;if(!c || !['svg','canvas'].includes(c.kind) || !number(c.zoom) || c.zoom<.00001 || c.zoom>100)fail();
        if(c.kind==='canvas') {if(!number(c.x) || !number(c.y))fail();}
        else {
            if(!number(c.scrollLeft) || !number(c.scrollTop) || !Array.isArray(c.candidates) || c.candidates.length>8 || c.candidates.some(a=>!text(a.id,512) || !number(a.x) || !number(a.y)))fail();
            if(c.page!==null && (!c.page || !number(c.page.left) || !number(c.page.top)))fail();
        }
    }
    const pattern=reusablePattern(s.patternName || '工作階段 pattern',s.pattern);
    // Whitelist stored fields: imports cannot smuggle model contents or code.
    const state={};
    for(const key of ['kind','query','scope','graph','view','activeIndex','resultKey','font','direction','sidebarWidth','exportScope','full','collapsed','picking','across','sliceDetails','captureName','patternName','patternText','patternMode','overviewExpanded','expanded','pages','selections','camera'])state[key]=structuredClone(s[key]);
    state.pattern=pattern;
    return {format:value.format,version:1,identity:{name:identity.name,bytes:identity.bytes,sourceFormat:identity.sourceFormat,signature:identity.signature},state};
}
export function exportWorkspace(value) {
    const text=JSON.stringify(cleanWorkspace(value),null,2);
    if(new TextEncoder().encode(text).length>WORKSPACE_LIMIT)throw new Error('工作階段檔案不得超過 2 MiB。');
    return text;
}
export function parseWorkspace(text) {
    if(new TextEncoder().encode(text).length>WORKSPACE_LIMIT)throw new Error('工作階段檔案不得超過 2 MiB。');
    let value;try {value=JSON.parse(text.replace(/^\uFEFF/,''));}catch{throw new Error('無法解析工作階段 JSON。');}
    return cleanWorkspace(value);
}
export function checkWorkspace(workspace,identity,graphs) {
    const expected=workspace.identity;
    if(expected.bytes!==identity.bytes || expected.sourceFormat!==identity.sourceFormat || expected.signature!==identity.signature)throw new Error('模型結構或檔案大小與工作階段不符；未套用舊選取。請重新選擇原模型。');
    const s=workspace.state;
    if(!graphs[s.graph] || (/^\d+$/.test(s.scope) && !graphs[Number(s.scope)]) || s.selections.some(b=>!graphs[b.graph] || b.nodes.some(n=>n>=graphs[b.graph].layers)))throw new Error('工作階段的 block 或 layer 編號超出模型範圍。');
}

// A structural fingerprint, deliberately excluding weight payloads. A changed
// connection/type/attribute is rejected; equal-structure weight variants can resume.
export async function workspaceIdentity(index,file) {
    const values=args=>(args || []).map(a=>({name:a.name,values:Array.isArray(a.value)?a.value.map(v=>v && typeof v==='object'?{id:v.identifier,type:v.type?String(v.type.spelling || v.type.dataType):null,shape:v.type?.shape?.dimensions}:String(v)):String(a.value)}));
    const graphs=[];
    for(const entry of index.graphs) {
        const nodes=entry.graph.nodes.map(n=>({id:n.identifier,type:n.type.name,inputs:values(n.inputs),outputs:values(n.outputs),attributes:(n.attributes || []).map(a=>[a.name,typeof a.value==='bigint'?String(a.value):a.value]),successors:(n.metadata || []).filter(a=>a.name==='successors').map(a=>a.value)}));
        const text=JSON.stringify({name:entry.graph.name,inputs:values(entry.graph.inputs),outputs:values(entry.graph.outputs),nodes},(_,v)=>typeof v==='bigint'?String(v):ArrayBuffer.isView(v)?Array.from(v):v);
        graphs.push([...new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(text)))].map(n=>n.toString(16).padStart(2,'0')).join(''));
    }
    const signature=[...new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify(graphs))))].map(n=>n.toString(16).padStart(2,'0')).join('');
    return {name:file.name,bytes:file.size,sourceFormat:index.sourceFormat,signature};
}
