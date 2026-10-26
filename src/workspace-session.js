import {exportWorkspace,parseWorkspace} from './workspace.js?v=4e44cfa55e34993c';
import {WorkspaceHistory} from './workspace-history.js?v=4e44cfa55e34993c';
import {draftModelKey,DraftConflict,readDraft} from './workspace-drafts.js?v=4e44cfa55e34993c';
const id=()=>Array.from(crypto.getRandomValues(new Uint32Array(4)),n=>n.toString(16).padStart(8,'0')).join('');

// The controller owns history, save ordering and optimistic concurrency. UI and
// IndexedDB are adapters; model objects/File/Blob never enter this module.
export function workspaceSession({store,capture,apply,ready=()=>true,changed=()=>{},enabled=true,owner=id(),delay=600}) {
    const history=new WorkspaceHistory();let active=null,timer=null,generation=0,applying=false,writing=null,observed=null,message='開啟模型後開始保存本機草稿。';
    const emit=()=>changed({message,enabled,attached:!!active,pending:!!active?.pending,conflict:!!active?.conflict,busy:applying,canUndo:history.canUndo&&!applying,canRedo:history.canRedo&&!applying,saving:!!writing});
    const sample=(force=false)=>{if(!active || applying || (!force&&!ready()))return false;const text=exportWorkspace(capture(active.identity));if(text!==observed){history.push(text);observed=text;}return true;};
    const savedMessage=current=>current.savedAt?`已自動儲存 ${new Date(current.savedAt).toLocaleTimeString()} · 僅含操作狀態`:'自動草稿已就緒。';
    const schedule=()=>{
        clearTimeout(timer);if(!active || applying)return;
        active.changeSequence=(active.changeSequence || 0)+1;
        if(enabled && !active.pending && !active.conflict && !active.storageError){message='操作變更待儲存…';emit();}
        timer=setTimeout(()=>flush(),delay);
    };
    async function flush({force=false}={}) {
        clearTimeout(timer);timer=null;const current=active;
        if(!current || applying)return;
        if(!force&&!ready()){schedule();return;}
        try{sample(force);}catch(error){message=`草稿尚未儲存：${error.message}`;emit();return;}
        emit();
        const text=history.current;if(!text)return;
        if(writing){if(!force)return;await writing.catch(()=>{});}
        if(!enabled || current.storageError || current.pending || current.conflict)return;
        if(text===current.saved){if(active===current){message=savedMessage(current);emit();}return;}
        const sequence=current.changeSequence;
        if(active===current)message='正在自動儲存…';
        const saving=store.save({key:current.key,revision:current.revision,owner,workspace:parseWorkspace(text)});writing=saving;if(active===current)emit();
        try {
            const record=await saving;current.revision=record.revision;current.saved=text;current.savedAt=record.updatedAt;
            if(active===current){message=current.changeSequence===sequence?savedMessage(current):'新的操作待儲存…';}
        }catch(error){current.conflict=error instanceof DraftConflict;if(active===current)message=error.message;}
        finally{if(writing===saving)writing=null;if(active===current){emit();if(!current.conflict && history.current!==text)schedule();}else if(active)schedule();}
    }
    return {
        get identity(){return active?.identity;},
        get current(){return history.current;},
        get owner(){return owner;},
        async attach(identity,{resumed}={}) {
            const token=++generation;clearTimeout(timer);history.clear();observed=null;active=null;
            let records=[],loadError;try{records=await store.list(identity);}catch(error){loadError=error;}
            if(token!==generation)return;
            const found=resumed?records.find(r=>r.key===resumed.key):records[0];
            active={identity,key:found?.key || draftModelKey(identity)+(loadError?'~'+id():''),revision:resumed?.revision ?? found?.revision ?? 0,saved:resumed?exportWorkspace(readDraft(resumed).workspace):null,savedAt:resumed?.updatedAt,pending:!!found&&!resumed,conflict:!!resumed && found?.revision!==resumed.revision,storageError:loadError};
            sample();message=loadError?`無法讀取本機草稿：${loadError.message}；Undo／Redo 仍可使用，請手動下載備份。`:active.conflict?'草稿在恢復期間已由另一分頁更新；請恢復新版或另開草稿。':active.pending?'找到本機草稿。請恢復，或另開草稿以保留兩份。':'自動草稿已就緒。';emit();if(!active.pending&&!active.conflict&&!loadError)schedule();
        },
        detach() {
            // Capture synchronously before the app clears the model. A write
            // already started owns its old record and cannot target a new file.
            const flushing=active&&!applying?flush({force:true}):undefined;
            generation++;clearTimeout(timer);active=null;history.clear();observed=null;message='開啟模型後開始保存本機草稿。';emit();
            return flushing;
        },
        change:schedule,flush,
        setEnabled(value){enabled=!!value;if(enabled&&active)active.storageError=null;message=enabled?'自動草稿已啟用。':'自動草稿已暫停；仍可手動下載工作階段。';emit();if(enabled)schedule();},
        async fork() {
            if(!active || applying)return;
            if(writing)await writing.catch(()=>{});
            if(!active)return;
            active={identity:active.identity,key:draftModelKey(active.identity)+'~'+id(),revision:0,saved:null,pending:false,conflict:false};message='已另開草稿，原記錄保留。';await flush();emit();
        },
        external(record) {
            if(active && record?.key===active.key && (record.deleted || record.owner!==owner) && record.revision>active.revision){active.conflict=true;clearTimeout(timer);message=record.deleted?'這份草稿已被移除；目前操作仍保留，請另開草稿繼續保存。':'另一分頁已更新同一份草稿。你的操作仍保留，請恢復新版或另開草稿。';emit();}
        },
        async resume(record) {
            if(!active || applying)return;
            const decoded=readDraft(record),current=active;
            if(draftModelKey(decoded.workspace.identity)!==draftModelKey(current.identity))throw new Error('請先選取這份草稿的原模型。');
            applying=true;emit();
            try {
                await apply(decoded.workspace);
                if(active!==current)return;
                active={identity:current.identity,key:record.key,revision:record.revision,saved:exportWorkspace(decoded.workspace),savedAt:record.updatedAt,pending:false,conflict:false};
                observed=exportWorkspace(capture(current.identity));history.push(observed);message=decoded.recoveredPrevious?'已恢復上次成功版本；損壞的記錄未直接套用。':'已恢復本機草稿。';
            } finally {applying=false;emit();schedule();}
        },
        async travel(delta) {
            if(!active || applying)return;
            if(!ready()){message='請等待搜尋、繪圖或匯出完成後再復原／重做。';emit();return;}
            sample();const target=history.target(delta);if(!target)return;
            const current=active;applying=true;emit();
            try{await apply(target.workspace);if(active===current){history.move(target.position);observed=exportWorkspace(capture(current.identity));message=delta<0?'已復原上一步操作。':'已重做操作。';}}
            finally{applying=false;emit();schedule();}
        },
        list:()=>store.list(),
        fail(error){message=`無法保存本機草稿：${error.message}；請手動下載工作階段。`;emit();}
    };
}
