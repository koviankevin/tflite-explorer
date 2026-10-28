import {createEditSession,exportEditSession} from './model-edit-session.js';
import {editRecoveryStore,readEditRecovery,EDIT_RECOVERY_CHANNEL} from './edit-recovery-store.js';
import {editRecoverySession} from './edit-recovery-session.js';
import {editRecoveryFingerprint} from './edit-recovery-fingerprint.js';

export function editRecoveryUI({capture,restore,exportFile,chooseImport}){
    const $=id=>document.getElementById(id),dialog=$('edit-recovery-dialog');let channel,records=[],selected=null,listGeneration=0,state;
    let enabled=true;try{enabled=localStorage.getItem('model-lens.edit-autosave.v1')!=='off';}catch{/* In-memory preference still applies. */}
    const store=editRecoveryStore({notify:record=>{try{channel?.postMessage({key:record.key,revision:record.revision,owner:record.owner,deleted:!!record.deleted});}catch{/* Commit remains successful. */}if(dialog.open)refresh().catch(showError);}});
    let session;const fingerprint=editRecoveryFingerprint({progress:(done,total)=>session?.progress(done,total)});
    const showError=error=>{$('edit-recovery-description').textContent=error.message;};
    session=editRecoverySession({store,enabled,capture:()=>{
        const value=capture();if(!value||value.snapshot.format!=='tflite')throw Error('尚無可保存的 TFLite 編輯草稿。');
        // Snapshot before the first await: a late save can only own this source.
        const {file,snapshot,history,view,options}=value,copy=structuredClone({snapshot,history,view,options});
        return fingerprint.read(file).then(hash=>createEditSession(file,copy.snapshot,copy,hash));
    },changed:next=>{state=next;$('edit-autosave-enabled').checked=next.enabled;if($('edit-recovery-status').textContent!==next.message)$('edit-recovery-status').textContent=next.message;$('edit-recovery-status').title=next.message;$('edit-recovery-status').dataset.error=String(next.failed||next.conflict);if($('edit-recovery-dialog-status').textContent!==next.message)$('edit-recovery-dialog-status').textContent=next.message;$('retry-edit-recovery').disabled=!next.attached||!next.enabled;$('fork-edit-recovery').disabled=!next.attached||!next.enabled;}});
    try{channel=new BroadcastChannel(EDIT_RECOVERY_CHANNEL);channel.onmessage=event=>{session.external(event.data);if(dialog.open)refresh().catch(showError);};}catch{/* Revision checks protect writes without BroadcastChannel. */}
    const selection=()=>{
        $('remove-edit-recovery-confirm').checked=false;$('remove-edit-recovery').disabled=true;
        selected=records.find(r=>r.key===$('edit-recovery-list').value);$('restore-edit-recovery').disabled=!selected;$('download-edit-recovery').disabled=!selected;
        if(!selected){$('edit-recovery-description').textContent='尚無已保存的本機編輯草稿。';return;}
        try{const decoded=readEditRecovery(selected),doc=decoded.document;$('edit-recovery-description').textContent=`${doc.source.name} · ${doc.source.bytes.toLocaleString()} bytes · ${doc.history.commands.length} 筆命令／${doc.history.redo.length} 筆重做 · 第 ${selected.revision} 版${decoded.recoveredPrevious?'。目前記錄損壞，會恢復上次成功版本':''}。恢復前請重新選原模型，核對完整檔案指紋。`;}
        catch(error){$('edit-recovery-description').textContent=error.message;$('restore-edit-recovery').disabled=true;$('download-edit-recovery').disabled=true;}
    };
    async function refresh(){
        const generation=++listGeneration,previous=$('edit-recovery-list').value;const found=await store.list();if(generation!==listGeneration||!dialog.open)return;
        records=found;$('edit-recovery-list').replaceChildren(...records.map(record=>{let name;try{name=readEditRecovery(record).document.source.name;}catch{name='無法解析的編輯草稿';}return new Option(`${name} · ${new Date(record.updatedAt||0).toLocaleString()} · v${record.revision}`,record.key);}));
        if(records.some(r=>r.key===previous))$('edit-recovery-list').value=previous;selection();
    }
    $('open-edit-draft').onclick=()=>{dialog.showModal();$('edit-recovery-description').textContent='讀取本機編輯草稿…';refresh().catch(showError);};
    const close=()=>{listGeneration++;dialog.close();};$('close-edit-recovery').onclick=close;dialog.addEventListener('cancel',()=>listGeneration++);dialog.addEventListener('keydown',event=>event.stopPropagation());
    $('edit-recovery-list').onchange=selection;
    $('choose-edit-draft-file').onclick=()=>{close();chooseImport();};
    $('restore-edit-recovery').onclick=()=>{if(!selected)return;try{const record=readEditRecovery(selected);restore(record.document,record);close();}catch(error){showError(error);}};
    $('download-edit-recovery').onclick=()=>{if(!selected)return;try{const doc=readEditRecovery(selected).document;exportFile(doc.source.name.replace(/\.[^.]+$/,'')+'-edit-draft.json',new Blob([exportEditSession(doc)],{type:'application/json'}));}catch(error){showError(error);}};
    $('remove-edit-recovery-confirm').onchange=()=>{$('remove-edit-recovery').disabled=!selected||!$('remove-edit-recovery-confirm').checked||$('restore-edit-recovery').disabled;};
    $('remove-edit-recovery').onclick=async()=>{if(!selected||!$('remove-edit-recovery-confirm').checked)return;try{const record=await store.remove({key:selected.key,revision:selected.revision,owner:session.owner});session.external(record,true);await refresh();}catch(error){showError(error);}};
    $('edit-autosave-enabled').onchange=()=>{const on=$('edit-autosave-enabled').checked;session.setEnabled(on);if(!on)fingerprint.cancel();try{localStorage.setItem('model-lens.edit-autosave.v1',on?'on':'off');}catch{/* Preference remains applied in memory. */}};
    $('retry-edit-recovery').onclick=()=>session.retry();$('fork-edit-recovery').onclick=()=>session.fork();
    document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='hidden')session.flush();});window.addEventListener('pagehide',()=>session.flush());
    return {get touched(){return session.touched;},get binding(){return session.binding;},attach:record=>session.attach(record),change:()=>session.change(),detach(){const pending=session.detach();fingerprint.cancel();return pending;},state:()=>({...state})};
}
