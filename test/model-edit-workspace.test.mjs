import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {editWorkspaceSnapshot,exportEditWorkspace} from '../src/model-edit-workspace.js';
import {modelEditDraft,replayEditDraft,editChanges,editWireReason} from '../src/model-edit-draft.js';
import {parseModel} from '../src/model-engine.js';
import {parseMLIR,parseMLIRFile} from '../src/mlir-engine.js';
import {validateMLIR} from '../src/mlir-validate.js';
import {customFixture} from './custom-fixture.mjs';
import {MLIR_CFG_DIAMOND,MLIR_CFG_LOOP,MLIR_BRANCH} from './mlir-fixture.mjs';
import {fixture as chainFixture} from './fixture.mjs';
import {createModelEditReport} from '../src/model-edit-report.js';
const tm=JSON.parse(await readFile(new URL('../vendor/netron/tflite-metadata.json',import.meta.url))),mm=await readFile(new URL('../vendor/netron/mlir-metadata.json',import.meta.url),'utf8');
const tf=bytes=>parseModel((o,n)=>bytes.subarray(o,o+n),bytes.length,tm),ml=text=>parseMLIR(new TextEncoder().encode(text),{metadata:mm});
async function fixture(){const f=await customFixture({external:true}),index=await tf(f.bytes),file=new File([f.bytes],'source.tflite');return {...f,index,file,snapshot:editWorkspaceSnapshot(index,{targets:[{graph:0,node:0},{graph:0,node:1},{graph:0,node:2}]})};}

test('TFLite transaction creates outputs, rewires graph, preserves original bytes and custom options',async()=>{
 const f=await fixture(),draft=modelEditDraft(f.snapshot),original=JSON.stringify(f.snapshot);
 draft.apply({kind:'clone',node:'op:0:0',side:'after'});const out=draft.state.nodes.find(n=>n.fresh).outputs[0].value;
 draft.apply({kind:'wire',node:'new:1',slot:0,value:'t:0:4'});draft.apply({kind:'wire',node:'op:0:1',slot:0,value:out});
 assert.equal(editChanges(f.snapshot,draft.state).length,2);assert.equal(JSON.stringify(f.snapshot),original);
 f.file.arrayBuffer=()=>{throw Error('Whole source read forbidden.');};
 const exported=await exportEditWorkspace(f.index,f.file,f.snapshot,draft.commands),bytes=new Uint8Array(await exported.blob.arrayBuffer()),after=await tf(bytes),g=after.raw.subgraphs[0];
 assert.equal(g.operators.length,4);assert.equal(g.tensors.length,11);assert.deepEqual([...g.operators[1].inputs],[4,2]);assert.deepEqual([...g.operators[1].outputs],[10]);assert.deepEqual([...g.operators[2].inputs],[10,5,-1]);assert.equal(g.tensors[10].buffer,0);assert.deepEqual([...g.outputs],[9]);
 const op=g.operators[2],weight=after.raw.buffers[3];assert.deepEqual(bytes.subarray(Number(op.large_custom_options_offset),Number(op.large_custom_options_offset+op.large_custom_options_size)),f.options);assert.deepEqual(bytes.subarray(Number(weight.offset),Number(weight.offset+weight.size)),f.weight);
});
test('draft undo/redo, branch truncation, type/order rejection and restored removals',async()=>{
 const f=await fixture(),d=modelEditDraft(f.snapshot);assert.match(editWireReason(d.state,'op:0:0',0,'t:0:7'),/量化|型別/);assert.match(editWireReason(d.state,'op:0:0',0,'t:0:4'),/先於/);
 d.apply({kind:'clone',node:'op:0:0',side:'after'});d.undo();assert.equal(d.state.nodes.length,3);d.redo();assert.equal(d.state.nodes.length,4);d.undo();d.apply({kind:'wire',node:'op:0:0',slot:0,value:'t:0:2'});assert.equal(d.canRedo,false);
 d.apply({kind:'remove',node:'op:0:1',boundary:true});d.apply({kind:'restore',node:'op:0:1'});assert.equal(d.state.nodes.find(n=>n.id==='op:0:1').removed,false);d.clear();assert.equal(editChanges(f.snapshot,d.state).length,0);
 assert.throws(()=>replayEditDraft(f.snapshot,Array(129).fill({kind:'remove',node:'op:0:0'})),/128/);
});
test('custom clone allocates all output tensor types/quantization; removal needs rewiring or explicit boundary',async()=>{
 const f=await fixture(),d=modelEditDraft(f.snapshot);d.apply({kind:'clone',node:'op:0:1',side:'after'});const fresh=d.state.nodes.find(n=>n.fresh);
 d.apply({kind:'wire',node:'op:0:2',slot:0,value:fresh.outputs[0].value});d.apply({kind:'wire',node:'op:0:2',slot:1,value:fresh.outputs[1].value});d.apply({kind:'remove',node:'op:0:1'});
 const out=await exportEditWorkspace(f.index,f.file,f.snapshot,d.commands),after=await tf(new Uint8Array(await out.blob.arrayBuffer()));assert.equal(after.raw.subgraphs[0].operators.length,3);for(const t of after.raw.subgraphs[0].tensors.slice(10))assert.equal(t.quantization.scale[0],.25);
 const b=modelEditDraft(f.snapshot);b.apply({kind:'remove',node:'op:0:1'});await assert.rejects(exportEditWorkspace(f.index,f.file,f.snapshot,b.commands),/刪除|來源/);b.undo();b.apply({kind:'remove',node:'op:0:1',boundary:true});const boundary=await tf(new Uint8Array(await (await exportEditWorkspace(f.index,f.file,f.snapshot,b.commands)).blob.arrayBuffer()));assert.deepEqual([...boundary.raw.subgraphs[0].inputs],[1,2,7,8]);
});
for(const [name,text] of [['branch',MLIR_CFG_DIAMOND],['loop',MLIR_CFG_LOOP],['multi-result',MLIR_BRANCH]])test(`MLIR ${name} draft clones fresh typed SSA and keeps attributes/control flow`,async()=>{
 const index=await ml(text),targets=index.mlir.graphs.flatMap((g,graph)=>g.operations.map((_,node)=>({graph,node}))),snapshot=editWorkspaceSnapshot(index,{targets}),d=modelEditDraft(snapshot),template=snapshot.nodes.find(n=>n.cloneable&&n.outputs.length&&n.inputs.length);
 assert.ok(template);d.apply({kind:'clone',node:template.id,side:'after'});const clone=d.state.nodes.find(n=>n.fresh);d.apply({kind:'clone',node:clone.id,side:'after'});
 const outputs=d.state.nodes.filter(n=>n.fresh).flatMap(n=>n.outputs.map(p=>d.state.values.get(p.value).name));assert.equal(new Set(outputs).size,outputs.length);
 const result=await exportEditWorkspace(index,new File([text],'source.mlir'),snapshot,d.commands),after=await ml(await result.blob.text());assert.deepEqual(validateMLIR(after).diagnostics,[]);assert.equal(after.mlir.graphs.reduce((n,g)=>n+g.operations.length,0),targets.length+2);
 assert.equal(snapshot.controls.length,after.mlir.graphs.reduce((n,g)=>n+g.operations.reduce((n,o)=>n+(o.successors?.length||0),0),0));
 if(text.includes('9223372036854775807'))assert.ok((await result.blob.text()).includes('9223372036854775807'));
});
test('MLIR graph wiring preserves SSA identity and rejects non-dominating cross-block rewires at export',async()=>{
 const index=await ml(MLIR_CFG_DIAMOND),snapshot=editWorkspaceSnapshot(index,{targets:index.mlir.graphs.flatMap((g,graph)=>g.operations.map((_,node)=>({graph,node})))}),d=modelEditDraft(snapshot);
 const target=snapshot.nodes.find(n=>n.name==='company.custom_long_name_with_attributes'),slot=0,late=[...d.state.values.values()].find(v=>v.graph>target.source.graph&&v.producer&&v.signature===target.inputs[slot].signature);
 assert.ok(target&&late);d.apply({kind:'wire',node:target.id,slot,value:late.id});await assert.rejects(exportEditWorkspace(index,new File([MLIR_CFG_DIAMOND],'x.mlir'),snapshot,d.commands),/SSA|dominance|支配/);
});
test('bounded edit snapshot on a 21,004 OP model excludes payloads and keeps only a direct neighbourhood',async()=>{
 const f=chainFixture({graphCount:1,repeats:7001}),bytes=new Uint8Array(f.totalBytes),index=await (bytes.set(f.data),tf(bytes)),snapshot=editWorkspaceSnapshot(index,{targets:[{graph:0,node:10500}]});assert.equal(snapshot.total,21004);assert.ok(snapshot.nodes.length<=64&&snapshot.nodes.length>=2);assert.ok(snapshot.values.length<=4096);assert.ok(JSON.stringify(snapshot).length<100000);assert.equal(snapshot.nodes.some(n=>Math.abs(n.source.node-10500)>2),false);
});
for(const format of ['tflite','mlir'])test(`${format} workspace report describes changed templates and actual serialized candidate`,async()=>{
 const f=format==='tflite'?await fixture():null,index=f?.index||await ml(MLIR_CFG_LOOP),file=f?.file||new File([MLIR_CFG_LOOP],'loop.mlir'),snapshot=f?.snapshot||editWorkspaceSnapshot(index,{targets:[{graph:1,node:0}]}),d=modelEditDraft(snapshot),template=snapshot.nodes.find(n=>n.cloneable);d.apply({kind:'clone',node:template.id,side:'after'});
 const result=await exportEditWorkspace(index,file,snapshot,d.commands),candidate=format==='mlir'?await ml(await result.blob.text()):await tf(new Uint8Array(await result.blob.arrayBuffer())),report=createModelEditReport(index,file,{...result,roundTrip:true},candidate,{...template.source,mode:'workspace',workspaceTargets:[template.source]},{outputName:`edited.${format}`}),record=JSON.parse(await report.blob.text());assert.equal(record.modification.action,'workspace');assert.equal(record.modification.workspaceChanges[0].kind,'add');assert.equal(record.modification.output,null);assert.equal(record.checks.find(c=>c.id==='serialized-roundtrip').status,'passed');assert.equal(record.checks.find(c=>c.id==='runtime-equivalence').status,'not-run');
});
test('repeated large quantization ports stop before serializing a large snapshot',async()=>{
 const f=await fixture(),g=f.index.raw.subgraphs[0];g.tensors[1].quantization={scale:new Float32Array(16384),zero_point:new BigInt64Array(1)};g.operators[0].inputs=new Int32Array(200).fill(1);assert.throws(()=>editWorkspaceSnapshot(f.index,{targets:[{graph:0,node:0}]}),/4 MiB/);
});
test('cloned MLIR weight OP preserves each deferred payload as original File slices',async()=>{
 const hex='Ab0123'.repeat(5000),text=`%weight = "company.weight"() {value = dense<"0x${hex}"> : tensor<15000xi8>} : () -> tensor<15000xi8>\n%use = "company.use"(%weight) : (tensor<15000xi8>) -> tensor<15000xi8>`,file=new File([text],'weights.mlir'),index=await parseMLIRFile(file,{metadata:mm}),snapshot=editWorkspaceSnapshot(index,{targets:[{graph:0,node:0}]}),d=modelEditDraft(snapshot);assert.equal(index.mlir.payloads.length,1);file.arrayBuffer=()=>{throw Error('Whole File read forbidden');};d.apply({kind:'clone',node:'op:0:0',side:'after'});const result=await exportEditWorkspace(index,file,snapshot,d.commands);assert.equal(result.ranges.length,2);assert.equal((await result.blob.text()).split(hex).length-1,2);const after=await parseMLIRFile(result.blob,{metadata:mm});assert.deepEqual(validateMLIR(after).diagnostics,[]);assert.equal(after.mlir.payloads.length,2);
});
