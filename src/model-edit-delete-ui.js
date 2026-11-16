import {editDeletePreview} from './model-edit-draft.js';
export function editDeleteUI({$,make,rpc,context,apply,message}){
    const dialog=$('edit-delete-dialog');let current=null,preview=null,impact=null,page=0,serial=0,selected=new Map(),proposal=null,inferSerial=0,inferLoading=false,inferError='',inferChoices=[],inferSource='';
    const live=()=>{const next=context();return next&&current&&next.token===current.token&&next.state===current.state&&next.node===current.node;};
    const cancelInference=()=>{if(inferLoading&&current)rpc('editDeleteInferCancel',{token:current.token}).catch(()=>{});inferSerial++;inferLoading=false;};
    const close=()=>{serial++;cancelInference();current=null;preview=null;impact=null;proposal=null;inferChoices=[];inferSource='';inferError='';selected.clear();$('edit-delete-outputs').replaceChildren();$('edit-delete-infer-details').replaceChildren();$('edit-delete-infer-source').replaceChildren();if(dialog.open)dialog.close();};
    const error=text=>{$('edit-delete-error').textContent=text;};
    function availability(){
        const mode=$('edit-delete-mode').value;
        $('edit-delete-confirm').disabled=!impact||!live()||mode==='infer'&&(inferLoading||proposal?.status!=='ready')||mode==='reconnect'&&preview.outputs.some(o=>{const use=impact.find(r=>r.value===o.value);return use.signaturesOutsideOutputs||(use.uses||use.modelOutputs.length||use.signatures)&&!selected.get(o.value);});
    }
    function render(){
        const mode=$('edit-delete-mode').value,rows=$('edit-delete-outputs');rows.replaceChildren();
        $('edit-delete-policy').textContent=mode==='infer'?'先建議接回資料輸入，再沿下游推導 shape。請確認接線與尺寸變更；刪除會改變計算結果，不會改 dtype、量化或權重。':mode==='reconnect'?'每個仍被使用的輸出需指定替代 tensor。相容只代表介面可接，刪除仍會改變計算結果；不會自動插入 Cast／Reshape 或推測權重。':mode==='boundary'?'仍使用的輸出將成為模型 inputs，保留 dtype、shape 與量化，呼叫端需提供這些資料。':'只標記刪除，保留未接線的位置；需手動修好後才能匯出。';
        $('edit-delete-inference').hidden=mode!=='infer';$('edit-delete-query').closest('label').hidden=mode!=='reconnect';
        if(mode==='infer'){
            const select=$('edit-delete-infer-source');select.replaceChildren(new Option('自動選擇資料輸入',''));for(const c of inferChoices)select.append(new Option(`${c.value} · ${c.name} · ${c.type}`,c.value));select.value=inferSource;select.disabled=inferLoading||!impact;$('edit-delete-infer-run').disabled=inferLoading||!impact;
            const body=$('edit-delete-infer-details');body.replaceChildren();
            $('edit-delete-infer-status').textContent=inferLoading?'正在本機推導下游 shape，可取消；尚未修改草稿。':(inferError||proposal)?inferError||`建議接回 ${proposal.source.value} · ${proposal.source.name}；檢查 ${proposal.summary.operators} 個下游 OP，更新 ${proposal.summary.tensors} 個 tensor。`:'';
            if(proposal){for(const row of proposal.summary.changes)body.append(make('p',`${row.node} ${row.type} · tensor #${row.tensor}：[${row.before.join(', ')}] → [${row.after.join(', ')}]`));if(proposal.summary.truncated)body.append(make('p','僅預覽前 100 個尺寸變更；確認後會套用本輪推導的全部變更。','hint'));}
        }
        if(!preview||!impact){availability();return;}
        const query=$('edit-delete-query').value.trim().toLowerCase(),size=8,pages=Math.max(1,Math.ceil(preview.outputs.length/size));page=Math.min(page,pages-1);
        for(const output of preview.outputs.slice(page*size,(page+1)*size)){
            const usage=impact.find(r=>r.value===output.value),section=make('section');section.dataset.deleteOutput=output.value;
            section.append(make('h3',`${output.name} · ${output.value}`),make('p',output.type),make('p',`${usage.uses} 個輸入端使用 · ${usage.modelOutputs.length} 個模型輸出 · ${usage.signatures} 個 signature 輸出`));
            if(usage.consumers.length){const ul=make('ul');for(const u of usage.consumers)ul.append(make('li',`${u.node} · ${u.name} · 輸入 ${u.slot+1}${u.inWorkspace?'':'（編輯範圍外，也會重接）'}`));if(usage.uses>usage.consumers.length)ul.append(make('li',`另有 ${usage.uses-usage.consumers.length} 個輸入端；確認後全部重接。`));section.append(ul);}
            if(usage.customUses)section.append(make('p','包含 custom OP 使用者；custom options 原樣保留，私有語意需由對應 runtime 驗證。','hint'));
            if(usage.signaturesOutsideOutputs&&mode==='reconnect')section.append(make('p','Signature 引用了子圖 outputs 之外的 tensor，目前無法安全自動重接，請先調整 signature。','edit-problem'));
            if(mode==='reconnect'){
                const label=make('label','替代來源'),select=make('select');select.dataset.deleteReplacement=output.value;
                const needed=usage.uses||usage.modelOutputs.length;select.append(new Option(needed?'請選擇相容的上游 tensor':'此輸出未被使用，可不指定替代',''));
                const choices=output.choices.filter(v=>v.value===selected.get(output.value)||!query||`${v.value} ${v.name} ${v.type}`.toLowerCase().includes(query)).sort((a,b)=>Number(!!a.reason)-Number(!!b.reason)||Number(b.preferred)-Number(a.preferred));
                const visible=choices.slice(0,50),chosen=choices.find(v=>v.value===selected.get(output.value));if(chosen&&!visible.includes(chosen))visible.push(chosen);
                for(const choice of visible){const option=new Option(`${choice.value} · ${choice.name} · ${choice.type}${choice.reason?' — '+choice.reason:''}`,choice.value);option.disabled=!!choice.reason;select.append(option);}
                select.value=selected.get(output.value)||'';select.onchange=()=>{selected.set(output.value,select.value);error('');availability();};label.append(select);section.append(label);
                if(choices.length>50)section.append(make('p','列出前 50 個候選，可用上方搜尋縮小；目前選取會保留。','hint'));
                if(!choices.some(v=>!v.reason))section.append(make('p',query?'搜尋結果沒有可直接重接的相容來源，請調整搜尋或查看型別差異。':'沒有可直接重接的相容來源。請查看候選的 dtype／shape／量化差異，改用模型 inputs 或手動接線。','edit-problem'));
            }
            rows.append(section);
        }
        $('edit-delete-page').textContent=`${page+1}／${pages} 頁 · ${preview.outputs.length} 個輸出`;$('edit-delete-previous').disabled=page===0;$('edit-delete-next').disabled=page+1===pages;
        $('edit-delete-query').disabled=mode!=='reconnect';availability();
    }
    async function infer(source){
        if(!current||!live()||!impact)return;const job=++inferSerial;proposal=null;inferLoading=true;inferError='';render();
        try{const result=await rpc('editDeleteInfer',{token:current.token,node:current.node,commands:current.commands,...(source?{source}:{})});if(job!==inferSerial||!dialog.open||!live())return;proposal=result;inferChoices=result.choices;inferSource=result.source.value;}
        catch(e){if(job===inferSerial)inferError=e.message;}
        finally{if(job===inferSerial){inferLoading=false;render();}}
    }
    $('edit-delete-mode').onchange=()=>{error('');if($('edit-delete-mode').value!=='infer')cancelInference();if($('edit-delete-mode').value==='infer'&&!proposal&&!inferLoading)infer(inferSource);else render();};$('edit-delete-query').oninput=render;
    $('edit-delete-infer-source').onchange=()=>{inferSource=$('edit-delete-infer-source').value;infer(inferSource);};$('edit-delete-infer-run').onclick=()=>infer(inferSource);
    $('edit-delete-previous').onclick=()=>{page--;render();};$('edit-delete-next').onclick=()=>{page++;render();};
    $('edit-delete-cancel').onclick=close;dialog.addEventListener('cancel',close);dialog.addEventListener('keydown',e=>e.stopPropagation());
    $('edit-delete-confirm').onclick=()=>{
        if(!impact||!live()){error('草稿已變更，請關閉後重新預覽。');return;}
        const mode=$('edit-delete-mode').value,replacements=[...selected].filter(([,value])=>value).map(([from,value])=>({from,value}));
        if(mode==='infer'){
            if(inferLoading||proposal?.status!=='ready'){error('請先完成 shape 推導，再確認套用。');return;}
            const summary=proposal.summary;if(apply(proposal.command)){close();message(`已自動重接並更新 ${summary.tensors} 個 tensor shape；整組可一次復原／重做。匯出前會重新推導與驗證，不執行 interpreter。`);}return;
        }
        if(mode==='reconnect'&&preview.outputs.some(o=>{const row=impact.find(r=>r.value===o.value);return row.signaturesOutsideOutputs||(row.uses||row.modelOutputs.length||row.signatures)&&!selected.get(o.value);})){error('請指定相容來源；特殊 signature 介面需先調整 signature。');return;}
        const command=mode==='reconnect'?{kind:'delete-reconnect',node:current.node,replacements}:{kind:'remove',node:current.node,boundary:mode==='boundary'};
        if(apply(command)){close();message('已套用刪除草稿；整組重接可一次復原／重做。模型輸出若改變，匯出時需同步更新 signatures。');}
    };
    return {close,async open(){
        close();current=context();if(!current)return;
        try{preview=editDeletePreview(current.state,current.node);}catch(e){message(e.message);return;}
        const job=++serial;page=0;selected=new Map(preview.outputs.map(o=>[o.value,o.suggested]));
        $('edit-delete-title').textContent=`刪除並處理連線 · ${preview.name}`;$('edit-delete-mode').value='infer';$('edit-delete-query').value='';
        $('edit-delete-mode').querySelector('[value=boundary]').disabled=current.state.composition||current.state.nodes.find(n=>n.id===current.node).fresh;
        error('正在本機檢查整個 subgraph 的使用者與模型輸出…');render();dialog.showModal();
        try{const result=await rpc('editDeleteImpact',{token:current.token,node:current.node,commands:current.commands});if(job!==serial||!dialog.open)return;if(!live())throw Error('草稿已變更，請重新預覽。');impact=result;error('');render();if($('edit-delete-mode').value==='infer')await infer();}
        catch(e){if(job===serial)error(e.message);}
    }};
}
