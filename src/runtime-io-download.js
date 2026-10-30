import {prepareRuntimeIOBlob} from './runtime-io.js';

// A download belongs to the exact completed result and source selected at the
// click. Preparing a snapshot never runs inference or selects another model.
export function runtimeIODownload({getState,getSource,saveFile,prepare=prepareRuntimeIOBlob,onChange=()=>{}}){
    let serial=0,pending=null,error=null;
    const current=(io,source)=>getState().io===io&&!getState().busy&&getSource()===source;
    const live=(ticket,io,source)=>serial===ticket&&current(io,source);
    const api={
        get state(){if(pending&&!current(pending.io,pending.source)){serial++;pending=null;}if(error&&!current(error.io,error.source))error=null;return {pending:!!pending,error:error?.message||''};},
        reset(){serial++;pending=null;error=null;onChange();},
        async download(){
            const {io,busy}=getState(),source=getSource();if(!io?.archive||busy||!source||api.state.pending)return false;
            const ticket=++serial;pending={io,source};error=null;onChange();
            try{const blob=await prepare(io);if(!blob||!live(ticket,io,source))return false;await saveFile(source.name.replace(/\.[^.]+$/,'')+'-runtime-io.zip',blob);return true;}
            catch(reason){if(live(ticket,io,source))error={io,source,message:`IO 下載失敗：${String(reason?.message??reason)}`};return false;}
            finally{if(serial===ticket){pending=null;onChange();}}
        }
    };return api;
}
