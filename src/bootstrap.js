// The entry remains independent of the application dependency graph, so a
// failed import or top-level initialization still has a usable recovery path.
export async function startApplication(load,show) {
    show('loading');
    try { await load(); }
    catch { show('failed');return false; }
    show('ready');return true;
}

if (globalThis.document) {
    const panel=document.getElementById('application-startup');
    const title=document.getElementById('application-startup-title');
    const message=document.getElementById('application-startup-message');
    const reload=document.getElementById('application-startup-reload');
    let failed=false;
    // On failure, stop partial application shortcuts; native browser reload and
    // the recovery button's default keyboard activation remain available.
    const guard=event=>{if(failed)event.stopImmediatePropagation();};
    window.addEventListener('keydown',guard,true);
    reload.onclick=()=>location.reload();reload.hidden=false;
    void startApplication(()=>import('./app.js'),state=>{
        panel.dataset.state=state;
        if(state==='ready'){
            const returnFocus=panel.contains(document.activeElement);
            panel.hidden=true;window.removeEventListener('keydown',guard,true);
            if(returnFocus)document.getElementById('open-model').focus({preventScroll:true});
        }else if(state==='failed'){
            failed=true;
            // An initialization error can occur while the independent version
            // dialog is open. Remove that modal before presenting recovery.
            for(const dialog of document.querySelectorAll('dialog[open]'))dialog.close();
            for(const child of document.body.children)if(child!==panel)child.inert=true;
            panel.setAttribute('role','alert');
            title.textContent='網站啟動未完成';
            message.textContent='程式載入或初始化失敗，請重新載入網站後再試。若仍無法啟動，請確認部署檔案完整。';
            reload.focus({preventScroll:true});
        }
    });
}
