import {test} from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';
import {assertModelEditAction,MODEL_EDIT_ACTIONS,supportsModelEditing} from '../src/model-edit-policy.js';
import {controlFixture} from './tflite-control-fixture.mjs';
import {parseModel} from '../src/model-engine.js';
import {editWorkspaceSnapshot,exportEditWorkspace} from '../src/model-edit-workspace.js';
import {modelEditDraft} from '../src/model-edit-draft.js';
import {validateTfliteModelGraph} from '../src/tflite-model-edit.js';
const metadata=JSON.parse(await readFile(new URL('../vendor/netron/tflite-metadata.json',import.meta.url)));
const parse=b=>parseModel((o,n)=>b.subarray(o,o+n),b.length,metadata);
test('Worker rejects every actual-model editing RPC on MLIR before imports or session mutation',async()=>{
 const source=await readFile(new URL('../src/model-worker.js',import.meta.url),'utf8'),start=source.indexOf('self.onmessage =');assert.ok(start>0);
 const messages=[],session={unchanged:true},context={self:{},postMessage:m=>messages.push(m),index:{mlir:{}},editWorkspace:session,assertModelEditAction};vm.runInNewContext(source.slice(start).replaceAll('import.meta.url',JSON.stringify('https://example.invalid/src/model-worker.js')),context);
 for(const action of MODEL_EDIT_ACTIONS){await context.self.onmessage({data:{id:messages.length,action,args:{}}});assert.match(messages.at(-1).error,/僅支援 TFLite/);assert.equal(context.editWorkspace,session);}
 assert.equal(supportsModelEditing('mlir'),false);assert.equal(supportsModelEditing('tflite'),true);assert.doesNotThrow(()=>assertModelEditAction({mlir:{}},'capturePattern',{}));assert.doesNotThrow(()=>assertModelEditAction({raw:{}},'editWorkspaceOpen',{}));assert.throws(()=>assertModelEditAction({raw:{}},'editDraftRestore',{document:{source:{format:'mlir'}}}),/MLIR 編輯草稿/);
});
for(const graph of [0,4])test(`IF/WHILE/custom fixture graph ${graph} preserves control targets and bytes after a continued draft edit`,async()=>{
 const f=await controlFixture(),index=await parse(f.bytes),file=new File([f.bytes],'control.tflite'),target=graph===0?3:1,snapshot=editWorkspaceSnapshot(index,{targets:[{graph,node:target}]}),d=modelEditDraft(snapshot),node=`op:${graph}:${target}`,join=`op:${graph}:${target+1}`;
 for(let g=0;g<5;g++)assert.equal(validateTfliteModelGraph(index.raw,g).passed,true);
 d.apply({kind:'clone',node,side:'after'});for(let slot=0;slot<(graph===0?2:1);slot++)d.apply({kind:'wire',node:join,slot,value:`new:1:out:${slot}`});
 const resumed=modelEditDraft(snapshot,d.history.commands,d.history.redo);resumed.apply({kind:'wire',node:'new:1',slot:0,value:snapshot.nodes.find(n=>n.id===node).outputs[0].value});
 const result=await exportEditWorkspace(index,file,snapshot,resumed.commands),bytes=new Uint8Array(await result.blob.arrayBuffer()),after=await parse(bytes);for(let g=0;g<5;g++)assert.equal(validateTfliteModelGraph(after.raw,g).passed,true);
 assert.equal(after.raw.subgraphs[graph].operators.length,index.raw.subgraphs[graph].operators.length+1);assert.equal(after.raw.subgraphs[0].operators[0].builtin_options.then_subgraph_index,1);assert.equal(after.raw.subgraphs[0].operators[0].builtin_options.else_subgraph_index,2);assert.equal(after.raw.subgraphs[0].operators[1].builtin_options.cond_subgraph_index,3);assert.equal(after.raw.subgraphs[0].operators[1].builtin_options.body_subgraph_index,4);
 const weight=after.raw.buffers[1];assert.deepEqual(bytes.subarray(Number(weight.offset),Number(weight.offset+weight.size)),f.weight);
 for(const g of after.raw.subgraphs)for(const op of g.operators)if(after.raw.operator_codes[op.opcode_index].custom_code)assert.deepEqual(op.custom_options,f.options);
});
