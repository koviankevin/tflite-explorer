import {draftStore,readDraft} from './workspace-drafts.js?v=e67611582982ec3f';
import {workspaceSession} from './workspace-session.js?v=e67611582982ec3f';
import {exportWorkspace} from './workspace.js?v=e67611582982ec3f';

export function workspaceSessionUI({capture,apply,ready,settle,restoreDraft,exportFile,error}) {
    const $=id=>document.getElementById(id),dialog=$('draft-dialog');let channel,session,records=[],selected,listGeneration=0,diagnosticState={};
    let enabled=true;try{enabled=localStorage.getItem('model-lens.autosave.v1')!=='off';}catch{/* IDB can still work. */}
    const store=draftStore({notify:record=>{if(record)channel?.postMessage({key:record.key,revision:record.revision,owner:record.owner,deleted:!!record.deleted});}});
    session=workspaceSession({store,capture,apply,ready,settle,enabled,changed:state=>{
        diagnosticState=Object.fromEntries(['enabled','attached','pending','conflict','busy','saving','storageFailed'].map(key=>[key,state[key]]));
        $('autosave-enabled').checked=state.enabled;if($('draft-status').textContent!==state.message)$('draft-status').textContent=state.message;
        $('undo-workspace').disabled=!state.canUndo;$('redo-workspace').disabled=!state.canRedo;
        $('fork-draft').hidden=!state.pending&&!state.conflict;$('resume-draft-prompt').hidden=!state.pending&&!state.conflict;
    }});
    $('autosave-enabled').checked=enabled;
    try{channel=new BroadcastChannel('model-lens.local-drafts.v1');channel.onmessage=event=>session.external(event.data);}catch{/* Atomic IDB revision checks still protect writes. */}
    const select=()=>{
        $('draft-remove-confirm').checked=false;$('remove-draft').disabled=true;
        selected=records.find(r=>r.key===$('draft-list').value);
        $('restore-draft').disabled=!selected;$('download-draft').disabled=!selected;
        if(!selected){$('draft-description').textContent='尚無本機草稿。';return;}
        try{const decoded=readDraft(selected);$('draft-description').textContent=`${decoded.workspace.identity.name} · 第 ${selected.revision} 版${decoded.recoveredPrevious?' · 目前記錄損壞，將恢復上次成功版本':''}。恢復前仍需核對模型。`;}
        catch(e){$('draft-description').textContent=e.message;$('restore-draft').disabled=true;}
    };
    const open=async()=>{
        const generation=++listGeneration;selected=null;
        if(!dialog.open)dialog.showModal();$('draft-description').textContent='讀取本機草稿…';$('restore-draft').disabled=true;$('download-draft').disabled=true;$('remove-draft').disabled=true;$('draft-remove-confirm').checked=false;$('draft-list').disabled=true;
        try {
            await settle();await session.flush({force:true});records=await session.list();
            if(generation!==listGeneration || !dialog.open)return;
            const identity=session.identity;
            records.sort((a,b)=>(b.modelKey===`${identity?.sourceFormat}:${identity?.bytes}:${identity?.signature}`)-(a.modelKey===`${identity?.sourceFormat}:${identity?.bytes}:${identity?.signature}`) || b.updatedAt-a.updatedAt);
            $('draft-list').replaceChildren(...records.map(r=>{let name;try{name=readDraft(r).workspace.identity.name;}catch{name='無法解析的草稿';}return new Option(`${name} · ${new Date(r.updatedAt).toLocaleString()} · v${r.revision}`,r.key);}));$('draft-list').disabled=false;select();
        }catch(e){if(generation===listGeneration)$('draft-description').textContent=e.message;}
    };
    $('open-drafts').onclick=()=>open().catch(error);$('resume-draft-prompt').onclick=$('open-drafts').onclick;
    $('draft-list').onchange=select;$('close-drafts').onclick=()=>{listGeneration++;dialog.close();};dialog.addEventListener('cancel',()=>listGeneration++);
    dialog.addEventListener('keydown',event=>event.stopPropagation());
    $('restore-draft').onclick=async()=>{if(!selected)return;const record=selected;$('restore-draft').disabled=true;$('draft-list').disabled=true;$('remove-draft').disabled=true;try{await restoreDraft(readDraft(record).workspace,record);dialog.close();}catch(e){$('draft-list').disabled=false;select();$('draft-description').textContent=e.message;}};
    $('download-draft').onclick=()=>{if(!selected)return;try{const workspace=readDraft(selected).workspace;exportFile(`${workspace.identity.name.replace(/\.[^.]+$/,'')}-draft.json`,new Blob([exportWorkspace(workspace)+'\n'],{type:'application/json'}));}catch(e){$('draft-description').textContent=e.message;}};
    $('draft-remove-confirm').onchange=()=>{$('remove-draft').disabled=!selected || !$('draft-remove-confirm').checked;};
    $('remove-draft').onclick=async()=>{if(!selected || !$('draft-remove-confirm').checked)return;try{session.external(await store.remove({key:selected.key,revision:selected.revision,owner:session.owner}));await open();}catch(e){$('draft-description').textContent=e.message;}};
    $('fork-draft').onclick=()=>session.fork().catch(error);
    $('undo-workspace').onclick=()=>session.travel(-1).catch(error);$('redo-workspace').onclick=()=>session.travel(1).catch(error);
    $('autosave-enabled').onchange=()=>{const value=$('autosave-enabled').checked;session.setEnabled(value);try{localStorage.setItem('model-lens.autosave.v1',value?'on':'off');}catch{/* Setting remains applied in memory. */}};
    const change=event=>{if(event.target?.closest?.('#draft-dialog, #export-report-dialog, #release-dialog, #diagnostic-dialog, .session-tools'))return;session.change();};
    for(const type of ['click','input','change','pointerup','wheel','scroll'])document.addEventListener(type,change,{capture:true,passive:true});
    document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='hidden')session.flush({force:true});});
    window.addEventListener('pagehide',()=>session.flush({force:true}));
    document.addEventListener('keydown',event=>{
        if(document.querySelector('dialog[open]') || event.target.closest?.('input, textarea, select, [contenteditable="true"]') || !(event.ctrlKey || event.metaKey) || event.altKey)return;
        const key=event.key.toLowerCase();if(key==='z' || key==='y'){event.preventDefault();event.stopPropagation();session.travel(key==='y' || event.shiftKey?1:-1).catch(error);}
    });
    return Object.assign(session,{diagnosticState:()=>({...diagnosticState})});
}
