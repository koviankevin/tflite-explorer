import {inputSize,validateRuntimeInputs} from './tflite-runtime-inputs.js';
import {tensorRandomUI} from './tensor-random-ui.js';
export function runtimeInputsUI(){
    const $=id=>document.getElementById(id),dialog=$('edit-runtime-dialog'),list=$('edit-runtime-inputs');let pending=null;
    const make=(tag,text)=>{const e=document.createElement(tag);if(text!==undefined)e.textContent=text;return e;};
    const field=(text,control)=>{const label=make('label',text);label.append(control);return label;};
    function close(value){const resolve=pending;pending=null;$('edit-runtime-run').onclick=null;if(dialog.open)dialog.close();list.replaceChildren();$('edit-runtime-input-error').textContent='';resolve?.(value);}
    dialog.addEventListener('keydown',event=>event.stopPropagation());dialog.addEventListener('cancel',event=>{event.preventDefault();close(null);});$('edit-runtime-dialog-close').onclick=()=>close(null);
    return {cancel:()=>close(null),choose(plan){
        close(null);list.replaceChildren();const specs=[];
        for(const [i,t]of plan.inputs.entries()){
            const row=make('fieldset'),title=make('legend',`輸入 ${i+1} · ${t.name||`tensor #${t.tensor}`}`);row.append(title,make('p',`${t.dtype} [${t.shape.join(',')}] · ${inputSize(t)} bytes${t.quantized?' · 量化資料請提供原始整數值':''}`));
            const mode=make('select');mode.id=`runtime-input-mode-${i}`;for(const [v,name]of [['zero','零值'],['random','亂數'],['bin','載入 raw .bin']])mode.append(new Option(name,v));row.append(field('資料來源',mode));
            const file=make('input');file.type='file';file.accept='.bin,application/octet-stream';file.id=`runtime-input-file-${i}`;const fileField=field('raw .bin（little-endian）',file);fileField.hidden=true;row.append(fileField);
            const rules=tensorRandomUI({id:key=>`runtime-input-${key}-${i}`,dtype:t.dtype,quantized:t.quantized}),random=rules.root;random.hidden=true;row.append(random);
            mode.onchange=()=>{fileField.hidden=mode.value!=='bin';random.hidden=mode.value!=='random';};
            specs.push(()=>({mode:mode.value,...(mode.value==='bin'?{file:file.files[0]}:mode.value==='random'?rules.spec(): {})}));list.append(row);
        }
        if(!plan.inputs.length)list.append(make('p','此模型沒有外部 inputs，將直接執行一次。'));
        const result=new Promise(resolve=>{pending=resolve;}),ticket=pending;
        $('edit-runtime-run').onclick=()=>{if(pending!==ticket)return;try{const values=specs.map(s=>s());validateRuntimeInputs(plan.inputs,values);close(values);}catch(error){$('edit-runtime-input-error').textContent=error.message;}};
        try{dialog.showModal();}catch(error){close(null);throw error;}return result;
    }};
}
