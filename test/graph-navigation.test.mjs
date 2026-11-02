import {test} from 'node:test';
import assert from 'node:assert/strict';
import {navigateGraph,isGraphPanKey} from '../src/graph-navigation.js';
import {overviewLabel,fitOverviewText} from '../src/overview-label.js';
import {graphNavigationRequired,graphFocusNavigationRequired,graphPointerNavigationRequired} from './browser/release-features.mjs';

test('navigation acceptance starts at v1.5.0 and remains required in later versions',()=>{
    for(const version of ['0.2.0-preview.34','1.0.0','1.4.8'])assert.equal(graphNavigationRequired(version),false);
    for(const version of ['1.5.0','1.5.1','1.6.0','2.0.0'])assert.equal(graphNavigationRequired(version),true);
    assert.throws(()=>graphNavigationRequired('invalid'));
});

test('graph navigation preserves text/form/browser keys and scopes ordinary and accelerated movement',()=>{
    const calls=[],api={pan:(...args)=>calls.push(['pan',...args]),zoom:factor=>calls.push(['zoom',factor]),fit:()=>calls.push(['fit'])};
    const event=extra=>({key:'ArrowRight',preventDefault(){calls.push(['prevent']);},stopPropagation(){calls.push(['stop']);},...extra});
    for(const key of ['ArrowRight','w','a','s','d','W'])for(const extra of [{ctrlKey:true},{metaKey:true},{altKey:true},{isComposing:true},{defaultPrevented:true},{target:{closest:()=>({})}}])assert.equal(navigateGraph(event({key,...extra}),api),false);
    for(const key of ['Tab','Enter',' '])assert.equal(navigateGraph(event({key}),api),false);
    assert.deepEqual(calls,[]);
    for(const [key,shiftKey,expected] of [['ArrowRight',false,[80,0]],['ArrowLeft',true,[-240,0]],['ArrowDown',true,[0,240]],['ArrowUp',false,[0,-80]],['w',false,[0,-80]],['a',false,[-80,0]],['s',false,[0,80]],['d',false,[80,0]],['W',true,[0,-240]],['A',true,[-240,0]],['S',true,[0,240]],['D',true,[240,0]]]){calls.length=0;assert.equal(navigateGraph(event({key,shiftKey}),api),true);assert.deepEqual(calls,[['pan',...expected],['prevent'],['stop']]);}
    for(const [key,expected] of [['Home',['fit']],['+',['zoom',1.4]],['-',['zoom',1/1.4]],['e',['zoom',1.4]],['E',['zoom',1.4]],['q',['zoom',1/1.4]],['Q',['zoom',1/1.4]]]){calls.length=0;navigateGraph(event({key}),api);assert.deepEqual(calls[0],expected);}
});
test('compact text retains source location and ellipsizes actual measured Unicode labels without splitting a character',()=>{
    assert.deepEqual(overviewLabel({type:{name:'Add'},name:'original_name',sourceGraph:3,sourceNode:52}),{title:'Add',info:'#52 · block 3'});
    assert.deepEqual(overviewLabel({diagramKind:'pattern',type:{name:'Pattern #2'},name:'Very long pattern name #2 · 18 OP · 點開'}),{title:'Pattern #2',info:'18 OP · 點開'});
    const ctx={measureText:text=>({width:Array.from(text).reduce((sum,ch)=>sum+(ch==='😀'?20:10),0)})};
    for(const text of ['company.'+'long'.repeat(40),'😀'.repeat(200),'很長的算子名稱'.repeat(80)]){const result=fitOverviewText(ctx,text,140);assert.ok(ctx.measureText(result).width<=140);assert.ok(result.endsWith('…'));assert.ok(!/[\uD800-\uDBFF]…/.test(result));}
    assert.equal(fitOverviewText(ctx,'Add',140),'Add');
});

test('physical WASD works on non-editable graph surfaces with IME key=Process, but never intercepts forms',()=>{
    const calls=[],api={pan:(...args)=>calls.push(args),zoom(){assert.fail();},fit(){assert.fail();}},event={key:'Process',code:'KeyW',isComposing:true,preventDefault(){},stopPropagation(){}};
    assert.equal(isGraphPanKey(event),true);assert.equal(navigateGraph(event,api),true);assert.deepEqual(calls,[[0,-80]]);
    assert.equal(navigateGraph({...event,target:{closest:()=>({})}},api),false);assert.equal(navigateGraph({...event,ctrlKey:true},api),false);assert.equal(navigateGraph({...event,code:'KeyZ'},api),false);assert.equal(calls.length,1);
});

test('fitted pan and Q/E acceptance starts at v1.6.0 without changing immutable v1.5.0 checks',()=>{
    for(const version of ['0.2.0-preview.34','1.0.0','1.4.8','1.5.0','1.5.1'])assert.equal(graphFocusNavigationRequired(version),false);
    for(const version of ['1.6.0','1.6.1','2.0.0'])assert.equal(graphFocusNavigationRequired(version),true);
    assert.throws(()=>graphFocusNavigationRequired('invalid'));
});

test('mixed mouse/keyboard acceptance is required from v1.6.1 and preserves immutable v1.6.0',()=>{
    for(const v of ['0.2.0-preview.34','1.0.0','1.5.9','1.6.0'])assert.equal(graphPointerNavigationRequired(v),false);
    for(const v of ['1.6.1','1.6.2','1.7.0','2.0.0'])assert.equal(graphPointerNavigationRequired(v),true);
    assert.throws(()=>graphPointerNavigationRequired('invalid'));
});
