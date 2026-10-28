// Optional inspector controls; the Worker reconstructs all tensors from trusted metadata.
export function editNewOpsUI({$,make,rpc,state,selected,apply,message,isBusy}){
    const root=$('edit-new-ops');let catalog=null,loading=null,shown=null;
    const node=()=>state()?.nodes.find(n=>n.id===selected());
    const prototypes=()=>[...state().values.values()].filter(v=>!v.fresh&&!v.generated&&!v.missing&&!v.optional&&v.graph===node().source.graph);
    const select=(id,rows)=>{const e=make('select');e.id=id;for(const [value,text]of rows)e.append(new Option(text,value));return e;};
    const field=(text,e)=>{const label=make('label',text);label.append(e);return label;};
    const number=(id,value,min,max)=>{const e=make('input');Object.assign(e,{id,type:'number',value:String(value),min:String(min),max:String(max)});return e;};
    function config(){
        const n=node(),info=catalog.find(c=>c.code===Number($('edit-builtin').value));if(!info||!n)return;
        const body=$('edit-builtin-config');body.replaceChildren();
        body.append(field('OP version',number('edit-builtin-version',n.builtin?.version||1,1,100)),field('輸入數量',number('edit-builtin-inputs',info.inputs?.length??n.inputs.length,0,32)),field('輸出數量',number('edit-builtin-outputs',info.outputs?.length??n.outputs.length,0,32)));
        const outputs=make('div');outputs.id='edit-output-types';body.append(outputs);
        const redrawOutputs=()=>{const count=Number($('edit-builtin-outputs').value);outputs.replaceChildren();if(!Number.isInteger(count)||count<0||count>32)return;for(let i=0;i<count;i++){const p=select(`edit-output-like-${i}`,prototypes().map(v=>[v.id,`${v.name} · ${v.type}`]));const original=state().values.get(n.outputs[i]?.value),prior=n.builtin?.outputLike[i]||(original?`t:${original.graph}:${original.tensor}`:null);if([...p.options].some(o=>o.value===prior))p.value=prior;outputs.append(field(`輸出 ${i+1} 型別參考（自動建立 tensor）`,p));}};
        $('edit-builtin-outputs').oninput=redrawOutputs;redrawOutputs();
        for(const f of info.fields){let e;if(f.kind==='bool_'){e=make('input');e.type='checkbox';e.checked=!!(n.builtin?.code===info.code?n.builtin.settings[f.key]??f.value:f.value);}else {e=make('input');const v=n.builtin?.code===info.code?n.builtin.settings[f.key]??f.value:f.value;e.value=Array.isArray(v)?JSON.stringify(v):v===null?'null':String(v);e.type='text';}e.dataset.builtinOption=f.key;e.dataset.optionKind=f.kind;body.append(field(`${f.key} (${f.kind})`,e));}
        body.append(make('p','輸入／輸出數量需符合該 OP；list 為可變長度。shape、dtype 與量化沿用參考 tensor，必要時先選合適範本。','hint'));
    }
    function render(){
        const n=node(),show=!!n?.fresh&&!n.removed&&state().format==='tflite';root.hidden=!show;if(!show){shown=null;return;}
        if(!catalog){root.textContent='載入本機 OP 定義…';if(!loading)loading=rpc('editBuiltinCatalog').then(c=>{catalog=c;shown=null;render();}).catch(e=>{root.textContent=e.message;}).finally(()=>{loading=null;});return;}
        const stamp=JSON.stringify([n.id,n.builtin,n.inputs.map(p=>p.value)]);if(stamp===shown)return;shown=stamp;root.replaceChildren();
        const details=make('details');details.append(make('summary','改為其他 TFLite OP'));
        const kinds=select('edit-builtin',catalog.map(c=>[String(c.code),c.name]));kinds.value=String(n.builtin?.code??catalog.find(c=>c.name===n.name)?.code??catalog[0].code);details.append(field('內建 OP（CUSTOM 請複製原始 OP）',kinds));const body=make('div');body.id='edit-builtin-config';details.append(body);
        const change=make('button','套用 OP 型別與參數','quiet');change.type='button';change.id='edit-builtin-apply';change.onclick=()=>{if(isBusy())return;try{const settings={};for(const e of body.querySelectorAll('[data-builtin-option]')){const k=e.dataset.optionKind,t=e.value;settings[e.dataset.builtinOption]=k==='bool_'?e.checked:['array','int64s_','bools_'].includes(k)?JSON.parse(t):['int64_','uint64_','string_'].includes(k)?t==='null'?null:t:JSON.parse(t);}const count=Number($('edit-builtin-outputs').value);if(!Number.isInteger(count)||count<0||count>32)throw Error('輸出數量需介於 0～32。');apply({kind:'builtin',node:n.id,code:Number(kinds.value),version:Number($('edit-builtin-version').value),inputCount:Number($('edit-builtin-inputs').value),outputLike:Array.from({length:count},(_,i)=>$(`edit-output-like-${i}`).value),settings});}catch(e){message(e.message);}};details.append(change);root.append(details);kinds.onchange=config;config();
        if(n.inputs.length){const random=make('details');random.append(make('summary','補上亂數權重／常數'));
            const slot=select('edit-random-slot',n.inputs.map((_,i)=>[String(i),`輸入 ${i+1}`])),like=select('edit-random-like',prototypes().map(v=>[v.id,`${v.name} · ${v.type}`]));random.append(field('要補齊的輸入',slot),field('權重型別與 shape 參考',like),field('seed',number('edit-random-seed',1,0,4294967295)),field('最小值',number('edit-random-min',-.05,-1e6,1e6)),field('最大值',number('edit-random-max',.05,-1e6,1e6)));
            root.append(random);const defaults=()=>{const v=state().values.get(like.value),type=JSON.parse(v.signature).type,integer=![0,10].includes(type);$('edit-random-min').value=integer?'0':'-0.05';$('edit-random-max').value=integer?'1':'0.05';};like.onchange=defaults;defaults();
            const button=make('button','產生並接入此輸入','quiet');button.id='edit-random-apply';button.type='button';button.onclick=()=>{if(!isBusy())apply({kind:'random',node:n.id,slot:Number(slot.value),like:like.value,seed:Number($('edit-random-seed').value),min:Number($('edit-random-min').value),max:Number($('edit-random-max').value)});};random.append(button,make('p','只產生權重資料；不隨機更改 stride、padding、axis。單個 tensor 上限 16 MiB，整次匯出上限 32 MiB。量化範圍使用原始整數值。','hint'));
        }
        root.append(make('p','匯出前檢查接線、資料長度、索引及已支援的型別／shape 規則。未執行推論；其他 kernel 規則與 custom runtime 需由你的工具驗證。','hint'));
    }
    return {render,reset(){catalog=null;shown=null;}};
}
