import {modelEditDraft,editChanges,editIssues,editWireReason,editPosition} from './model-edit-draft.js';
const NS='http://www.w3.org/2000/svg';
export function modelEditWorkspaceUI({rpc,getSource,getTargets,getGraph,onBusy,onExport,openResult,downloadReport}){
    const $=id=>document.getElementById(id),root=$('edit-workspace'),viewport=$('edit-viewport'),world=$('edit-world'),svg=$('edit-links');
    let owner=null,snapshot=null,draft=null,active=false,busy=false,generation=0,selected=null,armed=null,zoom=1,exported='',pages=new Map(),frame=0,gesture=null,exploreScroll=null;
    const make=(tag,text,cls)=>{const e=document.createElement(tag);if(text!==undefined)e.textContent=text;if(cls)e.className=cls;return e;};
    const message=text=>{$('edit-message').textContent=text;};
    const live=ticket=>ticket===generation&&owner===getSource();
    const changes=()=>draft?editChanges(snapshot,draft.state):[];
    const mode=value=>{
        if(value===active)return;
        if(value){const t=$('target'),p=document.scrollingElement;exploreScroll={left:t.scrollLeft,top:t.scrollTop,x:p.scrollLeft,y:p.scrollTop};}
        active=value;root.hidden=!value;document.body.classList.toggle('editing-model',value);
        $('explore-mode').setAttribute('aria-pressed',String(!value));$('edit-mode').setAttribute('aria-pressed',String(value));
        if(!value&&exploreScroll)requestAnimationFrame(()=>{$('target').scrollTo({left:exploreScroll.left,top:exploreScroll.top,behavior:'instant'});document.scrollingElement.scrollTo({left:exploreScroll.x,top:exploreScroll.y,behavior:'instant'});});
        if(value)schedule();
    };
    function availability(){
        const valid=!!draft,dirty=changes().length>0;
        for(const id of ['edit-add-before','edit-add-after','edit-delete','edit-restore','edit-clear','edit-add-selection','edit-undo','edit-redo','edit-export'])$(id).disabled=busy||!valid;
        $('edit-undo').disabled=busy||!draft?.canUndo;$('edit-redo').disabled=busy||!draft?.canRedo;$('edit-clear').disabled=busy||!dirty;
        const node=draft?.state.nodes.find(n=>n.id===selected);
        $('edit-add-before').disabled=$('edit-add-after').disabled=busy||!node?.cloneable||!!node?.removed;
        $('edit-delete').disabled=busy||!node?.removable||!!node?.removed;$('edit-restore').hidden=!node?.removed;
        $('edit-export').disabled=busy||!dirty||!!draft&&editIssues(draft.state).length>0;
        $('edit-advanced').disabled=busy||!node||node.fresh||node.removed||dirty;
        $('edit-open-result').disabled=busy||!exported||exported!==JSON.stringify(draft?.commands);
        $('edit-download-report').disabled=$('edit-open-result').disabled;
        $('edit-signatures-field').hidden=!snapshot?.hasSignatures;
        root.setAttribute('aria-busy',String(busy));
    }
    const setBusy=value=>{busy=value;onBusy(value);availability();};
    function apply(command){if(busy||!draft)return;try{draft.apply(command);if(command.kind==='clone')selected=draft.state.nodes.find(n=>n.serial===draft.state.next).id;armed=null;render();message('草稿已更新；請查看變更預覽，驗證後才會寫出新模型。');}catch(error){message(error.message);}}
    function source(value){armed=armed===value?null:value;const v=draft.state.values.get(value);message(armed?`已選來源 ${v.name}；再點目標輸入端。綠框可接線，紅框請查看原因；也可拖曳來源端到輸入端。`:'已取消接線。');for(const b of world.querySelectorAll('[data-edit-output]'))b.classList.toggle('armed',b.dataset.editOutput===armed);for(const b of world.querySelectorAll('[data-edit-input]')){const reason=armed?editWireReason(draft.state,b.dataset.editInput,Number(b.dataset.editSlot),armed):'';b.classList.toggle('wire-compatible',!!armed&&!reason);b.classList.toggle('wire-incompatible',!!armed&&!!reason);if(armed)b.title=reason||'型別相容，可接線；完整 SSA／控制流程於匯出驗證。';}}
    const portPage=node=>pages.get(node.id)||0;
    function card(node){
        const card=make('article',undefined,`edit-node${node.fresh?' added':''}${node.removed?' removed':''}${node.id===selected?' selected':''}`);card.dataset.editNode=node.id;
        const title=make('button',node.name,'edit-node-title');title.type='button';title.title=node.name;title.onclick=()=>{selected=node.id;renderInspector();availability();for(const e of world.querySelectorAll('[data-edit-node]'))e.classList.toggle('selected',e.dataset.editNode===selected);draw();};card.append(title);
        card.append(make('small',`${node.fresh?'新增 OP':`OP #${node.source.node}`} · block/subgraph ${node.source.graph}`));
        const row=make('div',undefined,'edit-port-columns'),ins=make('div'),outs=make('div'),page=portPage(node),size=8;
        ins.append(make('strong','輸入'));outs.append(make('strong',node.fresh?'輸出（自動建立）':'輸出'));
        node.inputs.slice(page*size,(page+1)*size).forEach((port,i)=>{const slot=page*size+i,v=draft.state.values.get(port.value),button=make('button',`${slot+1} · ${v?.name||'缺少來源'}`,'edit-port input');button.type='button';button.title=`${v?.name||''} · ${port.type}`;button.dataset.editInput=node.id;button.dataset.editSlot=String(slot);button.disabled=node.removed;
            button.onclick=()=>{selected=node.id;if(armed)apply({kind:'wire',node:node.id,slot,value:armed});else {renderInspector();message(`先點來源輸出端，再點 ${node.name} 的輸入 ${slot+1}。`);}};ins.append(button);});
        node.outputs.slice(page*size,(page+1)*size).forEach((port,i)=>{const v=draft.state.values.get(port.value),button=make('button',`${page*size+i+1} · ${v.name}`,'edit-port output');button.type='button';button.title=`${v.name} · ${v.type}`;button.dataset.editOutput=port.value;button.disabled=node.removed&&!node.boundary;button.onclick=()=>source(port.value);outs.append(button);});row.append(ins,outs);card.append(row);
        const count=Math.max(node.inputs.length,node.outputs.length),nav=make('div',undefined,'edit-port-nav');if(count>size){for(const [label,offset] of [['上一頁',-1],['下一頁',1]]){const b=make('button',label,'text-button');b.disabled=page+offset<0||(page+offset)*size>=count;b.onclick=()=>{pages.set(node.id,page+offset);render();};nav.append(b);}nav.append(make('small',`${page+1}／${Math.ceil(count/size)} 頁`));}card.append(nav);return card;
    }
    function renderInspector(){
        const node=draft?.state.nodes.find(n=>n.id===selected),body=$('edit-node-details');body.replaceChildren();if(node){body.append(make('h3',node.name),make('p',`${node.block} · ${node.fresh?'新增 OP':`OP #${node.source.node}`}`));
            for(const side of ['inputs','outputs']){const list=make('ul');for(const [i,p] of node[side].entries()){if(i>=32){list.append(make('li',`另有 ${node[side].length-32} 個 ports，可在圖上分頁查看。`));break;}const v=draft.state.values.get(p.value);list.append(make('li',`${side==='inputs'?'輸入':'輸出'} ${i+1}：${v?.name||''} · ${p.type||v?.type||''}`));}body.append(list);}
        }
        $('edit-boundary-field').hidden=!node||snapshot.format!=='tflite'||node.fresh;$('edit-boundary').checked=!!node?.boundary;
        $('edit-expose-field').hidden=!node?.fresh||snapshot.format!=='tflite';$('edit-expose').checked=!!node?.exposed;
        const list=$('edit-change-list');list.replaceChildren();const diff=changes();$('edit-change-count').textContent=`${diff.length} 筆變更 · 尚未套用到原模型`;
        for(const c of diff){const row=make('li');row.append(make('strong',`${c.kind==='add'?'新增':c.kind==='remove'?'刪除':'改線'} · ${c.name}`));row.append(make('p',c.kind==='wire'?`輸入 ${c.slot+1}：${c.before} → ${c.after}`:c.kind==='add'?`輸入：${c.inputs.join('、')}；自動輸出：${c.outputs.join('、')}${c.exposed?'；加入模型 outputs':''}`:c.boundary?'仍被使用的輸出保留成模型 inputs':'仍被使用的輸出需重新接線'));list.append(row);}
        for(const issue of draft?editIssues(draft.state).slice(0,8):[])list.append(make('li',`${issue.node} 輸入 ${issue.slot+1}：${issue.message}`,'edit-problem'));
        availability();
    }
    function render(){
        if(!draft)return;world.querySelectorAll('.edit-node,.edit-boundary,.edit-block-label').forEach(e=>e.remove());
        const state=draft.state;
        for(const node of state.nodes)world.append(card(node));
        const producers=new Set(state.nodes.filter(n=>!n.removed||n.boundary).map(n=>n.id)),used=new Set(state.nodes.filter(n=>!n.removed).flatMap(n=>n.inputs.map(p=>p.value)));
        for(const id of used){const v=state.values.get(id);if(v.optional||producers.has(v.producer))continue;const box=make('article',undefined,'edit-boundary');box.dataset.editBoundary=id;const button=make('button',v.name,'edit-port output');button.title=`${v.kind} · ${v.type}`;button.dataset.editOutput=id;button.onclick=()=>source(id);box.append(make('small',v.kind),button,make('small',v.type));world.append(box);}
        $('edit-scope').textContent=`原模型 ${snapshot.total.toLocaleString()} 個 OP · 編輯範圍 ${snapshot.nodes.length} 個原始 OP＋${state.nodes.filter(n=>n.fresh&&!n.removed).length} 個新增 OP`;
        renderInspector();schedule();
    }
    function schedule(){if(frame)return;frame=requestAnimationFrame(()=>{frame=0;if(!active||!draft)return;layout();});}
    function layout(){
        const state=draft.state,font=Number($('edit-font').value),width=Math.round(310*Math.sqrt(font/14)),groups=[...new Set(state.nodes.map(n=>n.source.graph))].sort((a,b)=>a-b),cards=new Map([...world.querySelectorAll('[data-edit-node]')].map(e=>[e.dataset.editNode,e]));
        let boundaryY=50;for(const e of world.querySelectorAll('.edit-boundary')){e.style.width=`${width}px`;e.style.left='24px';e.style.top=`${boundaryY}px`;boundaryY+=e.offsetHeight+24;}
        let height=Math.max(boundaryY,400);world.querySelectorAll('.edit-block-label').forEach(e=>e.remove());
        for(const [column,graph] of groups.entries()){let y=54;const x=width+120+column*(width+120),label=make('div',`block/subgraph ${graph}`,'edit-block-label');label.dataset.editBlock=String(graph);label.style.left=`${x}px`;label.style.top='12px';world.append(label);
            for(const node of state.nodes.filter(n=>n.source.graph===graph).sort((a,b)=>editPosition(state,a)-editPosition(state,b))){const e=cards.get(node.id);e.style.width=`${width}px`;e.style.left=`${x}px`;e.style.top=`${y}px`;y+=e.offsetHeight+56;}height=Math.max(height,y+40);}
        const worldWidth=(groups.length+1)*(width+120)+80;world.style.width=`${worldWidth}px`;world.style.height=`${height}px`;svg.setAttribute('width',String(worldWidth));svg.setAttribute('height',String(height));svg.setAttribute('viewBox',`0 0 ${worldWidth} ${height}`);scale();draw();
    }
    function scale(){world.style.transform=`scale(${zoom})`;$('edit-spacer').style.width=`${world.offsetWidth*zoom}px`;$('edit-spacer').style.height=`${world.offsetHeight*zoom}px`;$('edit-zoom-value').textContent=`${Math.round(zoom*100)}%`;}
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
    function upGesture(e){if(!gesture||e.pointerId!==gesture.id)return;const g=gesture;endGesture();if(g.value&&g.moved){const input=document.elementFromPoint(e.clientX,e.clientY)?.closest('[data-edit-input]');if(input)apply({kind:'wire',node:input.dataset.editInput,slot:Number(input.dataset.editSlot),value:g.value});else message('未接到輸入端，草稿未改變。');e.preventDefault();e.stopImmediatePropagation();}}
    viewport.addEventListener('pointerdown',e=>{if(busy||e.button!==0&&e.button!==1)return;const output=!e.altKey&&e.button===0?e.target.closest('[data-edit-output]'):null,pan=e.altKey||e.button===1||!e.target.closest('button,.edit-node,.edit-boundary');if(!output&&!pan)return;gesture={id:e.pointerId,x:e.clientX,y:e.clientY,left:viewport.scrollLeft,top:viewport.scrollTop,pan:!output,value:output?.dataset.editOutput,moved:false};document.addEventListener('pointermove',moveGesture,true);document.addEventListener('pointerup',upGesture,true);document.addEventListener('pointercancel',endGesture,true);if(pan)e.preventDefault();});
    $('edit-add-before').onclick=()=>apply({kind:'clone',node:selected,side:'before'});$('edit-add-after').onclick=()=>apply({kind:'clone',node:selected,side:'after'});
    $('edit-delete').onclick=()=>apply({kind:'remove',node:selected,boundary:$('edit-boundary').checked});$('edit-restore').onclick=()=>apply({kind:'restore',node:selected});
    $('edit-expose').onchange=()=>apply({kind:'expose',node:selected,enabled:$('edit-expose').checked});$('edit-boundary').onchange=()=>{const n=draft?.state.nodes.find(n=>n.id===selected);if(n?.removed)apply({kind:'remove',node:selected,boundary:$('edit-boundary').checked});};
    const travel=redo=>{if(!busy&&draft){draft[redo?'redo':'undo']();armed=null;if(!draft.state.nodes.some(n=>n.id===selected))selected=draft.state.nodes[0]?.id;render();}};
    $('edit-undo').onclick=()=>travel(false);$('edit-redo').onclick=()=>travel(true);$('edit-clear').onclick=()=>{if(!busy&&draft){draft.clear();armed=null;selected=snapshot.selected[0];render();message('草稿已清除，原模型保持不變。');}};
    $('edit-zoom-in').onclick=()=>{zoom=Math.min(2,zoom*1.25);scale();};$('edit-zoom-out').onclick=()=>{zoom=Math.max(.15,zoom/1.25);scale();};$('edit-fit').onclick=()=>{zoom=Math.max(.15,Math.min(1,viewport.clientWidth/world.offsetWidth,viewport.clientHeight/world.offsetHeight));scale();viewport.scrollTo(0,0);};
    $('edit-font').onchange=()=>{root.style.setProperty('--edit-font',`${$('edit-font').value}px`);schedule();};
    $('edit-find').oninput=()=>{const q=$('edit-find').value.toLowerCase();for(const e of world.querySelectorAll('[data-edit-node]'))e.classList.toggle('find-hit',!!q&&e.textContent.toLowerCase().includes(q));};
    async function extend(targets){if(busy||!draft)return;if(!targets.length){message('請回探索模型選取要加入的 OP；原草稿會保留。');return;}const ticket=generation,commands=draft.commands;setBusy(true);try{const next=await rpc('editWorkspaceExtend',{token:snapshot.token,targets,commands});if(!live(ticket))return;snapshot=next;draft=modelEditDraft(next,commands);render();message('已加入探索選取，保留原有草稿。');}catch(error){if(live(ticket))message(error.message);}finally{if(live(ticket))setBusy(false);}}
    $('edit-add-selection').onclick=()=>extend(getTargets());
    $('edit-export').onclick=async()=>{
        if(busy||!draft||!changes().length)return;const ticket=generation,sourceFile=owner,commands=draft.commands,signature=JSON.stringify(commands),name=sourceFile.name.replace(/(?:-edited)?\.[^.]+$/,'')+`-edited.${snapshot.format==='mlir'?'mlir':'tflite'}`;
        setBusy(true);message('在本機建立整份候選、重新解析並驗證接線／SSA／控制流程…');
        try{const result=await rpc('editWorkspaceExport',{token:snapshot.token,commands,updateSignatures:$('edit-signatures').checked,outputName:name});if(!live(ticket))return;if(!result.roundTrip)throw Error('候選尚未重新解析。');await onExport(result,name,sourceFile);if(!live(ticket))return;exported=signature;message('修改模型已開始下載；可開啟修改結果繼續編輯。結構驗證通過，未執行推論或公司 verifier。');}
        catch(error){if(live(ticket))message([error.message,...(error.validation?.diagnostics||[]).slice(0,8).map(d=>`${d.code}: ${d.message}`)].join('\n'));}
        finally{if(live(ticket))setBusy(false);}
    };
    $('edit-open-result').onclick=openResult;$('edit-download-report').onclick=downloadReport;
    $('explore-mode').onclick=()=>mode(false);$('edit-mode').onclick=()=>api.open();
    new ResizeObserver(()=>{root.style.setProperty('--edit-head',`${document.querySelector('.app-header').offsetHeight}px`);schedule();}).observe(document.querySelector('.app-header'));
    window.addEventListener('beforeunload',e=>{if(api.hasUnexported){e.preventDefault();e.returnValue='';}});
    const api={
        get active(){return active;},get hasUnexported(){return !!draft&&changes().length>0&&exported!==JSON.stringify(draft.commands);},
        advancedLocation(){const n=draft?.state.nodes.find(n=>n.id===selected);return n&&!n.fresh&&!n.removed&&!changes().length?n.source:null;},
        handleKey(e){if(e.defaultPrevented||e.isComposing||e.altKey)return false;const input=e.target.closest?.('input,textarea,select,[contenteditable="true"]');if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==='z'&&!input){e.preventDefault();e.stopPropagation();travel(e.shiftKey);return true;}if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==='f'){e.preventDefault();e.stopPropagation();$('edit-find').focus();return true;}if(e.key==='Escape'&&armed){e.preventDefault();armed=null;message('已取消接線。');return true;}return false;},
        enable(value){$('edit-mode').disabled=!value;},
        reset(){generation++;endGesture();if(frame){cancelAnimationFrame(frame);frame=0;}mode(false);owner=null;snapshot=null;draft=null;selected=null;armed=null;exported='';pages.clear();world.querySelectorAll('.edit-node,.edit-boundary,.edit-block-label').forEach(n=>n.remove());svg.replaceChildren();$('edit-node-details').replaceChildren();$('edit-change-list').replaceChildren();busy=false;$('edit-mode').disabled=true;},
        async open(){
            if(!getSource())return;if(owner===getSource()&&draft){mode(true);return;}
            owner=getSource();const ticket=++generation;mode(true);root.scrollTo(0,0);setBusy(true);message('載入編輯範圍（模型與權重保留本機）…');
            try{const next=await rpc('editWorkspaceOpen',{targets:getTargets(),graph:getGraph()});if(!live(ticket))return;snapshot=next;draft=modelEditDraft(next);selected=next.selected[0];pages.clear();zoom=1;exported='';$('edit-font').value=$('graph-font-size').value;root.style.setProperty('--edit-font',`${$('edit-font').value}px`);render();message('點來源輸出端，再點目標輸入端接線。藍色虛線是保留的控制流程；新增輸出自動建立。');requestAnimationFrame(()=>$('edit-fit').click());}
            catch(error){if(live(ticket))message(error.message);}finally{if(live(ticket))setBusy(false);}
        }
    };return api;
}
