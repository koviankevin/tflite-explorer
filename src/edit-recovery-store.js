import {cleanEditSession,parseEditSession,exportEditSession,EDIT_DRAFT_LIMIT} from './model-edit-session.js';
export const EDIT_RECOVERY_DATABASE='model-lens.edit-recovery.v1';
export const EDIT_RECOVERY_CHANNEL='model-lens.edit-recovery.v1';
export const EDIT_RECOVERY_COUNT=20;
export const editRecoveryModelKey=source=>`${source.format}:${source.bytes}:${source.fingerprint}`;
export class EditRecoveryConflict extends Error{constructor(){super('這份編輯草稿已由另一分頁更新或移除；目前編輯保留，可另存副本。');this.name='EditRecoveryConflict';}}
const invalid=()=>Error('本機編輯草稿版本不支援或記錄損壞；未覆蓋原資料。');
const key=value=>typeof value==='string'&&/^[a-f0-9]{32}$/.test(value);
export function readEditRecovery(record){
    if(record?.schemaVersion!==1||!key(record.key)||!key(record.owner)||!Number.isSafeInteger(record.revision)||record.revision<1||!Number.isSafeInteger(record.updatedAt)||record.updatedAt<0||typeof record.text!=='string'||record.text.length>EDIT_DRAFT_LIMIT)throw invalid();
    let header;try{header=JSON.parse(record.text);}catch{/* A torn/corrupt supported head may use its committed previous version. */}
    if(header?.format&&(header.format!=='model-lens-edit-draft'||header.version!==1))throw invalid();
    const decode=text=>{const document=parseEditSession(text);if(document.source.format!=='tflite'||editRecoveryModelKey(document.source)!==record.modelKey)throw invalid();return document;};
    try{return {...record,document:decode(record.text),recoveredPrevious:false};}
    catch(reason){if(typeof record.previous!=='string')throw reason;return {...record,document:decode(record.previous),recoveredPrevious:true};}
}
// A missing record has revision zero: stale saves cannot recreate a deleted key.
export function nextEditRecovery(previous,{key:recordKey,revision,owner,document},count=0,now=Date.now()){
    if(!key(recordKey)||!key(owner)||!Number.isSafeInteger(revision)||revision<0||revision>=Number.MAX_SAFE_INTEGER)throw invalid();
    if((previous?.revision||0)!==revision)throw new EditRecoveryConflict();
    document=cleanEditSession(document);if(document.source.format!=='tflite')throw invalid();
    const modelKey=editRecoveryModelKey(document.source),text=exportEditSession(document);
    if(previous&&(previous.key!==recordKey||previous.modelKey!==modelKey))throw invalid();
    const backup=previous?exportEditSession(readEditRecovery(previous).document):null;
    if(!previous&&count>=EDIT_RECOVERY_COUNT)throw Error('已達 20 份本機編輯草稿上限；請先下載並移除不需要的草稿。');
    return {schemaVersion:1,key:recordKey,owner,modelKey,revision:revision+1,updatedAt:now,text,previous:backup};
}
export function editRecoveryStore({indexedDB=globalThis.indexedDB,notify=()=>{}}={}){
    let connection;
    const database=()=>connection ||= new Promise((resolve,reject)=>{
        if(!indexedDB){reject(Error('無法使用本機編輯草稿資料庫，請下載編輯草稿 JSON 備份。'));return;}
        const request=indexedDB.open(EDIT_RECOVERY_DATABASE,1);let abandoned=false;
        request.onupgradeneeded=()=>request.result.createObjectStore('drafts',{keyPath:'key'});
        request.onerror=()=>{connection=null;reject(request.error);};request.onblocked=()=>{abandoned=true;connection=null;reject(Error('本機編輯草稿資料庫被舊分頁阻擋；請關閉舊版分頁後再試。'));};
        request.onsuccess=()=>{const db=request.result;if(abandoned){db.close();return;}db.onversionchange=()=>{db.close();connection=null;};resolve(db);};
    });
    const advisory=record=>{try{notify(record);}catch{/* The transaction is already committed. */}};
    return {
        async list(){const db=await database();return new Promise((resolve,reject)=>{const tx=db.transaction('drafts','readonly'),request=tx.objectStore('drafts').getAll(null,EDIT_RECOVERY_COUNT+1);request.onsuccess=()=>{if(request.result.length>EDIT_RECOVERY_COUNT){reject(Error('本機編輯草稿數量超過本版上限，請使用建立記錄的版本整理；原資料保留。'));return;}resolve(request.result.sort((a,b)=>(b.updatedAt||0)-(a.updatedAt||0)));};request.onerror=()=>reject(request.error);});},
        async save(args){const document=cleanEditSession(args.document),db=await database();return new Promise((resolve,reject)=>{
            const tx=db.transaction('drafts','readwrite',{durability:'strict'}),store=tx.objectStore('drafts'),request=store.get(args.key);let result,failure;
            request.onsuccess=()=>{const previous=request.result;const put=count=>{try{result=nextEditRecovery(previous,{...args,document},count);store.put(result);}catch(reason){failure=reason;tx.abort();}};if(previous)put(0);else {const count=store.count();count.onsuccess=()=>put(count.result);}};
            tx.oncomplete=()=>{advisory(result);resolve(result);};tx.onabort=()=>reject(failure||tx.error||Error('本機編輯草稿未完成保存。'));tx.onerror=()=>{};
        });},
        async remove({key:recordKey,revision,owner}){const db=await database();return new Promise((resolve,reject)=>{
            const tx=db.transaction('drafts','readwrite',{durability:'strict'}),store=tx.objectStore('drafts'),request=store.get(recordKey);let failure,result;
            request.onsuccess=()=>{try{const current=request.result;if(!current||current.revision!==revision)throw new EditRecoveryConflict();readEditRecovery(current);store.delete(recordKey);result={key:recordKey,owner,revision:revision+1,deleted:true};}catch(reason){failure=reason;tx.abort();}};
            tx.oncomplete=()=>{advisory(result);resolve(result);};tx.onabort=()=>reject(failure||tx.error);tx.onerror=()=>{};
        });},
        async close(){if(connection){const db=await connection;db.close();connection=null;}}
    };
}
