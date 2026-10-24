import {test} from 'node:test';
import assert from 'node:assert/strict';
import {workspaceIdentity,exportWorkspace,parseWorkspace,checkWorkspace,WORKSPACE_LIMIT,resultKey,sameResultKey} from '../src/workspace.js';
const pattern={name:'test',nodes:[{alias:'N1',type:'Reshape',conditions:[{kind:'dtype',side:'output',port:0,value:'float32'}]},{alias:'N2',type:'Transpose'}],edges:[{from:'N1',to:'N2'}],induced:true};
const identity={name:'same.tflite',bytes:100,sourceFormat:'tflite',signature:'a'.repeat(64)};
const base=()=>({format:'model-lens-workspace',version:1,identity,state:{kind:'patterns',query:'',scope:'all',graph:0,view:'result',activeIndex:0,resultKey:'match',pattern,patternText:'N1:Reshape -> N2:Transpose',patternMode:'visual',patternName:'test',font:'32',direction:'horizontal',sidebarWidth:500,exportScope:'slice',full:false,collapsed:false,picking:true,across:false,captureName:'selection',selections:[{graph:0,nodes:[0,1]}],overviewExpanded:[1,5],sliceDetails:false,expanded:['a>b'],pages:[['a>b',3]],camera:{kind:'svg',zoom:.5,scrollLeft:12,scrollTop:34,candidates:[{id:'0',x:200,y:100}],page:null}}});
test('overview projection identity is stable when detailed edges are omitted, but distinct matches differ',()=>{
    const item={kind:'patterns',graph:0,id:'N1 #0',path:[0,1],connections:[[0,1]]};
    assert.equal(sameResultKey(resultKey({...item,connections:[]}),item),true);
    assert.equal(sameResultKey(resultKey(item),{...item,path:[2,3]}),false);
    assert.equal(sameResultKey('invalid',item),false);
});
test('workspace file roundtrip preserves constraints, selection, expansion segments and SVG/Canvas cameras',()=>{
    const value=base();assert.deepEqual(parseWorkspace(exportWorkspace(value)),value);checkWorkspace(value,identity,[{layers:4}]);
    value.state.across=true;value.state.selections.push({graph:1,nodes:[2]});value.state.camera={kind:'canvas',zoom:.003,x:5000,y:8000};value.state.view='overview';
    assert.deepEqual(parseWorkspace(exportWorkspace(value)),value);checkWorkspace(value,identity,[{layers:4},{layers:3}]);
});
test('invalid, oversized and mismatched workspaces are rejected before applying state',()=>{
    const value=base();assert.throws(()=>checkWorkspace(value,{...identity,signature:'b'.repeat(64)},[{layers:4}]),/不符/);
    assert.throws(()=>checkWorkspace(value,identity,[{layers:1}]),/超出/);assert.throws(()=>parseWorkspace(' '.repeat(WORKSPACE_LIMIT+1)),/2 MiB/);
    for(const change of [s=>s.selections[0].nodes.push(1),s=>s.camera.zoom=NaN,s=>s.camera.candidates[0].x=1e20,s=>s.overviewExpanded.push(5),s=>s.pattern.nodes[0].conditions[0].port=-1,s=>s.pages=[['not-expanded',0]],s=>s.graph=-1]) {
        const modified=base();change(modified.state);assert.throws(()=>exportWorkspace(modified));
    }
    assert.throws(()=>parseWorkspace('{'));assert.throws(()=>parseWorkspace('{}'));
});
test('structural fingerprints reject changed connections, dtype and attribute while never inspecting weights',async()=>{
    const v={identifier:'tensor0',type:{dataType:'float32',shape:{dimensions:[1,2]}}};Object.defineProperty(v,'initializer',{get(){throw Error('must not read weight');}});
    const n={identifier:'0',type:{name:'Custom'},inputs:[{name:'input',value:[v]}],outputs:[],attributes:[{name:'axis',value:1}]};
    const index={sourceFormat:'tflite',graphs:[{graph:{name:'main',inputs:[],outputs:[],nodes:[n]}}]},file={name:'model.tflite',size:100};
    const a=await workspaceIdentity(index,file);assert.deepEqual(await workspaceIdentity(index,file),a);
    n.inputs[0].value=[];assert.notEqual((await workspaceIdentity(index,file)).signature,a.signature);n.inputs[0].value=[v];
    v.type.dataType='int8';assert.notEqual((await workspaceIdentity(index,file)).signature,a.signature);v.type.dataType='float32';
    n.attributes[0].value=2;assert.notEqual((await workspaceIdentity(index,file)).signature,a.signature);
    n.attributes[0].value=1;n.metadata=[{name:'successors',value:'^left'}];const branch=await workspaceIdentity(index,file);
    n.metadata[0].value='^right';assert.notEqual((await workspaceIdentity(index,file)).signature,branch.signature);
});
