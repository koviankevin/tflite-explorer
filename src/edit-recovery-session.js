import {exportEditSession} from './model-edit-session.js';
import {EditRecoveryConflict} from './edit-recovery-store.js';
export const editRecoveryId=()=>Array.from(crypto.getRandomValues(new Uint32Array(4)),v=>v.toString(16).padStart(8,'0')).join('');

// Owns save ordering/CAS only. capture takes a synchronous UI snapshot before
// returning its asynchronous preparation; no model, File or DOM is stored here.
export function editRecoverySession({store,capture,changed=()=>{},enabled=true,owner=editRecoveryId(),delay=600}){
    const tabs=new WeakMap();
    let current=null,timer=null,message=enabled?'開始編輯後，自動保存會先核對完整原模型。':'編輯自動保存已暫停。';
    const emit=()=>changed({message,enabled,attached:!!current,touched:!!current?.sequence,saving:!!current?.work,saved:!!current?.revision,conflict:!!current?.conflict,failed:!!current?.failure});
    const schedule=()=>{clearTimeout(timer);if(current&&enabled&&!current.failure&&!current.conflict)timer=setTimeout(()=>{timer=null;flush();},delay);};
    const prepare=()=>{try{return Promise.resolve(capture()).then(document=>({document}),error=>({error}));}catch(error){return Promise.resolve({error});}};
    async function persist(binding,prepared,sequence){
        const result=await prepared;if(result.error)throw result.error;
        if(!enabled||binding.conflict)return;
        const text=exportEditSession(result.document);
        if(text===binding.savedText){binding.savedSequence=sequence;return;}
        const record=await store.save({key:binding.key,revision:binding.revision,owner,document:result.document});
        binding.revision=record.revision;binding.savedText=text;binding.savedAt=record.updatedAt;binding.savedSequence=sequence;
    }
    function queue(binding,prepared,sequence){
        const previous=binding.work;
        const task=(async()=>{
            if(previous)await previous;
            try{await persist(binding,prepared,sequence);}
            catch(error){if(error.name==='AbortError')return;binding.failure=error;binding.conflict=error instanceof EditRecoveryConflict;if(current===binding)message=`編輯草稿尚未保存：${error.message}`;}
        })();binding.work=task;if(current===binding)emit();
        task.finally(()=>{if(binding.work!==task)return;binding.work=null;
            if(current===binding){if(!binding.failure&&!binding.conflict){message=!enabled?'編輯自動保存已暫停。':binding.savedSequence===binding.sequence&&binding.revision?`已保存本機編輯草稿 · ${new Date(binding.savedAt).toLocaleTimeString()} · 第 ${binding.revision} 版`:'新的編輯待保存…';if(binding.savedSequence!==binding.sequence)schedule();}emit();}
        });return task;
    }
    function flush(){clearTimeout(timer);timer=null;const binding=current;if(!binding||!enabled||!binding.sequence||binding.conflict||binding.failure)return Promise.resolve();if(binding.work)return binding.work;
        message='正在準備本機編輯草稿；完整模型核對在背景執行…';return queue(binding,prepare(),binding.sequence);
    }
    emit();return {
        owner,get touched(){return !!current?.sequence;},
        // Opaque in-memory tab handle: a late detached commit updates this same
        // binding, so switching back cannot reuse its stale CAS revision.
        get binding(){if(!current)return null;if(!current.reference){current.reference={};tabs.set(current.reference,current);}return current.reference;},
        attach(record=null){clearTimeout(timer);current=record&&tabs.has(record)?tabs.get(record):{key:record?.key||editRecoveryId(),revision:record?.revision||0,savedAt:record?.updatedAt||record?.savedAt,savedText:record?.text||record?.savedText||null,sequence:record?.sequence||0,savedSequence:record?.savedSequence||0,conflict:!!record?.conflict,work:null,failure:null};message=current.conflict?'這份編輯草稿已由另一分頁變更；請另存副本。':!enabled?'編輯自動保存已暫停；既有草稿保留。':current.revision?'已接續本機編輯草稿；新的變更會自動保存。':'開始編輯後，自動保存會先核對完整原模型。';emit();},
        change(){if(!current)return;current.sequence++;if(enabled&&!current.failure&&!current.conflict){message=current.work?'背景保存中；新的編輯待保存…':'新的編輯待保存…';schedule();}emit();},
        progress(done,total){if(current?.work&&!current.failure&&!current.conflict){message=`背景核對原模型 ${Math.round(done/Math.max(1,total)*100)}% · 完成保存前請保留此分頁`;emit();}},
        flush,
        detach(){clearTimeout(timer);timer=null;const binding=current;if(!binding)return Promise.resolve();let task=binding.work||Promise.resolve();
            if(enabled&&binding.sequence&&!binding.failure&&!binding.conflict&&binding.savedSequence!==binding.sequence)task=queue(binding,prepare(),binding.sequence);
            current=null;message='開始編輯後，自動保存會先核對完整原模型。';emit();return task;
        },
        setEnabled(value){enabled=!!value;clearTimeout(timer);timer=null;message=current?.conflict?'這份編輯草稿有跨分頁衝突；請另存副本。':current?.failure?`編輯草稿尚未保存：${current.failure.message}`:enabled?'編輯自動保存已啟用。':'編輯自動保存已暫停；既有本機草稿保留。';emit();if(enabled&&current?.sequence)schedule();},
        retry(){if(!current)return Promise.resolve();if(current.conflict){message='這份草稿有跨分頁衝突，請另存副本保留雙方內容。';emit();return Promise.resolve();}current.failure=null;return flush();},
        fork(){if(!current)return Promise.resolve();const previous=current;current={...previous,key:editRecoveryId(),revision:0,savedText:null,savedAt:null,savedSequence:-1,work:null,conflict:false,failure:null,reference:null};if(!current.sequence)current.sequence=1;message='正在另存編輯草稿副本，原記錄保留。';return flush();},
        external(record,force=false){if(current&&record?.key===current.key&&(force||record.owner!==owner)&&record.revision>current.revision){current.conflict=true;clearTimeout(timer);message='這份編輯草稿已更新或移除；目前操作保留，請另存副本。';emit();}}
    };
}
