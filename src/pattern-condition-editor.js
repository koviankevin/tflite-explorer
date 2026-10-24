import {normalizeConditions,parseShape,shapeText} from './pattern-conditions.js?v=6c76cced0e0a8fe9';
export function conditionEditor({getNodes,getRules,setRules,error}) {
    const $=id=>document.getElementById(id);
    const modes=()=>{const attribute=$('condition-kind').value==='attribute';$('condition-tensor').hidden=attribute;$('condition-attribute').hidden=!attribute;$('condition-value').placeholder=attribute?'與詳細資料的值相同':$('condition-kind').value==='shape'?'1, *, 128；[] 為 scalar':'例如 float32（TFLite）或 f32（MLIR）';};
    const render=()=>{
        const nodes=getNodes(),selected=$('condition-node').value;
        $('condition-node').replaceChildren(...nodes.map(n=>new Option(`${n.alias} · ${n.type}`,n.alias,false,n.alias===selected)));
        $('add-condition').disabled=!nodes.length;
        const rows=[];
        for(const n of nodes)for(const [i,r] of (getRules(n.alias) || []).entries()) {
            const row=document.createElement('div');row.className='condition-row';
            const label=document.createElement('span');label.textContent=`${n.alias} · ${r.kind==='attribute'?`${r.name} = ${r.value}`:`${r.side==='input'?'輸入':'輸出'} #${r.port} ${r.kind} = ${r.kind==='shape'?shapeText(r.value):r.value}`}`;
            const remove=document.createElement('button');remove.className='text-button';remove.textContent='移除';remove.setAttribute('aria-label',`移除 ${n.alias} 條件 ${i+1}`);remove.onclick=()=>{setRules(n.alias,getRules(n.alias).filter((_,j)=>j!==i));render();};row.append(label,remove);rows.push(row);
        }
        $('condition-list').replaceChildren(...rows);
        $('condition-summary').textContent=`條件篩選 · ${rows.length} 個`;
        modes();
    };
    $('condition-kind').onchange=modes;
    $('add-condition').onclick=()=>{try{
        const kind=$('condition-kind').value,value=$('condition-value').value;
        if(kind!=='attribute' && !$('condition-port').value.trim())throw new Error('請輸入從 0 起算的 port。');
        if(kind==='shape' && !value.trim())throw new Error('請輸入 shape；scalar 請填 []。');
        const rule=kind==='attribute'?{kind,name:$('condition-attribute-name').value,value}:{kind,side:$('condition-side').value,port:Number($('condition-port').value),value:kind==='shape'?parseShape(value):value};
        const alias=$('condition-node').value;
        setRules(alias,normalizeConditions([...(getRules(alias) || []),rule]));render();
    }catch(e){error(e);}};
    return {render};
}
