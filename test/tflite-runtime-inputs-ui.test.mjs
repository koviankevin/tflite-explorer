import {test} from 'node:test';
import assert from 'node:assert/strict';
import {runtimeInputsUI} from '../src/tflite-runtime-inputs-ui.js';

// Dialog ownership seam only; use real input validation and random controls.
// No browser, runtime, model allocation, WeakRef or forced GC.
class Element {
    constructor(tag){this.tag=tag;this.children=[];this.files=[];this.listeners={};this.open=false;this.onclick=null;this._text='';}
    append(...items){this.children.push(...items);}
    replaceChildren(...items){this._text='';this.children=items;}
    set textContent(value){this._text=value;this.children=[];}
    get textContent(){return this._text+this.children.map(c=>c.textContent).join('');}
    get options(){return this.children.filter(c=>c.tag==='option');}
    set value(value){this._value=String(value);}
    get value(){return this._value??this.options[0]?.value??'';}
    addEventListener(name,fn){this.listeners[name]=fn;}
    showModal(){if(this.showError)throw this.showError;this.open=true;}
    close(){this.open=false;}
}
async function fixture(run){
    const root=new Element('main'),make=(tag,id)=>{const e=new Element(tag);e.id=id;return e;},dialog=make('dialog','edit-runtime-dialog'),list=make('div','edit-runtime-inputs'),error=make('p','edit-runtime-input-error'),confirm=make('button','edit-runtime-run'),cancel=make('button','edit-runtime-dialog-close');dialog.append(list,error,confirm,cancel);root.append(dialog);
    const find=(e,id)=>e.id===id?e:e.children.map(c=>find(c,id)).find(Boolean),$=id=>find(root,id),previous={document:globalThis.document,Option:globalThis.Option};
    globalThis.document={getElementById:$,createElement:tag=>new Element(tag)};globalThis.Option=class extends Element{constructor(text,value){super('option');this.textContent=text;this.value=value;}};
    try{await run({ui:runtimeInputsUI(),$,dialog,list,error,confirm,cancel});}finally{for(const [key,value]of Object.entries(previous))if(value===undefined)delete globalThis[key];else globalThis[key]=value;}
}
const plan={inputs:[{dtype:'float32',shape:[1],name:'data',tensor:0}]};
const chooseBIN=($,file)=>{$('runtime-input-mode-0').value='bin';$('runtime-input-mode-0').onchange();$('runtime-input-file-0').files=[file];};
test('confirm returns the selected BIN, then detaches the dialog controls and confirmation callback',()=>fixture(async({ui,$,dialog,list,error,confirm})=>{const file=new File([Float32Array.of(7)],'input.bin'),pending=ui.choose(plan);chooseBIN($,file);confirm.onclick();assert.deepEqual(await pending,[{mode:'bin',file}]);assert.equal(dialog.open,false);assert.equal(list.children.length,0);assert.equal(error.textContent,'');assert.equal(confirm.onclick,null,'closed dialog must not own the old specs / File controls');ui.cancel();assert.equal(confirm.onclick,null);}));
test('button, Escape and session cancellation release the pending dialog and confirmation callback',()=>fixture(async({ui,dialog,list,confirm,cancel})=>{for(const action of ['button','escape','session']){const pending=ui.choose(plan);if(action==='button')cancel.onclick();else if(action==='session')ui.cancel();else{let prevented=false;dialog.listeners.cancel({preventDefault(){prevented=true;}});assert.equal(prevented,true);}assert.equal(await pending,null);assert.equal(dialog.open,false);assert.equal(list.children.length,0);assert.equal(confirm.onclick,null,action);}}));
test('a cancelled dialog confirmation cannot resolve or close a newer input request',()=>fixture(async({ui,$,dialog,confirm})=>{const oldFile=new File([Float32Array.of(1)],'old.bin'),first=ui.choose(plan);chooseBIN($,oldFile);const stale=confirm.onclick;ui.cancel();assert.equal(await first,null);const fresh=ui.choose(plan);stale();assert.equal(dialog.open,true,'stale callback must not close the current dialog');const file=new File([Float32Array.of(9)],'fresh.bin');chooseBIN($,file);confirm.onclick();assert.deepEqual(await fresh,[{mode:'bin',file}]);}));
test('validation errors keep the current controls active until corrected',()=>fixture(async({ui,$,dialog,error,confirm})=>{const pending=ui.choose(plan);chooseBIN($,new File(['bad'],'bad.bin'));confirm.onclick();assert.equal(dialog.open,true);assert.match(error.textContent,/4 bytes/);assert.equal(typeof confirm.onclick,'function');const file=new File([Float32Array.of(2)],'fixed.bin');chooseBIN($,file);confirm.onclick();assert.deepEqual(await pending,[{mode:'bin',file}]);assert.equal(error.textContent,'');assert.equal(confirm.onclick,null);}));
test('native showModal failure leaves no pending request, controls or confirmation callback',()=>fixture(async({ui,dialog,list,confirm})=>{dialog.showError=new Error('dialog disconnected');assert.throws(()=>ui.choose(plan),/dialog disconnected/);assert.equal(list.children.length,0);assert.equal(confirm.onclick,null);delete dialog.showError;const pending=ui.choose({inputs:[]});confirm.onclick();assert.deepEqual(await pending,[]);}));
