import test from 'node:test';
import assert from 'node:assert/strict';
import {GUIDE_ACTIONS,GUIDE_TOPICS,guideActionReason,guideTopicFor,guideTabIndex} from '../src/usage-guide.js';

test('the guide offers a usable starting point without a model and explains unavailable workspaces',()=>{
    const context=Object.freeze({hasModel:false,format:null,busy:false});
    for(const action of ['open','demo','mlir-demo','drafts'])assert.equal(guideActionReason(action,context),'');
    for(const action of ['explore','edit','run'])assert.match(guideActionReason(action,context),/先開啟/);
});
test('MLIR cannot enter editing or inference through help; exploration and restore remain available',()=>{
    const context={hasModel:true,format:'mlir',busy:false};for(const action of ['edit','run'])assert.match(guideActionReason(action,context),/僅支援 TFLite/);for(const action of ['explore','open','drafts'])assert.equal(guideActionReason(action,context),'');
    for(const action of Object.keys(GUIDE_ACTIONS))assert.equal(guideActionReason(action,{...context,format:'tflite'}),'');
});
test('a background operation blocks every navigation action and a fresh state releases the guard',()=>{
    for(const action of Object.keys(GUIDE_ACTIONS)){const context={hasModel:true,format:'tflite',busy:true};assert.match(guideActionReason(action,context),/操作進行中/);context.busy=false;assert.equal(guideActionReason(action,context),'');}
    for(const action of ['constructor','__proto__','execute','export'])assert.throws(()=>guideActionReason(action,{hasModel:true,format:'tflite'}),/不存在/);
});
test('opening help chooses the current workspace without modifying its state',()=>{
    for(const [mode,expected]of [['explore','explore'],['edit','edit'],['run','run'],[undefined,'explore']]){const context={mode,model:{private:true},selection:[1,2],zoom:.6};const before=structuredClone(context);assert.equal(guideTopicFor(context),expected);assert.deepEqual(context,before);}
});
test('manual topic navigation wraps and leaves activation to Enter/Space',()=>{
    assert.equal(guideTabIndex('ArrowLeft',0,5),4);assert.equal(guideTabIndex('ArrowRight',4,5),0);assert.equal(guideTabIndex('Home',3,5),0);assert.equal(guideTabIndex('End',1,5),4);for(const key of ['Enter',' ','Tab','Escape'])assert.equal(guideTabIndex(key,1,5),null);for(const [index,count]of [[-1,5],[5,5],[0,0],[0,1.5]])assert.equal(guideTabIndex('ArrowRight',index,count),null);
    assert.equal(new Set(GUIDE_TOPICS.map(t=>t.id)).size,GUIDE_TOPICS.length);assert.ok(GUIDE_TOPICS.every(t=>t.actions.every(a=>Object.hasOwn(GUIDE_ACTIONS,a))));
});
