import {inputSize,validateRuntimeInputs} from './tflite-runtime-inputs.js';
import {randomRange} from './tensor-random.js';
export function runtimeInputsUI(){
    const $=id=>document.getElementById(id),dialog=$('edit-runtime-dialog'),list=$('edit-runtime-inputs');let pending=null;
    const make=(tag,text)=>{const e=document.createElement(tag);if(text!==undefined)e.textContent=text;return e;};
    const field=(text,control)=>{const label=make('label',text);label.append(control);return label;};
    function close(value){if(!pending)return;const resolve=pending;pending=null;dialog.close();list.replaceChildren();$('edit-runtime-input-error').textContent='';resolve(value);}
    dialog.addEventListener('keydown',event=>event.stopPropagation());dialog.addEventListener('cancel',event=>{event.preventDefault();close(null);});$('edit-runtime-dialog-close').onclick=()=>close(null);
    return {cancel:()=>close(null),choose(plan){
        close(null);list.replaceChildren();const specs=[];
        for(const [i,t]of plan.inputs.entries()){
            const row=make('fieldset'),title=make('legend',`輸入 ${i+1} · ${t.name||`tensor #${t.tensor}`}`);row.append(title,make('p',`${t.dtype} [${t.shape.join(',')}] · ${inputSize(t)} bytes${t.quantized?' · 量化資料請提供原始整數值':''}`));
            const mode=make('select');mode.id=`runtime-input-mode-${i}`;for(const [v,name]of [['zero','零值'],['random','亂數'],['bin','載入 raw .bin']])mode.append(new Option(name,v));row.append(field('資料來源',mode));
            const file=make('input');file.type='file';file.accept='.bin,application/octet-stream';file.id=`runtime-input-file-${i}`;const fileField=field('raw .bin（little-endian）',file);fileField.hidden=true;row.append(fileField);
            const random=make('div');random.hidden=true;const range=randomRange(t.dtype),controls={};for(const [name,label,value]of [['seed','seed',1],['min','最小值',range.defaultMin],['max','最大值',range.defaultMax]]){const e=make('input');e.type='number';e.step=name==='seed'?'1':range.step;e.min=String(name==='seed'?0:range.min);e.max=String(name==='seed'?4294967295:range.max);e.value=String(value);e.id=`runtime-input-${name}-${i}`;controls[name]=e;random.append(field(label,e));}const hint=make('p',range.description+(t.quantized?' 量化 tensor 使用原始整數值，不自動換算 scale／zero point。':''));hint.id=`runtime-input-range-${i}`;hint.className='hint';random.append(hint);row.append(random);
            mode.onchange=()=>{fileField.hidden=mode.value!=='bin';random.hidden=mode.value!=='random';};
            specs.push(()=>({mode:mode.value,...(mode.value==='bin'?{file:file.files[0]}:mode.value==='random'?Object.fromEntries(Object.entries(controls).map(([k,e])=>[k,e.value.trim()===''?NaN:Number(e.value)])): {})}));list.append(row);
        }
        if(!plan.inputs.length)list.append(make('p','此模型沒有外部 inputs，將直接執行一次。'));
        $('edit-runtime-run').onclick=()=>{try{const values=specs.map(s=>s());validateRuntimeInputs(plan.inputs,values);close(values);}catch(error){$('edit-runtime-input-error').textContent=error.message;}};
        dialog.showModal();return new Promise(resolve=>{pending=resolve;});
    }};
}
