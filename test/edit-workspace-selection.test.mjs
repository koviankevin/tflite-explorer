import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
import {customFixture} from './custom-fixture.mjs';
import {parseModel} from '../src/model-engine.js';
import {editWorkspaceSnapshot} from '../src/model-edit-workspace.js';
import {modelEditDraft} from '../src/model-edit-draft.js';
const source=await readFile(new URL('../src/model-edit-workspace-ui.js',import.meta.url),'utf8'),metadata=JSON.parse(await readFile(new URL('../vendor/netron/tflite-metadata.json',import.meta.url)));
const start=source.indexOf('const api={')+'const api='.length,end=source.indexOf(';return api;',start);assert.ok(start>0&&end>start);
test('returning to edit after selecting three OPs expands an existing two-OP scope without losing its commands',async()=>{
 const f=await customFixture({external:true}),index=await parseModel((o,n)=>f.bytes.subarray(o,o+n),f.bytes.length,metadata),file={},snapshot=editWorkspaceSnapshot(index,{targets:[{graph:0,node:0}]}),draft=modelEditDraft(snapshot);assert.equal(snapshot.nodes.length,2);draft.apply({kind:'clone',node:'op:0:0',side:'after'});const commands=draft.commands,targets=[0,1,2].map(node=>({graph:0,node}));let active=false;
 const context={owner:file,draft,snapshot,getSource:()=>file,getTargets:()=>targets,mode:value=>{active=value;},extend:async next=>{context.snapshot=editWorkspaceSnapshot(index,{targets:[...snapshot.nodes.map(n=>n.source),...next]});context.draft=modelEditDraft(context.snapshot,context.draft.commands);}};
 const api=vm.runInNewContext('('+source.slice(start,end)+')',context);await api.open();assert.equal(active,true);assert.equal(context.snapshot.nodes.length,3,'All three graph-selected OPs must enter the edit workspace.');assert.deepEqual(context.draft.commands,commands);
});
