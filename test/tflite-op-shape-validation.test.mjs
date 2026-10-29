import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {tflite as s} from '../vendor/netron/tflite-schema.js';
import {builtinCatalog,checkBuiltinPorts} from '../src/tflite-new-ops.js';
import {parseModel} from '../src/model-engine.js';
import {editWorkspaceSnapshot,exportEditWorkspace} from '../src/model-edit-workspace.js';
import {modelEditDraft} from '../src/model-edit-draft.js';
import {runtimeFixture} from './runtime-fixture.mjs';
import {inferStaticTransform} from '../src/tflite-static-transform.js';
import {inferTfliteOutputs} from '../src/tflite-shape-inference.js';
const metadata=JSON.parse(await readFile(new URL('../vendor/netron/tflite-metadata.json',import.meta.url),'utf8'));
const tensor=shape=>({type:0,shape}),parse=bytes=>parseModel((o,n)=>bytes.subarray(o,o+n),bytes.length,metadata);
async function draftWith(name,shapes,settings,inputCount){
 const f=await runtimeFixture({inputShapes:shapes,outputShape:shapes[0]}),index=await parse(f.bytes),snapshot=editWorkspaceSnapshot(index,{targets:[{graph:0,node:0}]}),draft=modelEditDraft(snapshot);
 draft.apply({kind:'clone',node:'op:0:0',side:'after'});draft.apply({kind:'builtin',node:'new:1',code:s.BuiltinOperator[name],version:1,inputCount,outputLike:['t:0:0'],settings,inferOutputs:true});
 draft.apply({kind:'expose',node:'new:1',enabled:true});return {f,index,snapshot,draft};
}
test('CONCATENATION catalog and port checks accept the real variadic input list',()=>{
 const op=builtinCatalog(metadata).find(o=>o.name==='CONCATENATION');assert.equal(op.inputs[0].list,true);
 assert.doesNotThrow(()=>checkBuiltinPorts(s.BuiltinOperator.CONCATENATION,[tensor([2,3]),tensor([2,3])],[tensor([2,6])],{axis:1}));
});
test('a valid two-input CONCATENATION can be exported through the actual editing workspace',async()=>{
 const {f,index,snapshot,draft}=await draftWith('CONCATENATION',[[2,3],[2,3]],{axis:1},2);draft.undo();draft.undo();draft.redo();draft.redo();assert.deepEqual(draft.state.values.get('new:1:out:0').inferredShape,[2,6]);
 const out=await exportEditWorkspace(index,f.file,snapshot,draft.commands),reopened=await parse(new Uint8Array(await out.blob.arrayBuffer())),g=reopened.raw.subgraphs[0],op=g.operators[1];
 assert.equal(reopened.raw.operator_codes[op.opcode_index].builtin_code,s.BuiltinOperator.CONCATENATION);assert.deepEqual([...g.tensors[op.outputs[0]].shape],[2,6]);
});
test('SQUEEZE accepts negative/duplicate axes, scalar results and omitted axes while checking exact output shape',()=>{
 for(const [shape,axes,out]of [[[1,2,1],[-1],[1,2]],[[1,2,1],[0,-3,0],[2,1]],[[1,1],[],[]],[[],[],[]],[[0,1],[1],[0]]]){
  assert.deepEqual(inferStaticTransform('SQUEEZE',[tensor(shape)],{squeeze_dims:axes}).shapes,[out]);
  assert.doesNotThrow(()=>checkBuiltinPorts(s.BuiltinOperator.SQUEEZE,[tensor(shape)],[tensor(out)],{squeeze_dims:axes}));
 }
 for(const axes of [[0],[2],[-3]])assert.throws(()=>checkBuiltinPorts(s.BuiltinOperator.SQUEEZE,[tensor([2,1])],[tensor([2])],{squeeze_dims:axes}),/SQUEEZE.*squeeze_dims/);
 assert.throws(()=>checkBuiltinPorts(s.BuiltinOperator.SQUEEZE,[tensor([1,2])],[tensor([1,2])],{}),/輸出 shape/);
 assert.throws(()=>checkBuiltinPorts(s.BuiltinOperator.SQUEEZE,[tensor([1,2])],[{...tensor([2]),type:2}],{}),/dtype/);
});
test('CONCATENATION checks axes, rank, nonaxis dimensions, dtype and overflow while handling negative axes and empty dimensions',()=>{
 const run=(a,b,out,axis)=>checkBuiltinPorts(s.BuiltinOperator.CONCATENATION,[tensor(a),tensor(b)],[tensor(out)],{axis});
 for(const [a,b,out,axis]of [[[2,3],[2,4],[2,7],-1],[[0,3],[0,4],[0,7],1],[[2,0],[2,4],[2,4],1]])assert.doesNotThrow(()=>run(a,b,out,axis));
 for(const [a,b,out,axis]of [[[2,3],[2,4],[2,7],2],[[2,3],[2,4],[2,7],-3],[[2,3],[3],[2,6],1],[[2,3],[3,4],[2,7],1],[[2,3],[2,4],[7,2],1],[[2147483647],[1],[2147483647],0]])assert.throws(()=>run(a,b,out,axis),/CONCATENATION/);
 assert.throws(()=>checkBuiltinPorts(s.BuiltinOperator.CONCATENATION,[],[tensor([1])],{axis:0}),/至少/);
 assert.throws(()=>checkBuiltinPorts(s.BuiltinOperator.CONCATENATION,[tensor([1]),{...tensor([1]),type:2}],[tensor([2])],{axis:0}),/dtype/);
});
test('inference and export keep dynamic/scalar-constant cases explicitly manual instead of asserting unproven shapes',()=>{
 const dynamic={...tensor([1,3]),shape_signature:[-1,3]},out=tensor([9,9]);
 assert.equal(inferStaticTransform('CONCATENATION',[dynamic,tensor([1,3])],{axis:1}).status,'manual');
 assert.doesNotThrow(()=>checkBuiltinPorts(s.BuiltinOperator.CONCATENATION,[dynamic,tensor([1,3])],[out],{axis:1}));
 assert.equal(inferTfliteOutputs('CONCATENATION',[tensor([]),tensor([])],[tensor([2])],{axis:0}).status,'manual');
 assert.equal(inferTfliteOutputs('SQUEEZE',[tensor([1,2])],[tensor([2])],{squeeze_dims:[0,0]}).status,'inferred');
});
test('a non-unit SQUEEZE axis must block actual model export even when element counts match',async()=>{
 const {f,index,snapshot,draft}=await draftWith('SQUEEZE',[[2,3],[2,3]],{squeeze_dims:[0]},1);
 await assert.rejects(exportEditWorkspace(index,f.file,snapshot,draft.commands),/SQUEEZE.*(?:axis|維度|squeeze_dims)/);
});
test('turning off inference cannot export a wrong static CONCATENATION output reference',async()=>{
 const {f,index,snapshot,draft}=await draftWith('CONCATENATION',[[2,3],[2,3]],{axis:1},2);
 draft.apply({kind:'builtin',node:'new:1',code:s.BuiltinOperator.CONCATENATION,version:1,inputCount:2,outputLike:['t:0:0'],settings:{axis:1},inferOutputs:false});
 await assert.rejects(exportEditWorkspace(index,f.file,snapshot,draft.commands),/CONCATENATION.*輸出 shape/);
});
