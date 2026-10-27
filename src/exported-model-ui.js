// Keep one file-backed result for local reopening, without reading its body.
// Closing/changing the model or starting a new export discards this reference.
export function exportedModelUI({button,open,error}) {
    let latest=null,revision=0;
    const clear=()=>{latest=null;revision++;button.hidden=true;button.disabled=true;};
    button.onclick=async()=>{
        const selected=latest,selectedRevision=revision;
        if(!selected)return;
        clear();const attempt=revision;
        try{const opened=await open(selected);if(opened===false&&!latest&&revision===attempt){latest=selected;revision=selectedRevision;button.hidden=false;button.disabled=false;}}catch(reason){error(reason);}
    };
    clear();
    return {
        clear,
        isCurrent:token=>!!latest&&token===revision,
        remember(blob,name){
            if(!(blob instanceof Blob)||!blob.size||typeof name!=='string'||!/\.(?:tflite|mlir)$/i.test(name))throw new Error('沒有可開啟的匯出模型。');
            latest=new File([blob],name,{type:blob.type||'application/octet-stream'});
            button.hidden=false;button.disabled=false;
            return ++revision;
        }
    };
}
