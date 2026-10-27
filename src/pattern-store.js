import {PATTERN_LIBRARY_KEY,PATTERN_FILE_LIMIT,reusablePattern,patternSignature,planPatternImport,parsePatternFile} from './pattern-library.js?v=e67611582982ec3f';

export const PATTERN_DATABASE='model-lens.pattern-library.v4';
export const PATTERN_CHANNEL='model-lens.pattern-library.v4';
const legacyKeys=[PATTERN_LIBRARY_KEY,'model-lens.patterns.v2','model-lens.patterns.v1'];
const failure=()=>new Error('Pattern 清單版本不支援或資料損壞；原記錄未覆蓋，可使用原版本網站匯出備份。');
export function cleanPatternLibrary(patterns) {
    if(!Array.isArray(patterns))throw failure();
    if(patterns.length>50)throw new Error('最多保存 50 組 patterns；未覆蓋既有清單，請先匯出備份。');
    const clean=patterns.map(p=>reusablePattern(p?.name,p));
    if(new Set(clean.map(p=>p.name)).size!==clean.length)throw failure();
    if(new TextEncoder().encode(JSON.stringify(clean)).length>PATTERN_FILE_LIMIT)throw new Error('Pattern 清單超過 1 MiB；原資料未覆蓋，請分別匯出需要的 patterns 備份。');
    return clean;
}
export function readLegacyPatterns(storage) {
    for(const key of legacyKeys) {
        const raw=storage.getItem(key);if(raw===null || raw===undefined)continue;
        if(new TextEncoder().encode(raw).length>PATTERN_FILE_LIMIT)throw failure();
        let value;try{value=JSON.parse(raw);}catch{throw failure();}
        return {patterns:cleanPatternLibrary(value),legacyKey:key};
    }
    return {patterns:[],legacyKey:null};
}
export function readPatternRecord(record) {
    if(record?.key!=='library' || record.schemaVersion!==1 || !Number.isSafeInteger(record.revision) || record.revision<1 || record.revision>=Number.MAX_SAFE_INTEGER)throw failure();
    return {...record,patterns:cleanPatternLibrary(record.patterns)};
}
// Called inside one read/write transaction. A stale tab may replace only the
// same version it began editing; unrelated additions are merged from storage.
export function mutatePatternLibrary(current,operation) {
    current=cleanPatternLibrary(current);
    if(operation.type==='import')return planPatternImport(current,parsePatternFile(operation.text));
    if(operation.type!=='save')throw new Error('不支援此 pattern 操作。');
    const pattern=reusablePattern(operation.pattern.name,operation.pattern),base=cleanPatternLibrary(operation.base);
    const existing=current.find(p=>p.name===pattern.name),expected=base.find(p=>p.name===pattern.name);
    const same=(a,b)=>a && b && patternSignature(a)===patternSignature(b);
    if(same(existing,pattern))return {patterns:current,pattern:existing,renamed:0,skipped:1};
    if(existing && !same(existing,expected)) {
        const plan=planPatternImport(current,[pattern]);
        // Identical conflict copies are reused on retry rather than multiplying.
        let saved=plan.added[0];
        if(!saved)for(let n=2;n<=51;n++) {
            const candidate=plan.patterns.find(p=>p.name===`${pattern.name.slice(0,70)}（${n}）`);
            if(same(candidate,pattern)){saved=candidate;break;}
        }
        return {...plan,pattern:saved,conflict:true};
    }
    const patterns=cleanPatternLibrary([...current.filter(p=>p.name!==pattern.name),pattern]);
    return {patterns,pattern,renamed:0,skipped:0};
}
export function patternStore({indexedDB=globalThis.indexedDB,legacyStorage=()=>globalThis.localStorage,notify=()=>{}}={}) {
    let connection;
    const database=()=>connection ||= new Promise((resolve,reject)=>{
        if(!indexedDB){reject(new Error('此瀏覽器無法保存 pattern 清單；目前編輯仍可搜尋，可下載工作階段備份。'));return;}
        const request=indexedDB.open(PATTERN_DATABASE,1);let abandoned=false;
        request.onupgradeneeded=()=>request.result.createObjectStore('patterns',{keyPath:'key'});
        request.onerror=()=>{connection=null;reject(request.error);};
        request.onblocked=()=>{abandoned=true;connection=null;reject(new Error('Pattern 資料庫被其他版本分頁阻擋，請先關閉舊分頁。'));};
        request.onsuccess=()=>{const db=request.result;if(abandoned){db.close();return;}db.onversionchange=()=>{db.close();connection=null;};resolve(db);};
    });
    const transaction=async(operation)=>{
        const db=await database();
        return new Promise((resolve,reject)=>{
            const tx=db.transaction('patterns','readwrite'),store=tx.objectStore('patterns'),request=store.get('library');let result,error,changed=false;
            request.onsuccess=()=>{
                try {
                    const previous=request.result?readPatternRecord(request.result):null;
                    // Read legacy data only when the new store is absent. Legacy
                    // keys stay untouched, including invalid or future formats.
                    const seed=previous || {key:'library',schemaVersion:1,revision:0,...readLegacyPatterns(legacyStorage())};
                    const change=operation?mutatePatternLibrary(seed.patterns,operation):{patterns:seed.patterns};
                    const patterns=cleanPatternLibrary(change.patterns);
                    changed=!previous || JSON.stringify(patterns)!==JSON.stringify(seed.patterns);
                    const record=changed?{...seed,revision:seed.revision+1,patterns,updatedAt:Date.now()}:seed;
                    if(changed)store.put(record);
                    result={...change,record};
                }catch(cause){error=cause;tx.abort();}
            };
            tx.oncomplete=()=>{
                resolve(result);
                // Notification is advisory; a failed/closed channel cannot turn
                // a committed save into a permanently pending UI operation.
                if(changed)try{notify(result.record);}catch{/* Focus refresh reads the committed revision. */}
            };
            tx.onabort=()=>reject(error || tx.error || new Error('Pattern 儲存未完成；目前編輯已保留。'));
            tx.onerror=()=>{};
        });
    };
    return {
        async load(){return (await transaction()).record;},
        save(pattern,base){return transaction({type:'save',pattern,base});},
        import(text){return transaction({type:'import',text});},
        async close(){if(connection){const db=await connection;db.close();connection=null;}}
    };
}
