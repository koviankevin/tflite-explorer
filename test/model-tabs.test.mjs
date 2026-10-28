import test from 'node:test';
import assert from 'node:assert/strict';
import {modelTabs} from '../src/model-tabs.js';
function fixture(){
    let displayed=null,ui,view={workspace:{query:'',selected:[]},edit:null},allowed=true,fail=null,workers=0,closed=0;const errors=[],loads=[];
    const tabs=modelTabs({capture:async()=>structuredClone(view),load:async(file,saved)=>{if(displayed)closed++;displayed=file;workers++;loads.push(file);if(file===fail)return false;view=saved?structuredClone(saved):{workspace:{query:'',selected:[]},edit:null};return true;},reset:()=>{if(displayed)closed++;displayed=null;},dirty:()=>!!view.edit?.dirty,confirmClose:()=>allowed,changed:state=>{ui=state;},error:e=>errors.push(e.message)});
    return {tabs,errors,loads,get ui(){return ui;},get displayed(){return displayed;},get view(){return view;},set allowed(v){allowed=v;},set fail(v){fail=v;},get liveWorkers(){return workers-closed;}};
}
test('local source and exported child tabs restore independent selection, camera, query and edit history without holding parsed models',async()=>{
    const f=fixture(),source={name:'source.tflite'},child={name:'child.tflite'};await f.tabs.open(source);Object.assign(f.view.workspace,{query:'Custom',selected:[2,3],camera:{zoom:.4,left:71}});f.view.edit={dirty:true,history:{commands:[{kind:'wire'}],redo:[]}};
    await f.tabs.open(child);assert.equal(f.tabs.hasUnexported,true);f.view.workspace.query='Transpose';assert.equal(f.ui.tabs.length,2);assert.equal(f.liveWorkers,1);
    await f.tabs.activate(1);assert.equal(f.displayed,source);assert.deepEqual(f.view.workspace,{query:'Custom',selected:[2,3],camera:{zoom:.4,left:71}});assert.deepEqual(f.view.edit.history.commands,[{kind:'wire'}]);assert.equal(f.liveWorkers,1);
    await f.tabs.activate(2);assert.equal(f.view.workspace.query,'Transpose');assert.equal(f.liveWorkers,1);f.allowed=false;assert.equal(f.tabs.closeAll(),false);assert.equal(f.ui.tabs.length,2);f.allowed=true;assert.equal(f.tabs.closeAll(),true);assert.equal(f.liveWorkers,0);assert.equal(f.ui.tabs.length,0);
});
test('failed child load restores its original File and state and does not leave a phantom tab',async()=>{
    const f=fixture(),source={name:'original'},bad={name:'bad'};await f.tabs.open(source);f.view.workspace.query='preserved';f.fail=bad;assert.equal(await f.tabs.open(bad),false);assert.equal(f.displayed,source);assert.equal(f.view.workspace.query,'preserved');assert.equal(f.ui.tabs.length,1);assert.equal(f.liveWorkers,1);assert.equal(f.errors.length,1);
});
test('close one tab guards unexported drafts and selects an existing neighbour',async()=>{
    const f=fixture();await f.tabs.open({name:'first'});await f.tabs.open({name:'second'});f.view.edit={dirty:true};f.allowed=false;assert.equal(await f.tabs.close(2),false);f.allowed=true;assert.equal(await f.tabs.close(2),true);assert.equal(f.displayed.name,'first');assert.equal(f.ui.tabs.length,1);assert.equal(await f.tabs.close(1),true);assert.equal(f.liveWorkers,0);
});
test('a snapshot failure leaves the current model and dirty draft intact',async()=>{
    let loads=0;const tabs=modelTabs({capture:()=>{throw Error('busy');},load:async()=>{loads++;return true;},reset:()=>assert.fail('must retain current'),dirty:()=>true,changed:()=>{},error:()=>{},confirmClose:()=>false});await tabs.open({name:'first'});assert.equal(await tabs.open({name:'second'}),false);assert.equal(loads,1);
});
test('cancelled child load restores the original and a late completion cannot replace it',async()=>{
    let finish,displayed,ui;const first={name:'first'},child={name:'child'},saved={workspace:{query:'keep'},edit:{dirty:true}};
    const tabs=modelTabs({capture:async()=>saved,load:async(file,state)=>{displayed=file;if(file===child)return new Promise(resolve=>{finish=resolve;});if(state)assert.equal(state.workspace.query,'keep');return true;},reset:()=>{displayed=null;},dirty:()=>false,changed:state=>{ui=state;},error:()=>assert.fail('cancellation must not report a load failure'),confirmClose:()=>false});
    await tabs.open(first);const loading=tabs.open(child);await new Promise(resolve=>setImmediate(resolve));assert.equal(ui.busy,true);assert.equal(await tabs.cancel(),true);assert.equal(displayed,first);finish(true);assert.equal(await loading,false);assert.equal(displayed,first);assert.equal(ui.tabs.length,1);assert.equal(ui.busy,false);
});
