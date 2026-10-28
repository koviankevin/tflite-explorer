const digest=async bytes=>new Uint8Array(await crypto.subtle.digest('SHA-256',bytes));
const hex=bytes=>[...bytes].map(b=>b.toString(16).padStart(2,'0')).join('');
// Full coverage, bounded reads; this versioned chain is not a standard file SHA.
export async function editFileFingerprint(file,{cancelled=()=>false,progress=()=>{}}={}){
    if(typeof globalThis.crypto?.subtle?.digest!=='function')throw Error('此環境無法核對原模型指紋；請使用 HTTPS 或 localhost。編輯草稿尚未保存。');
    const chunk=1024*1024;let state=await digest(new TextEncoder().encode(`Model Lens file v1:${file.size}`));
    for(let offset=0;offset<file.size;offset+=chunk){if(cancelled())throw Error('已取消原模型核對。');const bytes=new Uint8Array(await file.slice(offset,Math.min(file.size,offset+chunk)).arrayBuffer()),part=await digest(bytes),pair=new Uint8Array(64);pair.set(state);pair.set(part,32);state=await digest(pair);if(offset%(32*chunk)===0)progress(Math.min(file.size,offset+bytes.length),file.size);}
    if(cancelled())throw Error('已取消原模型核對。');progress(file.size,file.size);return hex(state);
}
