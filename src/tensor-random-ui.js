import {randomDefaults,randomRange,randomOptions,randomDescription} from './tensor-random.js';

// Both generated constants and runtime inputs use the same controls and spec.
export function tensorRandomUI({id,role='input',dtype='float32',quantized=false}){
    const make=(tag,text)=>{const e=document.createElement(tag);if(text!==undefined)e.textContent=text;return e;},root=make('div'),select=make('select'),hint=make('p'),advanced=make('details'),controls={},fields={};
    select.id=id('distribution');hint.id=id('range');hint.className='hint';
    const names=[['uniform','範圍內平均取樣（Uniform）'],['normal',role==='weight'?'一般小幅浮點權重（Normal）':'標準化浮點資料（Normal）'],['truncated-normal',role==='weight'?'小幅浮點權重（Truncated Normal）':'有上下界的浮點資料（Truncated Normal）'],['bernoulli','二元 mask／開關（Bernoulli）']];
    for(const [value,label]of names)select.append(new Option(label,value));
    const label=make('label','資料規則');label.append(select);advanced.append(make('summary','進階參數（可沿用預設）'));root.append(label,hint,advanced);
    for(const [key,title]of [['seed','seed（相同設定可重現）'],['min','最小值'],['max','最大值'],['mean','平均值（中心）'],['std','標準差（數值分散程度）'],['probability','產生 1 的機率（0～1）']]){
        const input=make('input'),field=make('label',title);input.id=id(key);input.type='number';input.step=key==='seed'?'1':'any';controls[key]=input;fields[key]=field;field.append(input);advanced.append(field);input.oninput=()=>describe();
    }
    function spec(){const raw={distribution:select.value,...Object.fromEntries(Object.entries(controls).map(([key,e])=>[key,e.value.trim()===''?NaN:Number(e.value)]))},value=randomOptions(raw);if(value.distribution==='uniform')delete value.distribution;return value;}
    function describe(){hint.textContent=randomDescription(spec())+` seed ${controls.seed.value}。`+randomRange(dtype).description+(quantized?' 量化資料使用原始整數值，不自動套用 scale／zero point。':'')+' 請依資料用途選擇，預設不代表所有模型的實際輸入或訓練權重。';}
    function defaults(distribution){
        const range=randomRange(dtype),value=randomDefaults(dtype,distribution,role);select.value=value.distribution;
        for(const [key,input]of Object.entries(controls)){
            input.min=String(key==='seed'||key==='probability'?0:key==='std'?Number.MIN_VALUE:range.min);input.max=String(key==='seed'?4294967295:key==='probability'?1:range.max);input.step=key==='seed'||range.integer&&['min','max'].includes(key)?'1':'any';input.value=String(value[key]??(key==='std'?1:0));fields[key].hidden=key!=='seed'&&!Object.hasOwn(value,key);
        }
        for(const option of select.options)option.disabled=range.integer&&['normal','truncated-normal'].includes(option.value);describe();
    }
    select.onchange=()=>defaults(select.value);defaults();
    return {root,spec,advanced,restore(value){defaults(value.distribution??'uniform');for(const [key,n]of Object.entries(value))if(controls[key])controls[key].value=Number.isFinite(n)?String(n):'';describe();},setType(next,q=false){dtype=next;quantized=q;defaults();},disable(value){select.disabled=value;for(const input of Object.values(controls))input.disabled=value;},explain(text){hint.textContent=text;}};
}
