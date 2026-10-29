// One stateless public runtime module per page. No model, input, output,
// WebAssembly.Instance or private File is accepted or retained here.
export const RUNTIME_MODULE_ASSET=Object.freeze({path:'../vendor/litert/2.6.0/litert_wasm_compat_internal.wasm',bytes:10948854,sha256:'4190033238e53ec86b832bad4649851ad111025c226c1688cfae20e1f8fe8926'});

export function runtimeModuleCache({fetcher=globalThis.fetch,compile=bytes=>globalThis.WebAssembly.compile(bytes),assetURL=new URL(RUNTIME_MODULE_ASSET.path,import.meta.url)}={}){
    let pending=null;
    async function load(){
        if(!globalThis.WebAssembly?.Module||!globalThis.crypto?.subtle||typeof fetcher!=='function')throw Error('此瀏覽器不支援安全的本機 WASM 執行；模型探索與匯出仍可使用。');
        const url=new URL(assetURL);if(!['http:','https:'].includes(url.protocol)||url.username||url.password||url.search||url.hash)throw Error('公開 runtime 來源必須是有效的 HTTP(S) 靜態檔案。');
        const abort=new AbortController(),timer=setTimeout(()=>abort.abort(),30000);let reader,response;
        try{
            response=await fetcher(url.href,{credentials:'omit',redirect:'error',signal:abort.signal});
            if(!response.ok||response.headers.get('content-type')?.split(';')[0].trim()!=='application/wasm')throw Error('公開 runtime 下載失敗或 MIME 不正確。');
            const declared=response.headers.get('content-length');if(declared!==null&&(!/^\d+$/.test(declared)||Number(declared)>RUNTIME_MODULE_ASSET.bytes))throw Error('公開 runtime 檔案大小不符合固定版本。');
            if(!response.body)throw Error('公開 runtime 缺少檔案內容。');reader=response.body.getReader();const bytes=new Uint8Array(RUNTIME_MODULE_ASSET.bytes);let offset=0;
            while(true){const part=await reader.read();if(part.done)break;if(!(part.value instanceof Uint8Array)||offset+part.value.byteLength>bytes.byteLength)throw Error('公開 runtime 內容超過固定大小。');bytes.set(part.value,offset);offset+=part.value.byteLength;}
            if(offset!==bytes.byteLength)throw Error('公開 runtime 檔案不完整。');
            const digest=await crypto.subtle.digest('SHA-256',bytes),hash=Array.from(new Uint8Array(digest),n=>n.toString(16).padStart(2,'0')).join('');if(hash!==RUNTIME_MODULE_ASSET.sha256)throw Error('公開 runtime SHA-256 與固定版本不符。');
            const module=await compile(bytes);if(!(module instanceof WebAssembly.Module))throw Error('瀏覽器未能建立公開 runtime module。');return module;
        }finally{clearTimeout(timer);abort.abort();if(reader){await reader.cancel().catch(()=>{});reader.releaseLock();}else await response?.body?.cancel().catch(()=>{});}
    }
    return ()=>{if(!pending)pending=load().catch(error=>{pending=null;throw error;});return pending;};
}

// Constructing/importing this function performs no download or compilation.
// Only an explicit eligible manual execution calls it. A cancelled caller may
// leave this bounded public preparation running, never its model or inputs.
export const prepareRuntimeModule=runtimeModuleCache();
