import {editMLIRPattern} from './mlir-pattern-edit.js';
import {prepareMLIRPattern} from './mlir-pattern-spec.js';

export function mlirPatternEditor({root,getPattern,getTypes,change,error}) {
    const doc=root.ownerDocument;
    const pageSize=12;
    let edgePage=0;
    const make=(tag,text)=>{const n=doc.createElement(tag);if(text!==undefined)n.textContent=text;return n;};
    const keyed=(control,key)=>{control.dataset.cfgKey=key;return control;};
    const label=(text,control)=>{const n=make('label',text);n.append(control);return n;};
    const select=(choices,value,key,apply)=>{
        const n=keyed(make('select'),key);for(const [id,text] of choices){const o=make('option',text);o.value=id;o.selected=id===value;n.append(o);}n.onchange=()=>apply(n.value);return n;
    };
    const button=(text,key,action)=>{const n=keyed(make('button',text),key);n.type='button';n.className='quiet';n.onclick=()=>edit(action);return n;};
    const edit=action=>{try{const next=editMLIRPattern(getPattern(),action);if(action.kind==='add-edge')edgePage=Math.floor((next.edges.filter(e=>e.kind!=='contains').length-1)/pageSize);change(next);render();}catch(reason){render();error(reason);}};
    function render() {
        const pattern=getPattern();root.hidden=!pattern;if(!pattern){edgePage=0;root.replaceChildren();return;}
        const active=doc.activeElement?.closest('[data-cfg-key]'),key=root.contains(active)?active.dataset.cfgKey:null;
        const scroll=root.querySelector('.cfg-scroll')?.scrollTop||0;
        const {nodes,edges}=pattern,blocks=nodes.filter(n=>n.kind==='block'),ops=nodes.filter(n=>n.kind==='operator');
        const parent=alias=>edges.find(e=>e.kind==='contains'&&e.to===alias)?.from;
        const children=(alias,kind)=>nodes.filter(n=>n.kind===kind&&parent(n.alias)===alias).sort((a,b)=>(a.order??a.slot)-(b.order??b.slot));
        const summary=make('summary',`編輯跨 block 結構 · ${ops.length} OP · ${blocks.length} blocks`),body=make('div');body.className='cfg-scroll';
        const hint=make('p','只修改搜尋 pattern。Block 歸屬由選單管理；SSA 是 result → operand，argument 是 result → successor。Port 從 0 起算。');hint.className='hint';body.append(hint);
        const types=make('datalist');types.id='cfg-operator-types';for(const type of new Set([...getTypes(),...ops.map(n=>n.type)])){const option=make('option');option.value=type;types.append(option);}body.append(types);
        for(const block of blocks) {
            const group=make('fieldset'),legend=make('legend',block.alias+' · block');group.append(legend);
            const actions=make('div');actions.className='cfg-actions';actions.append(button('＋ OP',block.alias+'-add-op',{kind:'add-operator',block:block.alias}),button('＋ argument',block.alias+'-add-arg',{kind:'add-argument',block:block.alias}),button('刪除 block',block.alias+'-remove',{kind:'remove-node',alias:block.alias}));group.append(actions);
            const list=children(block.alias,'operator');
            for(const [i,op] of list.entries()) {
                const row=make('div');row.className='cfg-node';row.dataset.cfgNode=op.alias;
                const type=keyed(make('input'),op.alias+'-type');type.value=op.type;type.maxLength=256;type.setAttribute('list',types.id);type.setAttribute('aria-label',op.alias+' 的 operator 類型');type.onchange=()=>edit({kind:'set-operator',alias:op.alias,type:type.value});
                row.append(make('strong',op.alias),label('Operator',type),label('所屬 block',select(blocks.map(n=>[n.alias,n.alias]),block.alias,op.alias+'-block',value=>edit({kind:'set-operator',alias:op.alias,block:value}))));
                const actions=make('div');actions.className='cfg-actions';const up=button('上移',op.alias+'-up',{kind:'move-operator',alias:op.alias,delta:-1}),down=button('下移',op.alias+'-down',{kind:'move-operator',alias:op.alias,delta:1});up.disabled=i===0;down.disabled=i===list.length-1;actions.append(up,down,button('刪除 OP',op.alias+'-remove',{kind:'remove-node',alias:op.alias}));row.append(actions);group.append(row);
            }
            for(const arg of children(block.alias,'argument')){const row=make('div');row.className='cfg-actions';row.append(make('span',`${arg.alias} · argument #${arg.slot}`),button('刪除 argument',arg.alias+'-remove',{kind:'remove-node',alias:arg.alias}));group.append(row);}
            body.append(group);
        }
        body.append(button('＋ block','add-block',{kind:'add-block'}));
        const edgeHeading=make('h3','SSA 與控制流程連線');body.append(edgeHeading,button('＋ 連線','add-edge',{kind:'add-edge'}));
        // Limit DOM and option counts before building any connection controls.
        // Even the maximum-size query creates at most 12 editable edge rows.
        const connections=[...edges.entries()].filter(([,e])=>e.kind!=='contains'),pages=Math.max(1,Math.ceil(connections.length/pageSize));edgePage=Math.min(edgePage,pages-1);
        const navigation=make('nav');navigation.className='cfg-actions';navigation.setAttribute('aria-label','Pattern 連線分頁');
        for(const [text,key,delta] of [['上一頁','edges-previous',-1],['下一頁','edges-next',1]]){const n=keyed(make('button',text),key);n.type='button';n.className='quiet';n.disabled=delta<0?edgePage===0:edgePage===pages-1;n.onclick=()=>{edgePage+=delta;render();};navigation.append(n);}
        navigation.append(make('span',`第 ${edgePage+1}／${pages} 頁 · ${connections.length} 條連線`));body.append(navigation);
        for(const [index,edge] of connections.slice(edgePage*pageSize,(edgePage+1)*pageSize)) {
            const row=make('fieldset');row.dataset.cfgEdge=String(index);row.append(make('legend',`連線 ${index+1}`));
            const sources=nodes.filter(n=>edge.kind==='control'?n.kind==='block':n.kind!=='block'),targets=nodes.filter(n=>n.kind===(edge.kind==='control'?'block':edge.kind==='argument'?'argument':'operator'));
            const choices=list=>list.map(n=>[n.alias,`${n.alias} · ${n.kind==='operator'?n.type:n.kind==='argument'?`argument #${n.slot}`:'block'}`]);
            row.append(label('種類',select([['ssa','SSA'],['argument','Block argument'],['control','控制流程']],edge.kind,`edge-${index}-kind`,kind=>{
                const from=nodes.find(n=>kind==='control'?n.kind==='block':n.kind!=='block'),to=nodes.find(n=>n.kind===(kind==='control'?'block':kind==='argument'?'argument':'operator'));
                if(!from||!to){error(Error('請先加入此種類需要的 block／argument／OP。'));render();return;}
                edit({kind:'set-edge',index,edge:{kind,from:from.alias,to:to.alias,port:kind==='control'?'0':'0:0'}});
            })),label('起點',select(choices(sources),edge.from,`edge-${index}-from`,from=>edit({kind:'set-edge',index,edge:{from}}))),label('終點',select(choices(targets),edge.to,`edge-${index}-to`,to=>edit({kind:'set-edge',index,edge:{to}}))));
            const values=edge.port.split(':');
            for(const [part,text] of (edge.kind==='control'?['Successor']:['Result',edge.kind==='ssa'?'Operand':'Successor']).entries()) {
                const input=keyed(make('input'),`edge-${index}-port-${part}`);input.type='number';input.min='0';input.max='65535';input.step='1';input.value=values[part];
                input.onchange=()=>{if(!input.value.trim()||!input.checkValidity()){error(Error('Port 請填 0～65535 的整數。'));render();return;}const next=values.slice();next[part]=String(Number(input.value));edit({kind:'set-edge',index,edge:{port:next.join(':')}});};row.append(label(text,input));
            }
            row.append(button('刪除連線',`edge-${index}-remove`,{kind:'remove-edge',index}));body.append(row);
        }
        const exact=keyed(make('input'),'induced');exact.type='checkbox';exact.checked=Boolean(pattern.induced);exact.onchange=()=>edit({kind:'set-induced',value:exact.checked});body.append(label('選取節點間的連線須完全相同',exact));
        const status=make('output');status.className='hint';status.setAttribute('role','status');
        try{prepareMLIRPattern(pattern);status.textContent='結構有效；按「尋找模式」套用，或儲存目前 pattern。';}catch(reason){status.textContent='草稿尚未完成：'+reason.message;status.dataset.invalid='true';}body.append(status);
        root.replaceChildren(summary,body);body.scrollTop=scroll;
        if(key){const target=[...root.querySelectorAll('[data-cfg-key]')].find(n=>n.dataset.cfgKey===key&&!n.disabled);(target||root.querySelector('[data-cfg-key]'))?.focus({preventScroll:true});}
    }
    return {render,focus(){root.open=true;root.querySelector('input[list]')?.focus();}};
}
