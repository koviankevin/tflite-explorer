import {runtimeSkipped} from './tflite-runtime-policy.js';
import {releaseRuntimeIO} from './runtime-io.js';

// An execution owns the immutable File opened in this model tab, never an
// editor snapshot or a candidate export. Drop all IO when the source changes.
export function modelRuntimeSession({getSource,getFormat,prepare,runtime,inputs,onChange=()=>{}}){
    let owner=null,generation=0,state={busy:false,plan:null,validation:null,io:null,message:'尚未執行'};
    const emit=()=>onChange({...state});
    const live=(ticket,source)=>ticket===generation&&source===owner&&source===getSource();
    const forget=()=>{generation++;runtime.cancel();inputs.cancel();releaseRuntimeIO(state.io);owner=null;state={busy:false,plan:null,validation:null,io:null,message:'尚未執行'};};
    async function plan(source,ticket){
        if(state.plan)return state.plan;
        const next=await prepare();
        if(!live(ticket,source))return null;
        state.plan=next;return next;
    }
    const api={
        get state(){return {...state};},
        reset(){forget();emit();},
        cancel(){generation++;runtime.cancel();inputs.cancel();releaseRuntimeIO(state.io);state={...state,busy:false,io:null,validation:runtimeSkipped('已取消本機執行；尚未驗證的結果不算通過。'),message:'已取消執行'};emit();},
        async inspect(){
            const source=getSource();if(!source||getFormat()!=='tflite')return;
            if(owner!==source){forget();owner=source;}
            const ticket=generation;
            try{await plan(source,ticket);if(live(ticket,source))emit();}
            catch(error){if(live(ticket,source)){state.message=error.message;emit();}}
        },
        async run(){
            const source=getSource();if(!source||getFormat()!=='tflite')return;
            if(owner!==source){forget();owner=source;}
            if(state.busy)return;
            const ticket=++generation;releaseRuntimeIO(state.io);state={...state,busy:true,io:null,validation:null,message:'讀取目前分頁的模型介面…'};emit();
            try{
                const metadata=await plan(source,ticket);if(!metadata||!live(ticket,source))return;
                const specs=metadata.eligible?await inputs.choose(metadata):[];
                if(!live(ticket,source))return;
                if(specs===null){state.message='已取消指定輸入，尚未執行';return;}
                const result=await runtime.check(source,metadata,message=>{if(live(ticket,source)){state.message=message;emit();}},specs);
                if(!live(ticket,source)){releaseRuntimeIO(result?.io);return;}
                const {io,...validation}=result;state={...state,validation,io:io||null,message:''};
            }catch(error){if(live(ticket,source)){state.validation=runtimeSkipped(error.message);state.message=error.message;}}
            finally{if(live(ticket,source)){state.busy=false;emit();}}
        }
    };return api;
}
