import {editWireReason,editWireInferenceReason} from './model-edit-draft.js';
export function editWireUI({$,make,rpc,context,apply,message}){
    const dialog=$('edit-wire-dialog');let current=null,proposal=null,serial=0,loading=false;
    const live=()=>{const next=context();return next&&current&&next.token===current.token&&next.state===current.state;};
    const close=()=>{if(loading&&current)rpc('editDeleteInferCancel',{token:current.token}).catch(()=>{});serial++;loading=false;current=null;proposal=null;$('edit-wire-shapes').replaceChildren();if(dialog.open)dialog.close();};
    $('edit-wire-preview-cancel').onclick=close;dialog.addEventListener('cancel',close);dialog.addEventListener('keydown',e=>e.stopPropagation());
    $('edit-wire-preview-confirm').onclick=()=>{if(!proposal||!live()){$('edit-wire-preview-status').textContent='草稿已變更，請取消後重新接線。';$('edit-wire-preview-confirm').disabled=true;return;}const count=proposal.summary.tensors;if(apply(proposal.command)){close();message(`已重接並推導 ${count} 個 tensor shape；可一次復原／重做，匯出前會重新驗證。`);}};
    return {close,async request(node,slot,value){
        const next=context();if(!next)return;
        const strict=editWireReason(next.state,node,slot,value);if(!strict){apply({kind:'wire',node,slot,value});return;}
        close();current=next;const job=++serial,target=current.state.nodes.find(n=>n.id===node),source=current.state.values.get(value),old=current.state.values.get(target?.inputs[slot]?.value),reason=editWireInferenceReason(current.state,node,slot,value);
        $('edit-wire-preview-title').textContent='接線型別不同 · 確認並推導 shape';
        $('edit-wire-preview-description').textContent=`${source?.name||value} → ${target?.name||node} 輸入 ${slot+1}；${old?.type||'未知'} → ${source?.type||'未知'}。`;
        $('edit-wire-preview-confirm').disabled=true;$('edit-wire-preview-status').textContent=reason?`${reason}。Shape 推導不會改 dtype、量化或權重；請使用相容來源，或明確加入轉型／量化 OP。`:'正在本機推導下游 shape；確認前不會改動草稿。';dialog.showModal();if(reason)return;
        loading=true;
        try{const result=await rpc('editWireInfer',{token:current.token,commands:current.commands,node,slot,value});if(job!==serial||!dialog.open||!live())return;proposal=result;
            $('edit-wire-preview-status').textContent=`將重接這個輸入端，檢查 ${result.summary.operators} 個 OP、更新 ${result.summary.tensors} 個 tensor shape。這會改變計算結果，請確認下列變更。`;
            for(const row of result.summary.changes)$('edit-wire-shapes').append(make('p',`${row.node} ${row.type} · tensor #${row.tensor}：[${row.before.join(', ')}] → [${row.after.join(', ')}]`));
            if(result.summary.truncated)$('edit-wire-shapes').append(make('p','僅顯示前 100 筆；確認後套用全部推導結果。'));$('edit-wire-preview-confirm').disabled=false;
        }catch(error){if(job===serial)$('edit-wire-preview-status').textContent=error.message+'；未修改草稿。';}
        finally{if(job===serial)loading=false;}
    }};
}
