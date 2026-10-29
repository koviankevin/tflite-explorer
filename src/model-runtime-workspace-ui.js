import {modelRuntimeSession} from './model-runtime-session.js';
import {runtimeClient} from './tflite-runtime-client.js';
import {runtimeInputsUI} from './tflite-runtime-inputs-ui.js';
import {runtimeSummary} from './tflite-runtime-policy.js';
import {runtimeIOBlob} from './runtime-io.js';

export function modelRuntimeWorkspaceUI({rpc,getSource,getFormat,leaveEditor,saveFile}){
    const $=id=>document.getElementById(id),root=$('run-workspace');let active=false;
    const session=modelRuntimeSession({getSource,getFormat,prepare:()=>rpc('modelRuntimeInfo'),runtime:runtimeClient(),inputs:runtimeInputsUI(),onChange:render});
    function render(){
        const {busy,plan,validation,io,message}=session.state;
        root.setAttribute('aria-busy',String(busy));$('edit-runtime-check').disabled=busy||getFormat()!=='tflite';
        $('edit-runtime-cancel').hidden=!busy;$('edit-runtime-download').disabled=busy||!io?.archive;
        $('run-model-name').textContent=getSource()?.name||'尚未開啟 TFLite';
        $('edit-runtime-result').textContent=[validation?runtimeSummary(validation):message||'尚未執行',validation?.ioError,...(validation?.diagnostics||[])].filter(Boolean).join('\n');
        if(validation)$('edit-runtime-result').dataset.status=validation.status;else delete $('edit-runtime-result').dataset.status;
        $('run-progress').textContent=busy?message:'';
        const body=$('run-interface');body.replaceChildren();
        if(plan){
            if(!plan.eligible){const p=document.createElement('p');p.textContent=plan.reason;body.append(p);}
            for(const side of ['inputs','outputs']){
                const heading=document.createElement('h3');heading.textContent=side==='inputs'?'模型輸入':'模型輸出';body.append(heading);
                for(const tensor of plan[side]){const p=document.createElement('p');p.textContent=`#${tensor.tensor} · ${tensor.name} · ${tensor.dtype} [${tensor.shape.join(', ')}]${tensor.quantized?' · 量化 tensor':''}`;body.append(p);}
            }
        }
    }
    function buttons(){const current=active?'run-mode':document.body.classList.contains('editing-model')?'edit-mode':'explore-mode';for(const id of ['explore-mode','edit-mode','run-mode'])$(id).setAttribute('aria-pressed',String(id===current));}
    const api={
        get active(){return active;},
        leave(){if(session.state.busy)session.cancel();active=false;root.hidden=true;document.body.classList.remove('running-model');buttons();},
        reset(){session.reset();api.leave();$('run-mode').disabled=true;render();},
        enable(value){$('run-mode').disabled=!value;$('run-mode').hidden=!value;},
        open(){if(getFormat()!=='tflite'||!getSource())return;leaveEditor();active=true;root.hidden=false;document.body.classList.add('running-model');buttons();render();session.inspect();}
    };
    $('run-mode').onclick=()=>api.open();
    $('edit-runtime-check').onclick=async()=>{await session.run();if(active&&!session.state.busy)$('edit-runtime-check').focus({preventScroll:true});};
    $('edit-runtime-cancel').onclick=()=>session.cancel();
    $('edit-runtime-download').onclick=()=>{const io=session.state.io;if(io?.archive&&!session.state.busy)return saveFile(getSource().name.replace(/\.[^.]+$/,'')+'-runtime-io.zip',runtimeIOBlob(io));};
    return api;
}
