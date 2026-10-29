// Classic Worker: LiteRT's official loader uses importScripts. All assets are
// served beside this app; no model, input or diagnostic leaves this Worker.
let started=false;
self.onmessage=async({data})=>{
    if(started)return;started=true;
    const diagnostics=[];
    try{
        self.Module={locateFile:name=>new URL('../vendor/litert/2.6.0/'+name,self.location.href).href,printErr:text=>{diagnostics.push(String(text).slice(0,512));if(diagnostics.length>12)diagnostics.shift();}};
        if(!(data.runtimeModule instanceof WebAssembly.Module))throw Error('缺少已驗證的公開 runtime module。');
        // Share immutable code only. Each execution owns a new Instance, memory
        // and imports in this Worker; no model state can enter the page cache.
        self.Module.instantiateWasm=(imports,ready)=>ready(new WebAssembly.Instance(data.runtimeModule,imports));
        const {executeRuntime}=await import('./tflite-runtime-execute.js');
        const rt=await import('../vendor/litert/2.6.0/core.js');
        postMessage({progress:'載入本機 LiteRT CPU runtime…'});
        // Build the filename at runtime: loadLiteRt expects a literal .js suffix.
        const name=['litert_wasm_compat_internal','js'].join('.');
        await rt.loadLiteRt(new URL('../vendor/litert/2.6.0/'+name,self.location.href).href,{threads:false,jspi:false});
        const result=await executeRuntime({...data,rt,progress:text=>postMessage({progress:text}),diagnostics:()=>diagnostics});
        try{rt.unloadLiteRt();}catch{}
        postMessage({result});
    }catch(error){postMessage({result:{schemaVersion:1,engine:'LiteRT.js 2.6.0 / CPU WASM',status:'not-verified',stage:'runtime-load',reason:`無法初始化本機 runtime：${String(error?.message||error).slice(0,1024)}`,compiled:false,invoked:false,diagnostics}});}
};
