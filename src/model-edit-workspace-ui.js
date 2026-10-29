import {modelEditDraft,editChanges,editIssues,editWireReason,editTemplateReason,editPosition} from './model-edit-draft.js';
import {EDIT_DRAFT_LIMIT,parseEditSession,exportEditSession} from './model-edit-session.js';
import {editNewOpsUI} from './model-edit-new-ops-ui.js';
import {editRecoveryUI} from './edit-recovery-ui.js';
import {resizeInFrame} from './resize-in-frame.js';
import {supportsModelEditing,TFLITE_EDIT_MESSAGE} from './model-edit-policy.js';
import {runtimeClient} from './tflite-runtime-client.js';
import {runtimeSkipped,runtimeSummary} from './tflite-runtime-policy.js';
import {attachRuntimeReport} from './tflite-runtime-report.js';
import {runtimeInputsUI} from './tflite-runtime-inputs-ui.js';
import {modelEditLayout} from './model-edit-layout.js';
import {compositionInterface} from './model-composition-draft.js';
const NS='http://www.w3.org/2000/svg';
export function modelEditWorkspaceUI({rpc,getSource,getFormat,getTargets,getCompositionTargets=getTargets,getCompositionLabel=()=>'',getGraph,chooseModel,saveFile,onBusy,onExport,isCurrentResult,openResult,downloadReport}){
    const $=id=>document.getElementById(id),root=$('edit-workspace'),viewport=$('edit-viewport'),world=$('edit-world'),svg=$('edit-links');
    let owner=null,snapshot=null,draft=null,active=false,busy=false,generation=0,selected=null,armed=null,zoom=1,exported='',exportedToken=null,pages=new Map(),frame=0,gesture=null,exploreScroll=null;
    const runtime=runtimeClient(),runtimeInputs=runtimeInputsUI();let checked=null;
    const signature=()=>JSON.stringify({commands:draft?.commands,updateSignatures:$('edit-signatures').checked});
    let pendingDraft=null,pendingRecoveryRecord=null,savedDraft='',draftTask=false;
    let parked={};
    const historySignature=()=>JSON.stringify({history:draft?.history,updateSignatures:$('edit-signatures').checked});
    const currentDirty=()=>!!draft&&(changes().length>0||draft.canRedo)&&exported!==signature()&&savedDraft!==historySignature();
    const banner=text=>{$('edit-draft-banner').hidden=false;$('edit-draft-hint').textContent=text;$('choose-edit-draft-model').hidden=draftTask||!pendingDraft;};
    const recovery=editRecoveryUI({capture:()=>owner&&snapshot&&draft?{file:owner,snapshot,history:draft.history,view:{selected:selected??null,zoom,font:Number($('edit-font').value),left:viewport.scrollLeft,top:viewport.scrollTop},options:{updateSignatures:$('edit-signatures').checked}}:null,restore:(document,record)=>{pendingDraft=document;pendingRecoveryRecord=record;banner(`請重新選取原模型「${document.source.name}」。將核對完整檔案指紋，再恢復本機編輯。`);},exportFile:saveFile,chooseImport:()=>{$('edit-draft-file').value='';$('edit-draft-file').click();}});
    const changed=()=>{if(draft){const h=draft.history;if(h.commands.length||h.redo.length||recovery.touched)recovery.change();}};
    for(const type of ['click','input','change','pointerup','wheel','scroll'])root.addEventListener(type,changed,{capture:true,passive:true});
    const make=(tag,text,cls)=>{const e=document.createElement(tag);if(text!==undefined)e.textContent=text;if(cls)e.className=cls;return e;};
    const newOps=editNewOpsUI({$,make,rpc,state:()=>draft?.state,selected:()=>selected,apply,message:text=>message(text),isBusy:()=>busy});
    const message=text=>{$('edit-message').textContent=text;};
    const live=ticket=>ticket===generation&&owner===getSource();
    const changes=()=>draft?editChanges(snapshot,draft.state):[];
    const modeButtons=()=>{
        $('explore-mode').setAttribute('aria-pressed',String(!active));
        $('edit-mode').setAttribute('aria-pressed',String(active));
        $('edit-session').value=snapshot?.composition?'composition':'edit';
    };
    const mode=value=>{
        if(value===active){modeButtons();return;}
        if(value){const t=$('target'),p=document.scrollingElement;exploreScroll={left:t.scrollLeft,top:t.scrollTop,x:p.scrollLeft,y:p.scrollTop};}
        active=value;root.hidden=!value;document.body.classList.toggle('editing-model',value);
        modeButtons();
        if(!value&&exploreScroll)requestAnimationFrame(()=>{$('target').scrollTo({left:exploreScroll.left,top:exploreScroll.top,behavior:'instant'});document.scrollingElement.scrollTo({left:exploreScroll.x,top:exploreScroll.y,behavior:'instant'});});
        if(value){if(!pendingDraft&&!draftTask)$('edit-draft-banner').hidden=true;availability();schedule();}
    };
    function availability(){
        const composing=!!snapshot?.composition,editable=getFormat()==='tflite';$('edit-mode').disabled=busy||!editable;
        for(const id of ['compose-mode','compose-capture']){$(id).hidden=!editable;$(id).disabled=busy||!editable||!getCompositionTargets().length;}
        $('compose-mode').hidden=!editable||root.ownerDocument.body.classList.contains('pattern-picking');
        $('edit-session').disabled=busy||!draft;$('edit-session').querySelector('[value=composition]').disabled=!composing&&!parked.composition;
        $('edit-restart').disabled=busy||!draft;modeButtons();
        $('edit-workspace-title').textContent=composing?'組合模型草稿':'編輯實際模型';$('edit-export-description').textContent=composing?'本機處理 · 匯出所選片段組成的獨立模型':'模型全程在本機處理 · 先驗證，再匯出整份模型';$('edit-export').textContent=composing?'驗證並匯出組合模型':'驗證並匯出模型';$('edit-add-selection').textContent='加入探索圖已選 OP';
        const valid=!!draft,dirty=changes().length>0;
        for(const id of ['edit-add-before','edit-add-after','edit-delete','edit-restore','edit-clear','edit-add-selection','edit-undo','edit-redo','edit-export'])$(id).disabled=busy||!valid;
        $('edit-undo').disabled=busy||!draft?.canUndo;$('edit-redo').disabled=busy||!draft?.canRedo;$('edit-clear').disabled=busy||!draft?.canUndo&&!draft?.canRedo;
        const node=draft?.state.nodes.find(n=>n.id===selected);
        $('edit-add-before').disabled=$('edit-add-after').disabled=busy||!node?.cloneable||!!node?.removed;
        $('edit-delete').disabled=busy||!node?.removable||!!node?.removed;$('edit-restore').hidden=!node?.removed;
        $('edit-export').disabled=busy||!dirty||!!draft&&editIssues(draft.state).length>0;
        $('edit-advanced').disabled=busy||!node||node.fresh||node.removed||dirty||composing;
        $('edit-open-result').disabled=busy||!exported||exported!==signature()||!isCurrentResult(exportedToken);
        $('edit-download-report').disabled=$('edit-open-result').disabled;
        $('edit-signatures-field').hidden=composing||!snapshot?.hasSignatures;
        $('edit-runtime-check').disabled=busy||!valid||!!draft&&editIssues(draft.state).length>0;
        if(composing&&draft){const iface=compositionInterface(draft.state);if(iface.missing.length||!iface.outputs.length)$('edit-export').disabled=$('edit-runtime-check').disabled=true;}
        for(const input of root.querySelectorAll('[data-composition-side]'))input.disabled=busy;
        $('edit-runtime-download').disabled=busy||!checked?.io?.archive||!checkedCurrent();
        root.setAttribute('aria-busy',String(busy));
        $('choose-edit-draft-model').hidden=draftTask||!pendingDraft;$('save-edit-draft').disabled=busy||!valid;$('open-edit-draft').disabled=busy;$('edit-template').disabled=busy;
    }
    const setBusy=value=>{busy=value;onBusy(value);availability();};
    function apply(command){if(busy||!draft)return;try{draft.apply(command);if(command.kind==='clone')selected=draft.state.nodes.find(n=>n.serial===draft.state.next).id;armed=null;render();message('草稿已更新；請查看變更預覽，驗證後才會寫出新模型。');}catch(error){message(error.message);}}
    function source(value){armed=armed===value?null:value;const v=draft.state.values.get(value);message(armed?`已選接出：${v.name}；下一步點目標 OP 的「接入」。綠框可接，紅框請看原因。`:'已取消接線。');wireStatus();for(const b of world.querySelectorAll('[data-edit-output]'))b.classList.toggle('armed',b.dataset.editOutput===armed);for(const b of world.querySelectorAll('[data-edit-input]')){const reason=armed?editWireReason(draft.state,b.dataset.editInput,Number(b.dataset.editSlot),armed):'';b.classList.toggle('wire-compatible',!!armed&&!reason);b.classList.toggle('wire-incompatible',!!armed&&!!reason);if(armed)b.title=reason||'型別相容，可接線；完整 SSA／控制流程於匯出驗證。';}}
    function wireStatus(){$('edit-wire-status').hidden=!armed;$('edit-wire-label').textContent=armed?`接線中：${draft.state.values.get(armed)?.name} → 請點目標「接入」`:'';}
    $('edit-wire-cancel').onclick=()=>{if(armed)source(armed);};
    const portPage=node=>pages.get(node.id)||0;
    function card(node){
        const card=make('article',undefined,`edit-node${node.fresh?' added':''}${node.removed?' removed':''}${node.id===selected?' selected':''}`);card.dataset.editNode=node.id;
        const title=make('button',node.name,'edit-node-title');title.type='button';title.title=node.name;title.onclick=()=>{selected=node.id;renderInspector();availability();for(const e of world.querySelectorAll('[data-edit-node]'))e.classList.toggle('selected',e.dataset.editNode===selected);draw();};card.append(title);
        card.append(make('small',`${node.fresh?'新增 OP':`OP #${node.source.node}`} · block/subgraph ${node.source.graph}`));
        if(node.groups?.length)card.append(make('small',node.groups.map(id=>draft.state.groups.find(g=>g.id===id)?.label).filter(Boolean).join(' · '),'edit-composition-group'));
        const row=make('div',undefined,'edit-port-columns'),ins=make('div'),outs=make('div'),page=portPage(node),size=8;
        ins.append(make('strong','輸入'));outs.append(make('strong',node.fresh?'輸出（自動建立）':'輸出'));
        node.inputs.slice(page*size,(page+1)*size).forEach((port,i)=>{const slot=page*size+i,v=draft.state.values.get(port.value),button=make('button',`接入 ${slot+1} · ${v?.name||'缺少來源'}`,'edit-port input');button.type='button';button.title=`${v?.name||''} · ${port.type}`;button.dataset.editInput=node.id;button.dataset.editSlot=String(slot);button.disabled=node.removed;
            button.onclick=()=>{selected=node.id;if(armed)apply({kind:'wire',node:node.id,slot,value:armed});else {renderInspector();message(`先點來源輸出端，再點 ${node.name} 的輸入 ${slot+1}。`);}};ins.append(button);});
        node.outputs.slice(page*size,(page+1)*size).forEach((port,i)=>{const v=draft.state.values.get(port.value),button=make('button',`接出 ${page*size+i+1} · ${v.name}`,'edit-port output');button.type='button';button.title=`${v.name} · ${v.type}`;button.dataset.editOutput=port.value;button.disabled=node.removed&&!node.boundary;button.onclick=()=>source(port.value);outs.append(button);});row.append(ins,outs);card.append(row);
        const count=Math.max(node.inputs.length,node.outputs.length),nav=make('div',undefined,'edit-port-nav');if(count>size){for(const [label,offset] of [['上一頁',-1],['下一頁',1]]){const b=make('button',label,'text-button');b.disabled=page+offset<0||(page+offset)*size>=count;b.onclick=()=>{pages.set(node.id,page+offset);render();};nav.append(b);}nav.append(make('small',`${page+1}／${Math.ceil(count/size)} 頁`));}card.append(nav);return card;
    }
    function renderInspector(){
        const node=draft?.state.nodes.find(n=>n.id===selected),body=$('edit-node-details');body.replaceChildren();if(node){body.append(make('h3',node.name),make('p',`${node.block} · ${node.fresh?'新增 OP':`OP #${node.source.node}`}`));
            for(const side of ['inputs','outputs']){const list=make('ul');for(const [i,p] of node[side].entries()){if(i>=32){list.append(make('li',`另有 ${node[side].length-32} 個 ports，可在圖上分頁查看。`));break;}const v=draft.state.values.get(p.value);list.append(make('li',`${side==='inputs'?'輸入':'輸出'} ${i+1}：${v?.name||''} · ${p.type||v?.type||''}`));}body.append(list);}
        }
        $('edit-boundary-field').hidden=!!snapshot.composition||!node||snapshot.format!=='tflite'||node.fresh;$('edit-boundary').checked=!!node?.boundary;
        $('edit-expose-field').hidden=!!snapshot.composition||!node?.fresh||snapshot.format!=='tflite';$('edit-expose').checked=!!node?.exposed;
        $('edit-template-field').hidden=!node?.fresh||!!node?.removed;$('edit-template').replaceChildren(new Option('選擇相容的原始 OP 範本',''));if(node?.fresh)for(const base of draft.state.nodes.filter(n=>!n.fresh&&n.cloneable)){const reason=editTemplateReason(draft.state,node.id,base.id),option=new Option(`${base.name} · OP #${base.source.node}${reason?' — '+reason:''}`,base.id);option.disabled=!!reason;option.selected=!node.builtin&&base.source.graph===node.source.graph&&base.source.node===node.source.node;$('edit-template').append(option);}
        newOps.render();
        renderCompositionInterface();
        const list=$('edit-change-list');list.replaceChildren();const diff=changes();$('edit-change-count').textContent=`${diff.length} 筆變更 · 尚未套用到原模型`;
        for(const c of diff){const row=make('li');row.append(make('strong',`${c.kind==='add'?'新增':c.kind==='remove'?'刪除':'改線'} · ${c.name}`));row.append(make('p',c.kind==='wire'?`輸入 ${c.slot+1}：${c.before} → ${c.after}`:c.kind==='add'?`輸入：${c.inputs.join('、')}；自動輸出：${c.outputs.join('、')}${c.exposed?'；加入模型 outputs':''}`:c.boundary?'仍被使用的輸出保留成模型 inputs':'仍被使用的輸出需重新接線'));for(const p of c.parameters||[])row.append(make('p',`亂數輸入 ${p.slot+1}：seed ${p.seed}，範圍 ${p.min}～${p.max}，${p.bytes} bytes`));list.append(row);}
        for(const issue of draft?editIssues(draft.state).slice(0,8):[])list.append(make('li',`${issue.node} 輸入 ${issue.slot+1}：${issue.message}`,'edit-problem'));
        availability();
    }
    function renderCompositionInterface(){
        const section=$('edit-composition-interface');section.hidden=!snapshot?.composition;section.replaceChildren();if(section.hidden)return;
        const state=draft.state,iface=compositionInterface(state);section.append(make('h3','已加入的片段'));
        for(const group of state.groups)section.append(make('p',`${group.label} · ${group.nodes.length} 個來源 OP`));
        section.append(make('p','輸入依未接入的資料來源建立；權重維持原始資料。取消必要輸入後，需先重接線才能匯出。輸出可勾選多個。','hint'));
        for(const side of ['inputs','outputs']){section.append(make('h3',side==='inputs'?'模型輸入':'模型輸出'));const selectedIds=iface[side];
            for(const id of side==='inputs'?iface.availableInputs:iface.availableOutputs){const v=state.values.get(id),label=make('label',undefined,'edit-interface-choice'),check=make('input');check.type='checkbox';check.checked=selectedIds.includes(id);check.dataset.compositionSide=side;check.dataset.compositionValue=id;check.disabled=busy;check.onchange=()=>apply({kind:'interface',node:selected||state.nodes[0].id,value:id,side,enabled:check.checked});label.append(check,make('span',`${v.name} · ${v.type}`));section.append(label);}}
        if(iface.missing.length)section.append(make('p','仍需接線或保留的輸入：'+iface.missing.map(id=>state.values.get(id).name).join('、'),'edit-problem'));
        if(!iface.outputs.length)section.append(make('p','請至少選擇一個模型輸出。','edit-problem'));
    }
    function render(){
        if(!draft)return;if(checked&&!checkedCurrent()){checked=null;$('edit-runtime-result').textContent='草稿已變更，尚未檢查';delete $('edit-runtime-result').dataset.status;}world.querySelectorAll('.edit-node,.edit-boundary,.edit-block-label').forEach(e=>e.remove());
        const state=draft.state;
        for(const node of state.nodes)world.append(card(node));
        const producers=new Set(state.nodes.filter(n=>!n.removed||n.boundary).map(n=>n.id)),used=new Set(state.nodes.filter(n=>!n.removed).flatMap(n=>n.inputs.map(p=>p.value)));
        for(const id of used){const v=state.values.get(id);if(v.optional||v.missing||producers.has(v.producer))continue;const box=make('article',undefined,'edit-boundary');box.dataset.editBoundary=id;const button=make('button','接出 · '+v.name,'edit-port output');button.title=`${v.kind} · ${v.type}`;button.dataset.editOutput=id;button.onclick=()=>source(id);box.append(make('small',v.kind),button,make('small',v.type));world.append(box);}
        $('edit-scope').textContent=snapshot.composition?`原模型保留 · ${state.groups.length} 個片段 · ${state.nodes.filter(n=>!n.removed).length} 個組合 OP`:`原模型 ${snapshot.total.toLocaleString()} 個 OP · 編輯範圍 ${snapshot.nodes.length} 個原始 OP＋${state.nodes.filter(n=>n.fresh&&!n.removed).length} 個新增 OP`;
        renderInspector();wireStatus();schedule();changed();
    }
    function schedule(){if(frame)return;frame=requestAnimationFrame(()=>{frame=0;if(!active||!draft)return;layout();});}
    function layout(){
        const state=draft.state,font=Number($('edit-font').value),width=Math.round(310*Math.sqrt(font/14)),cards=new Map([...world.querySelectorAll('[data-edit-node]')].map(e=>[e.dataset.editNode,e]));
        for(const e of cards.values())e.style.width=`${width}px`;
        let boundaryY=54;for(const e of world.querySelectorAll('.edit-boundary')){e.style.width=`${width}px`;e.style.left='24px';e.style.top=`${boundaryY}px`;boundaryY+=e.offsetHeight+32;}
        const plan=modelEditLayout([...state.nodes].sort((a,b)=>editPosition(state,a)-editPosition(state,b)),state.values,new Map([...cards].map(([id,e])=>[id,e.offsetHeight])),{width,left:width+164});
        world.querySelectorAll('.edit-block-label').forEach(e=>e.remove());
        for(const block of plan.blocks){const label=make('div',`block/subgraph ${block.graph}`,'edit-block-label');label.dataset.editBlock=String(block.graph);label.style.left=`${block.x}px`;label.style.top=`${block.y}px`;world.append(label);}
        for(const [id,p]of plan.positions){const e=cards.get(id);e.style.left=`${p.x}px`;e.style.top=`${p.y}px`;}
        const worldWidth=plan.width,height=Math.max(plan.height,boundaryY+40);world.style.width=`${worldWidth}px`;world.style.height=`${height}px`;svg.setAttribute('width',String(worldWidth));svg.setAttribute('height',String(height));svg.setAttribute('viewBox',`0 0 ${worldWidth} ${height}`);scale();draw();
    }
    function scale(){world.style.transform=`scale(${zoom})`;$('edit-spacer').style.width=`${world.offsetWidth*zoom}px`;$('edit-spacer').style.height=`${world.offsetHeight*zoom}px`;$('edit-zoom-value').textContent=`${Math.round(zoom*100)}%`;}
    function zoomAt(next,x=viewport.clientWidth/2,y=viewport.clientHeight/2){
        next=Math.max(.15,Math.min(2,next));const worldX=(viewport.scrollLeft+x)/zoom,worldY=(viewport.scrollTop+y)/zoom;zoom=next;scale();viewport.scrollLeft=worldX*zoom-x;viewport.scrollTop=worldY*zoom-y;
    }
    viewport.addEventListener('wheel',e=>{if(busy||!draft||e.ctrlKey||e.metaKey||!e.deltaY)return;e.preventDefault();const r=viewport.getBoundingClientRect(),unit=e.deltaMode===1?16:e.deltaMode===2?viewport.clientHeight:1;zoomAt(zoom*Math.exp(-Math.max(-240,Math.min(240,e.deltaY*unit))*.002),e.clientX-r.left,e.clientY-r.top);},{passive:false});
    function draw(){
        if(!draft)return;svg.replaceChildren();const state=draft.state,r=world.getBoundingClientRect(),point=(e,side)=>{const b=e.getBoundingClientRect();return {x:((side==='right'?b.right+8:side==='left'?b.left-8:b.left+b.width/2)-r.left)/zoom,y:(b.top+b.height/2-r.top)/zoom};};
        const outputs=new Map([...world.querySelectorAll('[data-edit-output]')].map(e=>[e.dataset.editOutput,e]));
        const path=(a,b,cls)=>{const p=document.createElementNS(NS,'path');p.setAttribute('d',`M${a.x},${a.y} C${a.x+90},${a.y} ${b.x-90},${b.y} ${b.x},${b.y}`);p.setAttribute('class',cls);p.setAttribute('vector-effect','non-scaling-stroke');svg.append(p);};
        for(const input of world.querySelectorAll('[data-edit-input]')){const node=state.nodes.find(n=>n.id===input.dataset.editInput),slot=Number(input.dataset.editSlot),value=node.inputs[slot].value,out=outputs.get(value),old=snapshot.nodes.find(n=>n.id===node.id)?.inputs[slot]?.value;
            if(old&&old!==value&&outputs.has(old))path(point(outputs.get(old),'right'),point(input,'left'),'edit-link old');if(out)path(point(out,'right'),point(input,'left'),`edit-link${old&&old!==value||node.fresh?' changed':''}${node.removed?' broken':''}`);}
        for(const c of snapshot.controls){const from=world.querySelector(`[data-edit-node="${c.from}"]`),to=world.querySelector(`[data-edit-block="${c.graph}"]`);if(from&&to)path(point(from,'right'),point(to,'left'),'edit-link control');}
        const selectedCard=world.querySelector(`[data-edit-node="${selected}"]`);if(selectedCard){const b=selectedCard.getBoundingClientRect(),outline=document.createElementNS(NS,'rect');for(const [k,v] of Object.entries({x:(b.left-r.left)/zoom-3,y:(b.top-r.top)/zoom-3,width:b.width/zoom+6,height:b.height/zoom+6,rx:10}))outline.setAttribute(k,String(v));outline.setAttribute('class','edit-selected-outline');outline.setAttribute('vector-effect','non-scaling-stroke');svg.append(outline);}
    }
    function endGesture(){if(!gesture)return;document.removeEventListener('pointermove',moveGesture,true);document.removeEventListener('pointerup',upGesture,true);document.removeEventListener('pointercancel',endGesture,true);gesture=null;}
    function moveGesture(e){if(!gesture||e.pointerId!==gesture.id)return;const dx=e.clientX-gesture.x,dy=e.clientY-gesture.y;if(Math.hypot(dx,dy)>5)gesture.moved=true;if(gesture.pan){viewport.scrollLeft=gesture.left-dx;viewport.scrollTop=gesture.top-dy;}if(gesture.moved)e.preventDefault();}
    function upGesture(e){if(!gesture||e.pointerId!==gesture.id)return;const g=gesture;endGesture();if(g.moved){const suppress=event=>{event.preventDefault();event.stopImmediatePropagation();document.removeEventListener('click',suppress,true);};document.addEventListener('click',suppress,true);setTimeout(()=>document.removeEventListener('click',suppress,true),0);e.preventDefault();}if(g.value&&g.moved){const input=document.elementFromPoint(e.clientX,e.clientY)?.closest('[data-edit-input]');if(input)apply({kind:'wire',node:input.dataset.editInput,slot:Number(input.dataset.editSlot),value:g.value});else message('未接到輸入端，草稿未改變。');e.preventDefault();e.stopImmediatePropagation();}}
    viewport.addEventListener('pointerdown',e=>{if(busy||e.button!==0&&e.button!==1)return;const output=!e.altKey&&e.button===0?e.target.closest('[data-edit-output]'):null,pan=e.altKey||e.button===1||!e.target.closest('button,.edit-node,.edit-boundary');if(!output&&!pan)return;gesture={id:e.pointerId,x:e.clientX,y:e.clientY,left:viewport.scrollLeft,top:viewport.scrollTop,pan:!output,value:output?.dataset.editOutput,moved:false};document.addEventListener('pointermove',moveGesture,true);document.addEventListener('pointerup',upGesture,true);document.addEventListener('pointercancel',endGesture,true);if(pan)e.preventDefault();});
    $('edit-add-before').onclick=()=>apply({kind:'clone',node:selected,side:'before'});$('edit-add-after').onclick=()=>apply({kind:'clone',node:selected,side:'after'});
    $('edit-delete').onclick=()=>apply({kind:'remove',node:selected,boundary:$('edit-boundary').checked});$('edit-restore').onclick=()=>apply({kind:'restore',node:selected});
    $('edit-expose').onchange=()=>apply({kind:'expose',node:selected,enabled:$('edit-expose').checked});$('edit-boundary').onchange=()=>{const n=draft?.state.nodes.find(n=>n.id===selected);if(n?.removed)apply({kind:'remove',node:selected,boundary:$('edit-boundary').checked});};
    const travel=redo=>{if(!busy&&draft){draft[redo?'redo':'undo']();armed=null;if(!draft.state.nodes.some(n=>n.id===selected))selected=draft.state.nodes[0]?.id||null;render();}};
    $('edit-undo').onclick=()=>travel(false);$('edit-redo').onclick=()=>travel(true);$('edit-clear').onclick=()=>{if(!busy&&draft){draft.clear();armed=null;selected=draft.state.nodes[0]?.id||null;render();message('已撤銷所有變更；原始編輯範圍保留。要清空範圍，請用「重新開始草稿」。');}};
    $('edit-zoom-in').onclick=()=>{zoomAt(zoom*1.25);};$('edit-zoom-out').onclick=()=>{zoomAt(zoom/1.25);};$('edit-fit').onclick=()=>{zoom=Math.max(.15,Math.min(1,viewport.clientWidth/world.offsetWidth,viewport.clientHeight/world.offsetHeight));scale();viewport.scrollTo(0,0);};
    $('edit-font').onchange=()=>{root.style.setProperty('--edit-font',`${$('edit-font').value}px`);schedule();};
    $('edit-find').oninput=()=>{const q=$('edit-find').value.toLowerCase();for(const e of world.querySelectorAll('[data-edit-node]'))e.classList.toggle('find-hit',!!q&&e.textContent.toLowerCase().includes(q));};
    async function extend(targets,label=null){if(busy||!draft)return;if(label!==null&&targets.length&&targets.every(t=>draft.state.nodes.some(n=>!n.removed&&!n.fresh&&n.source.graph===t.graph&&n.source.node===t.node))){message('選取的 OP 已在組合草稿，保留現有接線與設定。');return;}if(!targets.length){message('請先在模型圖上選取要加入的 OP；原草稿會保留。');return;}const ticket=generation,history=draft.history,command=label===null?null:importCommand(targets,label),commands=command?[...history.commands,command]:history.commands,redo=command?[]:history.redo;setBusy(true);try{const next=await rpc('editWorkspaceExtend',{token:snapshot.token,targets,commands,redo});if(!live(ticket))return;const nextDraft=modelEditDraft(next,commands,redo);snapshot=next;draft=nextDraft;if(!selected)selected=draft.state.nodes[0]?.id||null;render();requestAnimationFrame(()=>$('edit-fit').click());message(command?'片段已加入組合草稿；重疊 OP 共用一份，原有接線保留。':'已同步圖上選取的 OP，保留原有接線與草稿。');}catch(error){if(live(ticket))message(error.message);}finally{if(live(ticket))setBusy(false);}}
    const importCommand=(targets,label)=>({kind:'import',node:`op:${targets[0].graph}:${targets[0].node}`,nodes:targets.map(t=>`op:${t.graph}:${t.node}`),label:String(label||`片段 ${(draft?.state.groups?.length||0)+1}`).slice(0,80)});
    $('edit-add-selection').onclick=()=>snapshot?.composition?extend(getCompositionTargets(),getCompositionLabel()):extend(getTargets());
    $('edit-template').onchange=()=>{if($('edit-template').value)apply({kind:'template',node:selected,template:$('edit-template').value});};
    $('edit-draft-file').onchange=async()=>{const file=$('edit-draft-file').files[0];$('edit-draft-file').value='';if(!file)return;try{if(file.size>EDIT_DRAFT_LIMIT)throw Error('編輯草稿不得超過 256 KiB。');const candidate=parseEditSession(await file.text());if(candidate.source.format!=='tflite')throw Error('模型編輯草稿僅支援 TFLite，不會套用 MLIR 編輯草稿。');pendingDraft=candidate;pendingRecoveryRecord=null;banner(`請重新選取原模型「${pendingDraft.source.name}」。會核對完整檔案指紋，模型／權重不在草稿內。`);}catch(e){pendingDraft=null;banner(e.message);}};
    $('choose-edit-draft-model').onclick=chooseModel;
    $('cancel-edit-draft').onclick=()=>{pendingDraft=null;pendingRecoveryRecord=null;$('edit-draft-banner').hidden=true;if(draftTask){generation++;draftTask=false;rpc('editDraftCancel').catch(()=>{});setBusy(false);message('已取消草稿核對，保留原有編輯。');}};
    $('save-edit-draft').onclick=async()=>{
        if(busy||!draft)return;const ticket=generation,stamp=historySignature(),history=draft.history,view={selected:selected??null,zoom,font:Number($('edit-font').value),left:viewport.scrollLeft,top:viewport.scrollTop};draftTask=true;setBusy(true);banner('正在本機核對完整原模型；大型檔案可能需要時間，可取消。');
        try{const document=await rpc('editDraftSave',{token:snapshot.token,history,view,options:{updateSignatures:$('edit-signatures').checked}});if(!live(ticket))return;await saveFile(owner.name.replace(/\.[^.]+$/,'')+'-edit-draft.json',new Blob([exportEditSession(document)],{type:'application/json'}));if(!live(ticket))return;savedDraft=stamp;message('編輯草稿已開始下載；換電腦後匯入此 JSON，再選原模型即可繼續。');$('edit-draft-banner').hidden=true;}catch(e){if(live(ticket))banner(e.message);}finally{if(live(ticket)){draftTask=false;setBusy(false);}}
    };
    const checkedCurrent=()=>checked&&checked.owner===owner&&checked.token===snapshot?.token&&checked.stamp===signature();
    async function prepareCandidate(name){
        if(checkedCurrent()&&checked.candidate)return checked.candidate;
        if(snapshot.composition&&!changes().length)throw Error('組合草稿尚未加入任何 OP。');
        if(!changes().length)return rpc('editRuntimeOriginal',{token:snapshot.token});
        const result=await rpc('editWorkspaceExport',{token:snapshot.token,commands:draft.commands,updateSignatures:$('edit-signatures').checked,outputName:name});
        if(!result.roundTrip)throw Error('候選尚未重新解析。');return result;
    }
    const outputName=()=>owner.name.replace(/(?:-edited|-composed)?\.[^.]+$/,'')+(snapshot.composition?'-composed.tflite':'-edited.tflite');
    $('edit-runtime-check').onclick=async()=>{
        if(busy||!draft)return;const ticket=generation,stamp=signature();let inputsDismissed=false;
        setBusy(true);message('為手動執行檢查建立候選模型…');
        try{const candidate=await prepareCandidate(outputName());if(!live(ticket))return;
            const specs=candidate.runtimePlan?.eligible?await runtimeInputs.choose(candidate.runtimePlan):[];if(!live(ticket))return;if(specs===null){inputsDismissed=true;return;}
            $('edit-runtime-cancel').hidden=false;
            let result;try{result=await runtime.check(candidate.blob,candidate.runtimePlan,message,specs);}finally{$('edit-runtime-cancel').hidden=true;}
            if(!live(ticket))return;
            const {io,...validation}=result;checked={owner,token:snapshot.token,stamp,validation,io,candidate:candidate.runtimePlan?.eligible&&!validation.cancelled?candidate:null};
            $('edit-runtime-result').textContent=[runtimeSummary(validation),validation.ioError||'',...(validation.diagnostics||[])].filter(Boolean).join('\n');$('edit-runtime-result').dataset.status=validation.status;
            message(runtimeSummary(validation)+' 草稿已保留，尚未下載模型。');
        }catch(error){if(live(ticket))message(error.message);}
        finally{if(live(ticket)){
            // Native dialog restoration runs while its opener is still disabled.
            setBusy(false);if(inputsDismissed)$('edit-runtime-check').focus({preventScroll:true});
        }}
    };
    $('edit-export').onclick=async()=>{
        if(busy||!draft||!changes().length)return;const ticket=generation,sourceFile=owner,stamp=signature(),name=outputName();
        setBusy(true);message('在本機建立整份候選、重新解析並驗證接線／控制流程…');
        try{const result=await prepareCandidate(name);if(!live(ticket))return;
            const validation=checkedCurrent()&&checked.candidate===result?checked.validation:runtimeSkipped('尚未對此匯出執行手動 LiteRT 檢查。');
            result.report=await attachRuntimeReport(result.report,validation);const token=await onExport(result,name,sourceFile);if(!live(ticket))return;exportedToken=token;exported=stamp;message('修改模型已開始下載；可開啟修改結果繼續編輯。結構驗證通過。'+runtimeSummary(validation));
        }catch(error){if(live(ticket))message([error.message,...(error.validation?.diagnostics||[]).slice(0,8).map(d=>`${d.code}: ${d.message}`)].join('\n'));}
        finally{if(live(ticket))setBusy(false);}
    };
    $('edit-open-result').onclick=openResult;$('edit-download-report').onclick=downloadReport;
    $('edit-runtime-cancel').onclick=()=>runtime.cancel();
    $('edit-runtime-download').onclick=()=>{if(!busy&&checkedCurrent()&&checked.io?.archive)return saveFile(owner.name.replace(/\.[^.]+$/,'')+'-runtime-io.zip',checked.io.archive);};
    $('edit-signatures').onchange=()=>{checked=null;$('edit-runtime-result').textContent='選項已變更，尚未檢查';availability();message('Signature 選項已變更，請重新驗證並匯出。');};
    async function switchEditor(composition){
        if(busy)return false;const stash={...parked};
        if(owner===getSource()&&draft){const saved=api.captureTab();delete saved.sessions;saved.dirty=currentDirty();stash[snapshot.composition?'composition':'edit']=saved;setBusy(true);try{await recovery.park();}finally{setBusy(false);}}
        const previous=stash[composition?'composition':'edit'];delete stash[composition?'composition':'edit'];api.reset();parked=stash;
        if(previous)await api.restoreTab({...previous,sessions:stash});return true;
    }
    $('explore-mode').onclick=()=>mode(false);
    $('edit-mode').onclick=()=>{if(snapshot?.composition&&owner===getSource())mode(true);else api.open().catch(e=>message(e.message));};
    for(const id of ['compose-mode','compose-capture'])$(id).onclick=()=>api.composeSelection().catch(e=>banner(e.message));
    $('edit-session').onchange=async()=>{try{if($('edit-session').value==='edit')await api.open();else if(await switchEditor(true))mode(true);}catch(e){message(e.message);}finally{availability();}};
    const restartDialog=$('edit-restart-dialog');
    $('edit-restart').onclick=()=>{if(busy||!draft)return;$('edit-restart-description').textContent=`${snapshot.composition?'片段組合':'原模型編輯'} · ${draft.state.nodes.length} 個 OP · ${draft.history.commands.length} 筆命令／${draft.history.redo.length} 筆重做。`;restartDialog.showModal();};
    $('edit-restart-cancel').onclick=()=>restartDialog.close();restartDialog.addEventListener('keydown',e=>e.stopPropagation());
    $('edit-restart-confirm').onclick=async()=>{if(busy||!draft)return;const stash={...parked};setBusy(true);try{await recovery.park();restartDialog.close();api.reset();parked=stash;availability();banner('目前草稿已重置。請在探索圖重新選取 OP，再編輯或加入組合草稿；已保存的備份可從「編輯草稿」找回。');}catch(e){message(e.message);setBusy(false);}};
    resizeInFrame(document.querySelector('.app-header'),()=>{const h=document.querySelector('.app-header').offsetHeight;root.style.setProperty('--edit-head',`${h}px`);$('edit-draft-banner').style.top=`${h+8}px`;schedule();});
    window.addEventListener('beforeunload',e=>{if(api.hasUnexported){e.preventDefault();e.returnValue='';}});
    const api={
        get active(){return active;},get hasUnexported(){return currentDirty()||Object.values(parked).some(s=>s?.dirty);},
        captureTab(){
            if(busy)throw Error('請等待編輯、匯出或草稿核對完成後再切換分頁。');
            if(!snapshot||!draft)return null;
            return {...structuredClone({targets:snapshot.nodes.map(n=>n.source),selectedScope:snapshot.selected,history:draft.history,selected:selected??null,armed,active,dirty:api.hasUnexported,zoom,font:$('edit-font').value,left:viewport.scrollLeft,top:viewport.scrollTop,pages:[...pages],exported,savedDraft,updateSignatures:$('edit-signatures').checked,composition:!!snapshot.composition}),sessions:{...parked},recovery:recovery.binding};
        },
        async restoreTab(state){
            if(!state)return;if(!supportsModelEditing(getFormat()))throw Error(TFLITE_EDIT_MESSAGE);
            parked=state.sessions||{};
            owner=getSource();const ticket=++generation;setBusy(true);
            try{const next=await rpc('editWorkspaceOpen',{targets:state.targets,includeNeighbours:false,composition:!!state.composition});if(!live(ticket))return;next.selected=state.selectedScope;const restored=modelEditDraft(next,state.history.commands,state.history.redo);snapshot=next;draft=restored;selected=state.selected;armed=state.armed;zoom=state.zoom;pages=new Map(state.pages);exported=state.exported;exportedToken=null;savedDraft=state.savedDraft;$('edit-font').value=state.font;root.style.setProperty('--edit-font',`${state.font}px`);$('edit-signatures').checked=state.updateSignatures;recovery.attach(state.recovery);mode(state.active);render();await new Promise(resolve=>requestAnimationFrame(resolve));if(!live(ticket))return;if(state.active)layout();viewport.scrollLeft=state.left;viewport.scrollTop=state.top;message('已恢復此分頁的編輯草稿、接線、復原／重做與視角。');}
            finally{if(live(ticket))setBusy(false);}
        },
        progress(text){if(draftTask){message(text);banner(text);}},
        async restorePending(){
            if(!pendingDraft||!getSource()||busy)return;const document=pendingDraft;owner=getSource();const ticket=++generation;draftTask=true;setBusy(true);banner('正在本機核對原模型與草稿；尚未套用變更。');
            try{const restored=await rpc('editDraftRestore',{document});if(!live(ticket)||pendingDraft!==document)return;const next=modelEditDraft(restored.snapshot,restored.saved.history.commands,restored.saved.history.redo);snapshot=restored.snapshot;draft=next;selected=restored.saved.view.selected;zoom=restored.saved.view.zoom;$('edit-font').value=String(restored.saved.view.font);root.style.setProperty('--edit-font',`${$('edit-font').value}px`);$('edit-signatures').checked=restored.saved.options.updateSignatures;exported='';exportedToken=null;pages.clear();savedDraft=pendingRecoveryRecord?'':historySignature();recovery.attach(pendingRecoveryRecord);pendingRecoveryRecord=null;pendingDraft=null;$('edit-draft-banner').hidden=true;mode(true);render();await new Promise(resolve=>requestAnimationFrame(resolve));if(!live(ticket))return;viewport.scrollLeft=restored.saved.view.left;viewport.scrollTop=restored.saved.view.top;message('已核對完整原模型並恢復草稿、接線、復原／重做與視角，可繼續編輯。');}catch(e){if(live(ticket))banner(e.message+' 請重新選取原模型。');}finally{if(live(ticket)){draftTask=false;setBusy(false);}}
        },
        advancedLocation(){const n=draft?.state.nodes.find(n=>n.id===selected);return n&&!n.fresh&&!n.removed&&!changes().length?n.source:null;},
        handleKey(e){if(e.defaultPrevented||e.isComposing||e.altKey)return false;const input=e.target.closest?.('input,textarea,select,[contenteditable="true"]');if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==='z'&&!input){e.preventDefault();e.stopPropagation();travel(e.shiftKey);return true;}if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==='f'){e.preventDefault();e.stopPropagation();$('edit-find').focus();return true;}if(e.key==='Escape'&&armed){e.preventDefault();source(armed);return true;}return false;},
        selectionChanged(){availability();},
        enable(value){$('edit-mode').disabled=!value;for(const id of ['compose-mode','compose-capture'])$(id).disabled=!value||!getCompositionTargets().length;},
        reset(){runtime.cancel();runtimeInputs.cancel();checked=null;$('edit-runtime-cancel').hidden=true;$('edit-runtime-download').disabled=true;$('edit-runtime-result').textContent='尚未執行';recovery.detach();generation++;endGesture();if(frame){cancelAnimationFrame(frame);frame=0;}mode(false);owner=null;snapshot=null;draft=null;parked={};selected=null;armed=null;exported='';exportedToken=null;savedDraft='';draftTask=false;newOps.reset();$('edit-signatures').checked=false;pages.clear();world.querySelectorAll('.edit-node,.edit-boundary,.edit-block-label').forEach(n=>n.remove());svg.replaceChildren();$('edit-node-details').replaceChildren();$('edit-change-list').replaceChildren();busy=false;onBusy(false);$('edit-mode').disabled=true;availability();},
        async open(){
            if(!supportsModelEditing(getFormat())){message(TFLITE_EDIT_MESSAGE);return;}
            if((snapshot?.composition||!snapshot&&parked.edit)&&!await switchEditor(false))return;
            if(!getSource())return;if(owner===getSource()&&draft){mode(true);const missing=getTargets().filter(t=>!snapshot.nodes.some(n=>n.source.graph===t.graph&&n.source.node===t.node));if(missing.length)await extend(missing);return;}
            owner=getSource();const ticket=++generation;mode(true);root.scrollTo(0,0);setBusy(true);message('載入編輯範圍（模型與權重保留本機）…');
            try{const next=await rpc('editWorkspaceOpen',{targets:getTargets(),graph:getGraph()});if(!live(ticket))return;snapshot=next;draft=modelEditDraft(next);recovery.attach();selected=next.selected[0];pages.clear();zoom=1;exported='';$('edit-font').value=$('graph-font-size').value;root.style.setProperty('--edit-font',`${$('edit-font').value}px`);render();message('點來源輸出端，再點目標輸入端接線。藍色虛線是保留的控制流程；新增輸出自動建立。');requestAnimationFrame(()=>$('edit-fit').click());}
            catch(error){if(live(ticket))message(error.message);}finally{if(live(ticket))setBusy(false);}
        },
        async composeSelection(){
            if(busy||!getSource()||!supportsModelEditing(getFormat()))return;
            const targets=getCompositionTargets();
            if(!targets.length&&!snapshot?.composition&&!parked.composition){banner('請先在原始圖圈選 OP，或點選一筆 pattern 匹配結果，再加入組合草稿。');return;}
            if((snapshot&&!snapshot.composition||!snapshot&&parked.composition)&&!await switchEditor(true))return;
            if(snapshot?.composition){mode(true);if(targets.length)await extend(targets,getCompositionLabel());return;}
            if(!targets.length)return;owner=getSource();const ticket=++generation;mode(true);setBusy(true);
            try{const next=await rpc('editWorkspaceOpen',{targets,composition:true});if(!live(ticket))return;const nextDraft=modelEditDraft(next,[importCommand(targets,getCompositionLabel())]);snapshot=next;draft=nextDraft;selected=draft.state.nodes[0]?.id||null;armed=null;pages.clear();zoom=1;recovery.attach();$('edit-font').value=$('graph-font-size').value;root.style.setProperty('--edit-font',`${$('edit-font').value}px`);render();message('片段已加入獨立組合草稿。可返回探索加入下一個片段，再新增 OP 接線；原模型保留。');requestAnimationFrame(()=>$('edit-fit').click());}
            catch(error){if(live(ticket))banner(error.message);}finally{if(live(ticket))setBusy(false);}
        }
    };return api;
}
