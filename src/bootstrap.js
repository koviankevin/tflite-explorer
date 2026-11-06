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
    const status=document.getElementById('status');
    const input=document.getElementById('model-file');
    const openButtons=['open-model','welcome-open'].map(id=>document.getElementById(id));
    let failed=false,pendingFile,application;
    const openChooser=()=>{input.value='';input.click();};
    for(const button of openButtons){
        button.onclick=openChooser;
        button.disabled=false;
    }
    input.onchange=()=>{
        const file=input.files[0];
        if(!file)return;
        if(panel.dataset.state==='ready')void application.openFile(file);
        else if(!failed){
            pendingFile=file;
            message.textContent='已選擇模型，網站載入完成後會自動開啟。';
        }
    };
    // On failure, stop partial application shortcuts; native browser reload and
    // the recovery button's default keyboard activation remain available.
    const guard=event=>{if(failed)event.stopImmediatePropagation();};
    window.addEventListener('keydown',guard,true);
    reload.onclick=()=>location.reload();reload.hidden=false;
    void startApplication(async()=>{application=await import('./app.js');},state=>{
        panel.dataset.state=state;
        if(state==='loading')status.textContent='正在載入網站';
        if(state==='ready'){
            const returnFocus=panel.contains(document.activeElement);
            panel.hidden=true;window.removeEventListener('keydown',guard,true);
            for(const id of ['open-demo','open-lora-demo','open-mlir-demo'])document.getElementById(id).disabled=false;
            if(returnFocus)openButtons[0].focus({preventScroll:true});
            const file=pendingFile;pendingFile=undefined;
            if(file)void application.openFile(file);
        }else if(state==='failed'){
            failed=true;pendingFile=undefined;input.value='';
            for(const button of openButtons)button.disabled=true;
            status.textContent='網站啟動未完成';
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
