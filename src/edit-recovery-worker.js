import {editFileFingerprint} from './file-fingerprint.js';
// This dedicated, short-lived worker reads the original File in 1 MiB chunks.
// No model parser/index, weights array or edit command crosses back to the UI.
self.onmessage=async({data})=>{
    try{if(!(data.file instanceof File)||data.file.size<1||!/^\d+$/.test(String(data.id)))throw Error('無效的本機原模型核對。');
        const started=performance.now(),fingerprint=await editFileFingerprint(data.file,{progress:(done,total)=>postMessage({id:data.id,done,total})});
        postMessage({id:data.id,fingerprint,bytes:data.file.size,elapsedMs:performance.now()-started});
    }catch(reason){postMessage({id:data.id,error:reason.message});}
};
