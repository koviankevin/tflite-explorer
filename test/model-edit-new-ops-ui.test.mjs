import {test} from 'node:test';
import assert from 'node:assert/strict';
import {editNewOpsUI} from '../src/model-edit-new-ops-ui.js';
import {readFile} from 'node:fs/promises';
import {parseModel} from '../src/model-engine.js';
import {editWorkspaceSnapshot} from '../src/model-edit-workspace.js';
import {modelEditDraft} from '../src/model-edit-draft.js';
import {optionalCustomFixture} from './optional-custom-fixture.mjs';

// Minimal DOM surface for this inspector; no browser or model data allocation.
class Element {
 constructor(tag){this.tag=tag;this.children=[];this.dataset={};this._text='';}
 set textContent(value){this._text=value;this.children=[];}
 get textContent(){return this._text+this.children.map(c=>c.textContent).join('');}
 append(...items){this.children.push(...items);}
 replaceChildren(...items){this._text='';this.children=items;}
 querySelectorAll(selector){const match=e=>selector==='details'?e.tag==='details':selector==='[data-builtin-option]'?Object.hasOwn(e.dataset,'builtinOption'):false;return this.children.flatMap(c=>[...(match(c)?[c]:[]),...c.querySelectorAll(selector)]);}
 get options(){return this.children.filter(c=>c.tag==='option');}
 set value(value){this._value=String(value);}
 get value(){return this._value??this.options[0]?.value??'';}
}
async function inspector(reference,providedState){
 const root=new Element('div');root.id='edit-new-ops';
 const find=(e,id)=>e.id===id?e:e.children.map(c=>find(c,id)).find(Boolean),$=id=>find(root,id);
 const values=new Map(reference?[['t:0:0',{id:'t:0:0',graph:0,type:'reference',...reference}]]:[]),commands=[];
 const state=providedState||{format:'tflite',values,nodes:[{id:'new:1',fresh:true,name:'CUSTOM',source:{graph:0},inputs:[{value:'t:0:-1'}],outputs:[]}]};
 const previous=globalThis.Option;globalThis.Option=class extends Element{constructor(text,value){super('option');this.textContent=text;this.value=value;}};
 try{
  const ui=editNewOpsUI({$,make:(tag,text)=>{const e=new Element(tag);if(text!==undefined)e.textContent=text;return e;},rpc:async()=>[{code:0,name:'ADD',inputs:[{}],outputs:[],fields:[]}],state:()=>state,selected:()=> 'new:1',apply:command=>commands.push(command),message:assert.fail,isBusy:()=>false});
  ui.render();await new Promise(resolve=>setImmediate(resolve));return {$,root,commands,state};
 }finally{if(previous===undefined)delete globalThis.Option;else globalThis.Option=previous;}
}
test('random inspector handles a cloned optional-input custom op without reference tensors',async()=>{
 const bytes=await optionalCustomFixture(),metadata=JSON.parse(await readFile(new URL('../vendor/netron/tflite-metadata.json',import.meta.url),'utf8')),index=await parseModel((offset,length)=>bytes.subarray(offset,offset+length),bytes.length,metadata);
 const draft=modelEditDraft(editWorkspaceSnapshot(index,{targets:[{graph:0,node:0}]}));draft.apply({kind:'clone',node:'op:0:0',side:'after'});assert.equal([...draft.state.values.values()].filter(v=>!v.optional).length,0);
 const {$,root,commands}=await inspector(undefined,draft.state);assert.ok($('edit-random-apply'),'inspector must remain mounted, not become a raw exception');assert.equal($('edit-random-apply').disabled,true);assert.equal($('edit-random-like').disabled,true);assert.match($('edit-random-range').textContent,/沒有可用|參考/);assert.ok(!root.textContent.includes('Cannot read'));assert.deepEqual(commands,[]);
});
test('invalid or unsupported reference metadata disables generation without tearing down the inspector',async()=>{
 for(const signature of ['invalid','null',JSON.stringify({type:5})]){const {$,commands}=await inspector({signature});assert.ok($('edit-random-apply'));assert.equal($('edit-random-apply').disabled,true);assert.ok($('edit-random-range').textContent.length>0);assert.deepEqual(commands,[]);}
});
test('float32 const defaults to small truncated weights; explicit Uniform keeps the legacy command',async()=>{
 const {$,commands}=await inspector({signature:JSON.stringify({type:0})});assert.equal($('edit-random-apply').disabled,false);assert.match($('edit-random-range').textContent,/float32/);assert.equal($('edit-random-min').step,'any');assert.equal($('edit-random-distribution').value,'truncated-normal');assert.equal($('edit-random-mean').value,'0');assert.equal($('edit-random-std').value,'0.05');$('edit-random-distribution').value='uniform';$('edit-random-distribution').onchange();$('edit-random-min').value='1';$('edit-random-max').value='1';$('edit-random-apply').onclick();assert.deepEqual(commands,[{kind:'random',node:'new:1',slot:0,like:'t:0:0',seed:1,min:1,max:1}]);
});
test('const inspector sends applicable Normal and Bernoulli parameters rather than hidden bounds',async()=>{
 const {$,commands}=await inspector({signature:JSON.stringify({type:0})});for(const distribution of ['normal','bernoulli']){$('edit-random-distribution').value=distribution;$('edit-random-distribution').onchange();$('edit-random-apply').onclick();}
 assert.deepEqual(commands,[{kind:'random',node:'new:1',slot:0,like:'t:0:0',seed:1,distribution:'normal',mean:0,std:.05},{kind:'random',node:'new:1',slot:0,like:'t:0:0',seed:1,distribution:'bernoulli',probability:.5}]);
});
