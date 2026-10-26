export function releaseRows(release) {
    if(release?.schemaVersion!==1 || typeof release.version!=='string' || !/^[a-f0-9]{16}$/.test(release.buildId) || !['public','internal'].includes(release.distribution) || !/^[a-f0-9]{40}$/.test(release.source?.commit))throw new Error('版本資訊格式無效。');
    return [['版本',release.version],['發行類型',release.distribution==='public'?'公開版':'內網版'],['建置編號',release.buildId],['來源 commit',release.source.commit],['來源狀態',release.source.dirty?'含未提交修改的開發建置':'固定 commit 建置'],...(release.extension?[['Dialect 擴充',`${release.extension.name} · ${release.extension.version}`],['擴充介面',String(release.extension.adapterInterfaceVersion)],['擴充指紋',release.extension.sourceHash]]:[])];
}

export function initReleaseInfo({exportFile}) {
    const dialog=document.getElementById('release-dialog'),button=document.getElementById('release-info-button'),content=document.getElementById('release-fields'),download=document.getElementById('download-release-info');
    let release,active,generation=0;
    button.onclick=async()=>{
        const current=++generation;active?.abort();
        content.textContent='讀取版本資訊…';download.disabled=true;dialog.showModal();
        const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),5000);active=controller;
        try {
            const url=new URL('../release.json',import.meta.url);url.search=new URL(import.meta.url).search;
            const response=await fetch(url,{cache:'no-store',signal:controller.signal});
            if(!response.ok)throw new Error('找不到版本資訊；請確認已部署完整的版本包。');
            const data=await response.json();if(current!==generation)return;
            release=data;const rows=releaseRows(release),fragment=document.createDocumentFragment();
            for(const [label,value] of rows){const dt=document.createElement('dt'),dd=document.createElement('dd');dt.textContent=label;dd.textContent=value;fragment.append(dt,dd);}
            content.replaceChildren(fragment);download.disabled=false;
        } catch(error) {if(current===generation)content.textContent=error.name==='AbortError'?'讀取版本資訊逾時，請稍後再試。':error.message;}
        finally {clearTimeout(timer);}
    };
    download.onclick=()=>{if(release)exportFile('model-lens-version.json',new Blob([JSON.stringify(release,null,2)+'\n'],{type:'application/json'}));};
    document.getElementById('close-release-info').onclick=()=>dialog.close();
    dialog.addEventListener('close',()=>{generation++;active?.abort();});
}
