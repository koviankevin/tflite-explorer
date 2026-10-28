// The dialog edits a request, not the live model. A successful result is a new
// local artifact; ownership checks discard responses from an old model/dialog.
import {supportsModelEditing,TFLITE_EDIT_MESSAGE} from './model-edit-policy.js';
export function modelEditUI({rpc,getSource,getFormat,onStart,onBusy,onExport,openResult,downloadReport,error}) {
    const $=id=>document.getElementById(id),dialog=$('model-edit-dialog');
    let info=null,owner=null,generation=0,choiceGeneration=0,previewGeneration=0,timer,busy=false,previewing=false,pendingExports=0,portPage=0,operands=[],replacements=[],fields={},irDrafts={},targets=[];
    dialog.dataset.pendingExports='0';
    const make=(tag,text)=>{const node=document.createElement(tag);if(text!==undefined)node.textContent=text;return node;};
    const labelled=(text,input)=>{const node=make('label',text);node.append(input);return node;};
    const live=ticket=>ticket===generation&&owner===getSource()&&dialog.open;
    const changed=()=>{$('open-edited-model').disabled=true;$('download-model-edit-report').disabled=true;$('model-edit-result').textContent='修改尚未匯出。';};
    const release=(keepTargets=false)=>{generation++;choiceGeneration++;previewGeneration++;previewing=false;clearTimeout(timer);if(busy){busy=false;onBusy(false);}$('model-edit-form').inert=false;$('model-edit-form').hidden=true;info=null;owner=null;operands=[];replacements=[];fields={};irDrafts={};$('model-edit-ports').replaceChildren();$('model-edit-options').replaceChildren();$('model-edit-values').replaceChildren();$('model-edit-ir').value='';$('download-model-edit-report').disabled=true;$('open-edited-model').disabled=true;$('model-edit-back').hidden=true;if(!keepTargets){targets=[];$('model-edit-target-list').replaceChildren();$('model-edit-target-picker').hidden=true;}};
    const availability=()=>{$('export-edited-model').disabled=busy||previewing||pendingExports>0||!info;};
    const setBusy=value=>{busy=value;availability();if(value){$('open-edited-model').disabled=true;$('download-model-edit-report').disabled=true;}$('model-edit-form').inert=value;$('model-edit-back').disabled=value;onBusy(value);};
    async function choices(){
        if(!info||!dialog.open)return;const ticket=generation,request=++choiceGeneration;
        try{const rows=await rpc('modelEditValues',{graph:info.graph,node:info.node,query:$('model-edit-value-search').value});if(!live(ticket)||request!==choiceGeneration)return;
            $('model-edit-values').replaceChildren(...rows.map(row=>{const option=make('option');option.value=row.value;option.label=row.label;return option;}));
            $('model-edit-choice-count').textContent=`最多列出 50 個符合的值 · 目前 ${rows.length} 個；可繼續搜尋名稱或編號。`;
        }catch(reason){if(live(ticket))$('model-edit-choice-count').textContent=reason.message;}
    }
    function ports(){
        if(!info)return;const remove=$('model-edit-mode').value==='remove',list=remove?info.outputs:info.operands,values=remove?replacements:operands,pages=Math.max(1,Math.ceil(list.length/12));portPage=Math.min(portPage,pages-1);
        $('model-edit-port-page').textContent=`第 ${portPage+1}／${pages} 頁 · ${list.length} 個 ${remove?'outputs':'inputs'}`;
        $('model-edit-ports-previous').disabled=portPage===0;$('model-edit-ports-next').disabled=portPage===pages-1;
        $('model-edit-ports').replaceChildren(...list.slice(portPage*12,(portPage+1)*12).map((port,i)=>{
            const index=portPage*12+i,input=make('input');input.value=values[index];input.setAttribute('list','model-edit-values');input.autocomplete='off';input.maxLength=256;input.dataset.modelPort=String(index);
            input.setAttribute('aria-label',`${remove?'Output 替代值':'Input'} #${index}`);input.required=!remove;
            input.oninput=()=>{values[index]=input.value;changed();};
            const row=labelled(`${remove?'Output 替代值':'Input'} #${index} · 原 ${port.value} · ${port.name||''} · ${port.type}`,input);return row;
        }));
        $('model-edit-port-fields').hidden=remove&&info.format==='tflite'&&$('model-edit-delete-mode').value==='boundary';
    }
    function render(){
        if(!info)return;const mode=$('model-edit-mode').value,remove=mode==='remove',mlir=info.format==='mlir',advanced=$('model-edit-advanced').checked;
        $('model-edit-name-field').hidden=!mlir||remove;$('model-edit-name').disabled=!info.generic||advanced;
        $('model-edit-ir-controls').hidden=!mlir||remove;$('model-edit-ir').readOnly=!advanced;
        $('model-edit-port-fields').inert=mlir&&advanced;$('model-edit-options').hidden=remove;
        $('model-edit-boundary').hidden=!remove||mlir;
        $('model-edit-expose-field').hidden=mlir||!mode.startsWith('add-');
        $('model-edit-signature-field').hidden=mlir||!info.signatures;
        $('model-edit-ir-hint').textContent=info.deferredWeights?'大型權重以暫存標記顯示；保留標記可保留原始 bytes。完整 IR 模式可修改 properties、attributes 和型別，匯出前會重新驗證。':'完整 IR 模式可修改 properties、attributes 和型別；基本模式保留原文，只改名稱與輸入接線。';
        ports();
    }
    function parameters(){
        $('model-edit-options').replaceChildren(...(info.fields||[]).map(field=>{
            const input=make(field.kind==='bool_'?'select':'input');
            if(field.kind==='bool_'){for(const value of ['false','true']){const option=make('option',value);option.value=value;option.selected=(field.value?'true':'false')===value;input.append(option);}}
            else {input.type=field.kind==='string_'?'text':'number';input.value=field.value??'';input.maxLength=4096;if(input.type==='number'){input.step=field.kind==='float32_'?'any':'1';input.required=true;}}
            input.dataset.modelParameter=field.key;input.onchange=()=>{fields[field.group]||={};fields[field.group][field.key]=field.kind==='bool_'?input.value==='true':field.kind==='string_'?input.value:Number(input.value);changed();};
            return labelled(`${field.group} · ${field.key}`,input);
        }));
    }
    async function previewIR(){
        const request=++previewGeneration;if(!info||info.format!=='mlir'||!$('model-edit-advanced').checked){previewing=false;availability();return;}
        const mode=$('model-edit-mode').value;if(mode==='remove'){previewing=false;availability();return;}
        if(irDrafts[mode]!==undefined){previewing=false;$('model-edit-ir').value=irDrafts[mode];$('model-edit-ir').readOnly=false;availability();return;}
        const ticket=generation;previewing=true;$('export-edited-model').disabled=true;$('model-edit-ir').readOnly=true;
        try{const text=await rpc('modelEditText',{graph:info.graph,node:info.node,mode,name:info.generic?$('model-edit-name').value:undefined,operands:operands.slice()});if(!live(ticket)||request!==previewGeneration)return;$('model-edit-ir').value=text;}
        catch(reason){if(live(ticket)&&request===previewGeneration)$('model-edit-result').textContent=reason.message;}
        finally{if(live(ticket)&&request===previewGeneration){previewing=false;$('model-edit-ir').readOnly=!$('model-edit-advanced').checked;availability();}}
    }
    $('model-edit-mode').onchange=()=>{portPage=0;changed();render();if(info)$('model-edit-ir').value=irDrafts[$('model-edit-mode').value]??($('model-edit-mode').value==='replace'?info.text||'':info.addText||'');previewIR();};
    $('model-edit-delete-mode').onchange=()=>{changed();render();};
    $('model-edit-advanced').onchange=()=>{changed();render();previewIR();};
    $('model-edit-ir').oninput=()=>{irDrafts[$('model-edit-mode').value]=$('model-edit-ir').value;};
    for(const id of ['model-edit-name','model-edit-ir','model-edit-expose','model-edit-update-signatures'])$(id).addEventListener('input',changed);
    $('model-edit-value-search').oninput=()=>{clearTimeout(timer);timer=setTimeout(choices,180);};
    $('model-edit-ports-previous').onclick=()=>{portPage--;ports();};$('model-edit-ports-next').onclick=()=>{portPage++;ports();};
    $('close-model-edit').onclick=()=>dialog.close();$('cancel-model-edit').onclick=()=>dialog.close();
    dialog.addEventListener('close',()=>release());
    $('model-edit-back').onclick=()=>{if(!busy)showTargets();};
    $('open-edited-model').onclick=()=>{dialog.close();openResult();};
    $('download-model-edit-report').onclick=downloadReport;
    $('export-edited-model').onclick=async()=>{
        if(!info||busy||previewing||pendingExports||owner!==getSource())return;
        const invalid=[...$('model-edit-form').querySelectorAll('input:invalid')].find(n=>!n.closest('[hidden], [inert]')&&n.getClientRects().length);if(invalid){invalid.reportValidity();return;}
        const ticket=generation,source=owner;
        const args={graph:info.graph,node:info.node,mode:$('model-edit-mode').value,name:info.generic?$('model-edit-name').value:undefined,operands:operands.slice(),replacements:replacements.slice(),advanced:$('model-edit-advanced').checked,text:$('model-edit-ir').value,deleteMode:$('model-edit-delete-mode').value,exposeOutputs:$('model-edit-expose').checked,updateSignatures:$('model-edit-update-signatures').checked,...structuredClone(fields)};
        const name=source.name.replace(/(?:-edited)?\.[^.]+$/,'')+`-edited.${info.format==='mlir'?'mlir':'tflite'}`;
        pendingExports++;dialog.dataset.pendingExports=String(pendingExports);onStart();setBusy(true);$('model-edit-result').textContent='在本機建立候選並檢查整份模型…';
        try{
            const result=await rpc('editModelOperation',{...args,outputName:name});if(!live(ticket))return;
            await onExport(result,name,source);if(!live(ticket))return;
            $('model-edit-result').textContent=`修改模型下載已啟動。${result.validation.scope}。已重新解析輸出；未執行推論或公司 dialect／custom kernel verifier。`;
            $('open-edited-model').disabled=false;
            $('download-model-edit-report').disabled=!result.report;
            if(result.reportError)$('model-edit-result').textContent+=`\n修改報告無法產生：${result.reportError}`;
        }catch(reason){if(live(ticket)){$('model-edit-result').textContent=[reason.message,...(reason.validation?.diagnostics||[]).slice(0,10).map(d=>`${d.line?`第 ${d.line} 行 · `:''}${d.code}: ${d.message}`)].join('\n');}}
        finally{pendingExports--;dialog.dataset.pendingExports=String(pendingExports);if(owner===source&&ticket===generation)setBusy(false);else availability();}
    };
    function showTargets(){
        const source=owner;release(true);owner=source;availability();if(!owner||owner!==getSource())return;
        $('model-edit-target').textContent=`已選取 ${targets.length} 個 OP，請選擇要編輯的 OP。`;
        $('model-edit-result').textContent='每次修改一個 OP；原本框選的 layers 與模型視角會保留。';
        $('model-edit-target-picker').hidden=false;
        $('model-edit-target-list').replaceChildren(...targets.map(target=>{const button=make('button',`subgraph/block ${target.graph} · OP #${target.node} · ${target.name}`);button.className='quiet';button.type='button';button.dataset.modelEditTarget=`${target.graph}:${target.node}`;button.onclick=()=>loadTarget(target);return button;}));
        $('model-edit-target-list').firstElementChild?.focus();
    }
    async function loadTarget(location){
        if(busy)return;const source=owner;release(true);owner=source;if(!owner||owner!==getSource())return;const ticket=generation;
        $('model-edit-target-picker').hidden=true;$('model-edit-back').hidden=targets.length<2;$('model-edit-back').disabled=false;
        $('model-edit-target').textContent='讀取原始 OP…';$('model-edit-result').textContent='';availability();
        try{const data=await rpc('modelEditInfo',location);if(!live(ticket))return;info=data;operands=info.operands.map(p=>String(p.value));replacements=info.outputs.map(()=>'');fields={};portPage=0;
            $('model-edit-target').textContent=`${info.format.toUpperCase()} · subgraph/block ${info.graph} · OP #${info.node} · ${info.name}`;
            $('model-edit-mode').value='replace';$('model-edit-name').value=info.name;$('model-edit-ir').value=info.text||'';$('model-edit-advanced').checked=false;$('model-edit-expose').checked=true;$('model-edit-update-signatures').checked=false;$('model-edit-delete-mode').value='reconnect';$('model-edit-value-search').value='';
            parameters();render();$('model-edit-form').hidden=false;availability();if(targets.length>1)$('model-edit-mode').focus();await choices();
        }catch(reason){if(live(ticket)){$('model-edit-result').textContent=reason.message;error(reason);}}
    }
    return {
        clear(){release();if(dialog.open)dialog.close();busy=false;$('model-edit-form').inert=false;$('export-edited-model').disabled=true;$('open-edited-model').disabled=true;},
        async open(location){
            if(!supportsModelEditing(getFormat()))throw Error(TFLITE_EDIT_MESSAGE);
            if(busy)return;release();owner=getSource();if(!owner)return;const ticket=generation;
            $('model-edit-target').textContent='讀取原始 OP…';$('model-edit-result').textContent='';$('open-edited-model').disabled=true;$('export-edited-model').disabled=true;dialog.showModal();
            const locations=Array.isArray(location)?location:[location];
            try{if(locations.length>1){const rows=await rpc('modelEditTargets',{targets:locations});if(!live(ticket))return;targets=rows;showTargets();}else await loadTarget(locations[0]);
            }catch(reason){if(live(ticket)){$('model-edit-result').textContent=reason.message;error(reason);}}
        }
    };
}
