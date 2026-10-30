import {GUIDE_TOPICS,GUIDE_ACTIONS,guideActionReason,guideTopicFor,guideTabIndex} from './usage-guide.js';

export function initUsageGuide({getContext,perform}){
    const $=id=>document.getElementById(id),dialog=$('usage-guide'),tabs=$('guide-topics'),content=$('guide-content'),status=$('guide-status');let topic='explore',observer=null;
    const make=(tag,text)=>{const e=document.createElement(tag);if(text!==undefined)e.textContent=text;return e;};
    function refreshActions(){
        const context=getContext(),notes=$('guide-reasons'),reasons=new Map();if(!notes)return;notes.replaceChildren();
        for(const button of content.querySelectorAll('[data-guide-action]')){
            const reason=guideActionReason(button.dataset.guideAction,context);button.disabled=!!reason;
            if(reason){if(!reasons.has(reason)){const p=make('p',reason);p.id=`guide-reason-${reasons.size}`;p.className='hint';notes.append(p);reasons.set(reason,p.id);}button.setAttribute('aria-describedby',reasons.get(reason));}else button.removeAttribute('aria-describedby');
        }
    }
    function watch(){observer?.disconnect();observer=new MutationObserver(refreshActions);for(const id of ['edit-workspace','run-workspace','model-tabs','target','results','loading-card'])observer.observe($(id),{attributes:true,attributeFilter:['aria-busy','hidden']});const startup=$('application-startup');if(startup)observer.observe(startup,{attributes:true,attributeFilter:['hidden']});}
    function render(){
        const page=GUIDE_TOPICS.find(t=>t.id===topic);
        for(const tab of tabs.querySelectorAll('button')){tab.setAttribute('aria-selected',String(tab.dataset.guideTopic===topic));tab.tabIndex=tab.dataset.guideTopic===topic?0:-1;}
        content.setAttribute('aria-labelledby',`guide-tab-${topic}`);content.replaceChildren(make('h3',page.heading));
        const list=make('ol');for(const [title,text]of page.steps){const row=make('li');row.append(make('strong',title),make('p',text));list.append(row);}content.append(list);
        const actions=make('div');actions.className='guide-actions';
        for(const action of page.actions){
            const button=make('button',GUIDE_ACTIONS[action]);button.type='button';button.className='quiet';button.dataset.guideAction=action;
            button.onclick=()=>{
                const latest=guideActionReason(action,getContext());if(latest){status.textContent=latest;refreshActions();$(`guide-tab-${topic}`).focus();return;}
                dialog.close();try{Promise.resolve(perform(action)).catch(error=>{status.textContent=error.message;if(!document.querySelector('dialog[open]')){dialog.showModal();render();watch();}});}catch(error){status.textContent=error.message;dialog.showModal();render();watch();}
            };actions.append(button);
        }
        const reasons=make('div');reasons.id='guide-reasons';content.insertBefore(actions,list);content.insertBefore(reasons,list);content.scrollTop=0;refreshActions();
    }
    function open(){
        if(document.querySelector('dialog[open]'))return;
        // A native file chooser may return focus to body or a closed dialog.
        // Give showModal a visible return target before moving focus inside it.
        const active=document.activeElement;if(!active||active===document.body||dialog.contains(active)||!active.getClientRects().length)$('usage-guide-button').focus({preventScroll:true});
        topic=guideTopicFor(getContext());status.textContent='';render();dialog.showModal();watch();$(`guide-tab-${topic}`).focus();
    }
    for(const page of GUIDE_TOPICS){const tab=make('button',page.label);tab.type='button';tab.id=`guide-tab-${page.id}`;tab.dataset.guideTopic=page.id;tab.setAttribute('role','tab');tab.setAttribute('aria-controls','guide-content');tab.onclick=()=>{topic=page.id;status.textContent='';render();};tabs.append(tab);}
    tabs.addEventListener('keydown',event=>{if(event.ctrlKey||event.metaKey||event.altKey)return;const items=[...tabs.querySelectorAll('button')],next=guideTabIndex(event.key,items.indexOf(event.target),items.length);if(next===null)return;event.preventDefault();items.forEach((b,i)=>{b.tabIndex=i===next?0:-1;});items[next].focus();});
    tabs.addEventListener('focusout',event=>{if(!tabs.contains(event.relatedTarget))for(const tab of tabs.querySelectorAll('button'))tab.tabIndex=tab.dataset.guideTopic===topic?0:-1;});
    for(const id of ['usage-guide-button','welcome-guide'])$(id).onclick=open;
    $('close-usage-guide').onclick=()=>dialog.close();
    dialog.addEventListener('close',()=>{if(!dialog.open){observer?.disconnect();observer=null;}});
    dialog.addEventListener('keydown',event=>{if(event.key==='F1')event.preventDefault();});
    document.addEventListener('keydown',event=>{if(event.defaultPrevented||event.isComposing||event.ctrlKey||event.metaKey||event.altKey||event.key!=='F1'||document.querySelector('dialog[open]'))return;event.preventDefault();open();},true);
    return {refresh(){if(dialog.open)refreshActions();}};
}
