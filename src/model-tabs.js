// Inactive tabs own only immutable local Files and bounded UI state, never a
// parsed model, renderer or Worker. All transitions use the same active loader.
export function modelTabs({capture,load,reset,changed,error,confirmClose,dirty}) {
    let entries=[],current=null,serial=0,busy=false,generation=0,loading=null;
    const emit=()=>changed({busy,current:current?.id,tabs:entries.map(e=>({id:e.id,name:e.file.name}))});
    async function transition(target,{fresh=false}={}) {
        if(busy)return false;
        if(target===current)return true;
        const previous=current,ticket=++generation;let switched=false;busy=true;emit();
        try {
            if(previous)previous.state=await capture();
            if(ticket!==generation)return false;
            if(fresh)entries.push(target);
            current=target;loading={previous,target,fresh};switched=true;emit();
            if(await load(target.file,target.state)===false)throw Error('模型未能開啟。');
            if(ticket!==generation)return false;
            // Active state lives in the UI. Avoid retaining a redundant copy.
            target.state=null;return true;
        } catch(reason) {
            if(ticket!==generation)return false;
            if(!switched){error(reason);return false;}
            if(fresh)entries=entries.filter(e=>e!==target);
            current=previous;emit();
            if(previous)try{if(await load(previous.file,previous.state)===false)throw Error('原模型恢復失敗，請重新選取分頁。');previous.state=null;}catch(restoreError){reset();current=null;error(restoreError);}
            else reset();
            error(reason);return false;
        } finally {if(ticket===generation){busy=false;loading=null;emit();}}
    }
    const api={
        open:file=>transition({id:++serial,file,state:null},{fresh:true}),
        activate:id=>{const entry=entries.find(e=>e.id===id);return entry?transition(entry):Promise.resolve(false);},
        get busy(){return busy;},
        get hasUnexported(){return entries.some(e=>e===current?false:!!e.state?.edit?.dirty);},
        async close(id){
            if(busy)return false;const entry=entries.find(e=>e.id===id);if(!entry)return false;
            const state=entry===current?await capture():entry.state;
            if(state?.edit?.dirty&&!confirmClose())return false;
            if(entry===current){const next=entries[entries.indexOf(entry)-1]||entries[entries.indexOf(entry)+1];if(next){if(!await transition(next))return false;}else {reset();current=null;}}
            entries=entries.filter(e=>e!==entry);emit();return true;
        },
        async cancel(){
            if(!loading)return false;const {previous,target,fresh}=loading;
            generation++;busy=false;loading=null;current=null;if(fresh)entries=entries.filter(e=>e!==target);reset();emit();
            return previous?transition(previous):true;
        },
        closeAll(){
            if((api.hasUnexported||dirty())&&!confirmClose())return false;
            generation++;busy=false;loading=null;entries=[];current=null;reset();emit();return true;
        }
    };emit();return api;
}
