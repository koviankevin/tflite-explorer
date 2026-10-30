import {parseWorkspace,exportWorkspace,WORKSPACE_LIMIT} from './workspace.js';
export const DRAFT_DATABASE='model-lens.local-drafts.v1';
export const draftModelKey=identity=>`${identity.sourceFormat}:${identity.bytes}:${identity.signature}`;
export class DraftConflict extends Error {constructor(){super('另一分頁已更新這份草稿；你的操作保留在目前分頁，請恢復新版或另開草稿。');this.name='DraftConflict';}}
export function readDraft(record) {
    if(record?.schemaVersion!==1 || !Number.isSafeInteger(record.revision) || record.revision<1 || typeof record.key!=='string' || typeof record.modelKey!=='string' || typeof record.text!=='string' || record.text.length>WORKSPACE_LIMIT)throw new Error('草稿版本不支援或資料損壞；未覆蓋原記錄。');
    let header;try{header=JSON.parse(record.text.replace(/^\uFEFF/,''));}catch{/* Malformed current JSON may recover the last known good record. */}
    if(header?.format && (header.format!=='model-lens-workspace' || ![1,2].includes(header.version)))throw new Error('草稿來自不支援的版本；請使用新版網站，或另開草稿。原記錄未覆蓋。');
    const decode=text=>{const workspace=parseWorkspace(text);if(draftModelKey(workspace.identity)!==record.modelKey)throw new Error('草稿的模型對照不符。');return workspace;};
    try{return {...record,workspace:decode(record.text),recoveredPrevious:false};}
    catch(error){if(typeof record.previous!=='string')throw error;return {...record,workspace:decode(record.previous),recoveredPrevious:true};}
}
export function draftStore({indexedDB=globalThis.indexedDB,notify=()=>{}}={}) {
    let connection;
    const database=()=>{
        if(connection)return connection;
        const attempt=new Promise((resolve,reject)=>{
            if(!indexedDB){reject(new Error('此瀏覽器無法使用本機草稿；可改用工作階段檔案。'));return;}
            const request=indexedDB.open(DRAFT_DATABASE,1);let abandoned=false;
            request.onupgradeneeded=()=>{const store=request.result.createObjectStore('drafts',{keyPath:'key'});store.createIndex('modelKey','modelKey');};
            request.onerror=()=>reject(request.error);
            request.onblocked=()=>{abandoned=true;reject(new Error('本機草稿資料庫被舊分頁阻擋，請關閉舊版分頁後再試。'));};
            request.onsuccess=()=>{const db=request.result;if(abandoned){db.close();return;}const invalidate=()=>{if(connection===attempt)connection=null;};db.onclose=invalidate;db.onversionchange=()=>{db.close();invalidate();try{notify();}catch{/* Advisory refresh only. */}};resolve(db);};
        });
        connection=attempt;
        // Synchronous open throws and request errors invalidate only their own
        // attempt. Late events must not evict a replacement connection.
        attempt.catch(()=>{if(connection===attempt)connection=null;});
        return attempt;
    };
    return {
        async list(identity) {
            const db=await database();return new Promise((resolve,reject)=>{
                const tx=db.transaction('drafts','readonly'),store=tx.objectStore('drafts');
                const request=identity?store.index('modelKey').getAll(draftModelKey(identity)):store.getAll();
                let result;request.onsuccess=()=>{result=request.result.sort((a,b)=>b.updatedAt-a.updatedAt);};request.onerror=()=>reject(request.error);
                tx.oncomplete=()=>resolve(result);tx.onabort=()=>reject(tx.error||new Error('草稿讀取未完成；未套用資料，請重試。'));tx.onerror=()=>{};
            });
        },
        async save({key,revision,owner,workspace}) {
            const text=exportWorkspace(workspace),modelKey=draftModelKey(workspace.identity),db=await database();
            return new Promise((resolve,reject)=>{
                const tx=db.transaction('drafts','readwrite'),store=tx.objectStore('drafts'),request=store.get(key);let result,failure;
                request.onsuccess=()=>{
                    const previous=request.result;
                    if((previous?.revision || 0)!==revision){failure=new DraftConflict();tx.abort();return;}
                    if(previous && (previous.schemaVersion!==1 || previous.modelKey!==modelKey)){failure=new Error('不覆蓋未知版本或其他模型的草稿。');tx.abort();return;}
                    let backup=null;
                    if(previous)try{backup=exportWorkspace(readDraft(previous).workspace);}catch{/* Keep corrupt/unknown bytes untouched by refusing below. */}
                    if(previous && !backup){failure=new Error('草稿已損壞；請另開草稿，原資料已保留。');tx.abort();return;}
                    const write=()=>{result={schemaVersion:1,key,modelKey,revision:revision+1,owner,updatedAt:Date.now(),text,previous:backup};store.put(result);};
                    if(previous)write();else{const count=store.count();count.onsuccess=()=>{if(count.result>=20){failure=new Error('已達 20 份本機草稿上限；請先下載並移除不需要的草稿。');tx.abort();}else write();};}
                };
                tx.oncomplete=()=>{resolve(result);try{notify(result);}catch{/* The save is already committed. */}};tx.onabort=()=>reject(failure || tx.error || new Error('自動儲存未完成。'));tx.onerror=()=>{};
            });
        },
        async remove({key,revision,owner}) {
            const db=await database();return new Promise((resolve,reject)=>{
                const tx=db.transaction('drafts','readwrite'),store=tx.objectStore('drafts'),request=store.get(key);let failure,notice;
                request.onsuccess=()=>{const record=request.result;if(!record || record.revision!==revision){failure=new DraftConflict();tx.abort();return;}try{readDraft(record);}catch(error){failure=error;tx.abort();return;}store.delete(key);notice={key,revision:revision+1,owner,deleted:true};};
                tx.oncomplete=()=>{resolve(notice);try{notify(notice);}catch{/* The removal is already committed. */}};tx.onabort=()=>reject(failure || tx.error);tx.onerror=()=>{};
            });
        },
        async close(){if(connection){const db=await connection;db.close();connection=null;}}
    };
}
