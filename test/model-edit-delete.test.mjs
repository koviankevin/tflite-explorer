import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {compositionFixture} from './composition-fixture.mjs';
import {customFixture} from './custom-fixture.mjs';
import {parseModel} from '../src/model-engine.js';
import {editWorkspaceSnapshot,exportEditWorkspace} from '../src/model-edit-workspace.js';
import {modelEditDraft,editDeletePreview,editIssues} from '../src/model-edit-draft.js';
import {deletionImpact,deletionTypeReason} from '../src/model-edit-delete.js';
import {createEditSession,exportEditSession,parseEditSession,restoreEditSession,editFileFingerprint} from '../src/model-edit-session.js';
import {nextEditRecovery,readEditRecovery} from '../src/edit-recovery-store.js';
import {compositionInterface} from '../src/model-composition-draft.js';
import {FlatbufferWriter} from '../src/flatbuffer-writer.js';
const metadata=JSON.parse(await readFile(new URL('../vendor/netron/tflite-metadata.json',import.meta.url),'utf8'));
const parse=bytes=>parseModel((o,n)=>bytes.subarray(o,o+n),bytes.length,metadata);
async function setup(targets=[0],options={}){const f=await compositionFixture({custom:true}),index=await parse(f.bytes),snapshot=editWorkspaceSnapshot(index,{targets:targets.map(node=>({graph:0,node})),includeNeighbours:false,...options});return {...f,index,snapshot,draft:modelEditDraft(snapshot)};}
const command=(node,from,value)=>({kind:'delete-reconnect',node,replacements:[{from,value}]});
const reopen=async f=>parse(new Uint8Array(await(await exportEditWorkspace(f.index,f.file,f.snapshot,f.draft.commands)).blob.arrayBuffer()));

test('deletion reconnects a consumer outside the workspace, preserving weights and custom options',async()=>{
    const f=await setup(),preview=editDeletePreview(f.draft.state,'op:0:0');assert.equal(preview.outputs[0].suggested,'','ambiguous ADD operands require a choice');
    const impact=deletionImpact(f.index,f.draft.state,'op:0:0');assert.equal(impact[0].uses,1);assert.equal(impact[0].consumers[0].inWorkspace,false);
    f.draft.apply(command('op:0:0','t:0:2','t:0:0'));
    const result=await exportEditWorkspace(f.index,f.file,f.snapshot,f.draft.commands),bytes=new Uint8Array(await result.blob.arrayBuffer()),after=await parse(bytes),g=after.raw.subgraphs[0];
    assert.equal(g.operators.length,3);assert.deepEqual([...g.operators[1].inputs],[0,3]);
    assert.deepEqual([...g.operators[0].custom_options],[0,1,1,2,3,5,8]);
    const buffer=after.raw.buffers[g.tensors[1].buffer];assert.deepEqual([...new Float32Array(bytes.slice(Number(buffer.offset),Number(buffer.offset+buffer.size)).buffer)],[3,4]);
    assert.equal(f.index.raw.subgraphs[0].operators.length,4);assert.equal(f.snapshot.nodes[0].removed,undefined);
});

test('all visible branch uses, model output replacement, undo/redo and restore are atomic',async()=>{
    const f=await setup([0,1,2]),before=JSON.stringify(f.draft.state.nodes);
    f.draft.apply(command('op:0:0','t:0:2','t:0:0'));assert.equal(f.draft.state.nodes.find(n=>n.source.node===2).inputs[0].value,'t:0:0');
    f.draft.undo();assert.equal(JSON.stringify(f.draft.state.nodes),before);f.draft.redo();
    const impact=deletionImpact(f.index,f.draft.state,'op:0:2');assert.deepEqual(impact[0].modelOutputs,[0]);
    f.draft.apply(command('op:0:2','t:0:4','t:0:3'));
    let after=await reopen(f);assert.equal(after.raw.subgraphs[0].operators.length,2);assert.deepEqual([...after.raw.subgraphs[0].outputs],[3]);
    f.draft.apply({kind:'restore',node:'op:0:2'});after=await reopen(f);assert.equal(after.raw.subgraphs[0].operators.length,3);assert.deepEqual([...after.raw.subgraphs[0].outputs],[4]);
    f.draft.apply({kind:'restore',node:'op:0:0'});assert.equal(JSON.stringify(f.draft.state.nodes.map(({removed,boundary,...n})=>n)),before);
});

test('incompatible dtype, shape, quantization and later sources explain rejection and preserve history',async()=>{
    const f=await setup([0,2]),stamp=f.draft.history;
    const v=f.snapshot.values.find(v=>v.id==='t:0:0'),copy=structuredClone(v),sig=JSON.parse(copy.signature);sig.shape=[2];copy.signature=JSON.stringify(sig);
    assert.match(deletionTypeReason(v,copy),/shape 不同.*\[1,2\].*\[2\]/);
    sig.shape=[1,2];sig.type=9;copy.signature=JSON.stringify(sig);assert.match(deletionTypeReason(v,copy),/dtype/);
    sig.type=0;sig.quantization={scale:[.25]};copy.signature=JSON.stringify(sig);assert.match(deletionTypeReason(v,copy),/量化/);
    const bad=structuredClone(f.snapshot);bad.values.find(v=>v.id==='t:0:0').signature=copy.signature;const d=modelEditDraft(bad);
    assert.throws(()=>d.apply(command('op:0:0','t:0:2','t:0:0')),/量化/);assert.equal(d.commands.length,0);
    assert.throws(()=>f.draft.apply(command('op:0:0','t:0:2','t:0:4')),/先於/);assert.deepEqual(f.draft.history,stamp);
});

test('multiple custom outputs can reconnect to compatible constants without reading or inventing payloads',async()=>{
    const fixture=await customFixture();fixture.model.subgraphs[0].tensors[5].type=9;fixture.model.subgraphs[0].tensors[5].quantization=structuredClone(fixture.model.subgraphs[0].tensors[7].quantization);fixture.model.buffers[3].data=Uint8Array.of(3,4);
    const blob=new FlatbufferWriter().finish(fixture.model,new Blob()),index=await parse(new Uint8Array(await blob.arrayBuffer())),file=new File([blob],'custom.tflite'),snapshot=editWorkspaceSnapshot(index,{targets:[{graph:0,node:1},{graph:0,node:2}]}),d=modelEditDraft(snapshot);
    d.apply({kind:'delete-reconnect',node:'op:0:1',replacements:[{from:'t:0:7',value:'t:0:5'},{from:'t:0:8',value:'t:0:5'}]});
    assert.deepEqual(editIssues(d.state),[]);const result=await exportEditWorkspace(index,file,snapshot,d.commands),after=await parse(new Uint8Array(await result.blob.arrayBuffer()));
    assert.deepEqual([...after.raw.subgraphs[0].operators[1].inputs],[5,5]);assert.equal(after.raw.subgraphs[0].tensors[5].quantization.scale[0],.25);
    d.undo();assert.equal(d.state.nodes.find(n=>n.source.node===1).removed,undefined);
});

test('deletion command persists in v4 portable/local recovery and rejects older envelopes',async()=>{
    const f=await setup([0,2]);f.draft.apply(command('op:0:0','t:0:2','t:0:0'));
    const view={selected:'op:0:0',zoom:.5,font:32,left:50,top:60},options={updateSignatures:false},fingerprint=await editFileFingerprint(f.file);
    const document=await createEditSession(f.file,f.snapshot,{history:f.draft.history,view,options},fingerprint);assert.equal(document.version,4);
    const restored=await restoreEditSession(f.index,f.file,parseEditSession(exportEditSession(document)),fingerprint);assert.deepEqual(restored.saved.history,f.draft.history);
    const record=nextEditRecovery(null,{key:'a'.repeat(32),owner:'b'.repeat(32),revision:0,document});assert.equal(readEditRecovery(record).document.version,4);
    const old={...document,version:3};assert.throws(()=>parseEditSession(JSON.stringify(old)),/版本/);
    const malicious=structuredClone(document);malicious.history.commands[0].replacements[0].extra='ignored';assert.throws(()=>parseEditSession(JSON.stringify(malicious)),/格式/);
});

test('composition deletion keeps an explicit output and exports the retained fragments',async()=>{
    const f=await setup([0,1,2],{composition:true});f.draft.apply({kind:'import',node:'op:0:0',nodes:['op:0:0','op:0:1','op:0:2'],label:'branches'});
    f.draft.apply(command('op:0:2','t:0:4','t:0:2'));assert.ok(compositionInterface(f.draft.state).outputs.includes('t:0:2'));
    const after=await reopen(f);assert.equal(after.raw.subgraphs[0].operators.length,2);assert.deepEqual([...after.raw.subgraphs[0].outputs],[2]);
    f.draft.apply({kind:'restore',node:'op:0:2'});assert.deepEqual(compositionInterface(f.draft.state).outputs,['t:0:4']);
});

test('consecutive removals resolve the model output transitively and restoring a producer repairs it',async()=>{
    const f=await setup([0,2]);f.draft.apply(command('op:0:2','t:0:4','t:0:2'));
    assert.deepEqual(deletionImpact(f.index,f.draft.state,'op:0:0')[0].modelOutputs,[0]);
    f.draft.apply(command('op:0:0','t:0:2','t:0:0'));let after=await reopen(f);assert.deepEqual([...after.raw.subgraphs[0].outputs],[0]);
    f.draft.apply({kind:'restore',node:'op:0:0'});after=await reopen(f);assert.deepEqual([...after.raw.subgraphs[0].outputs],[2]);
});

test('signature interface changes require explicit opt-in and are reflected in exported tensor IDs',async()=>{
    const f=await setup([2]);f.index.raw.signature_defs=[{signature_key:'serving_default',subgraph_index:0,inputs:[{name:'input',tensor_index:0}],outputs:[{name:'result',tensor_index:4}]}];
    f.draft.apply(command('op:0:2','t:0:4','t:0:2'));assert.equal(deletionImpact(f.index,modelEditDraft(f.snapshot).state,'op:0:2')[0].signatures,1);
    await assert.rejects(exportEditWorkspace(f.index,f.file,f.snapshot,f.draft.commands),/signature/);
    const result=await exportEditWorkspace(f.index,f.file,f.snapshot,f.draft.commands,{updateSignatures:true}),after=await parse(new Uint8Array(await result.blob.arrayBuffer()));
    assert.equal(after.raw.signature_defs[0].outputs[0].tensor_index,2);assert.deepEqual([...after.raw.subgraphs[0].outputs],[2]);
});

test('fanout preview bounds displayed consumers while export reconnects all 71 input ports',async()=>{
    const fixture=await compositionFixture({custom:true}),g=fixture.model.subgraphs[0];
    for(let i=0;i<70;i++){const tensor=g.tensors.length;g.tensors.push({...g.tensors[2],name:'fanout_'+i});g.operators.push({...g.operators[0],inputs:Int32Array.of(2,1),outputs:Int32Array.of(tensor)});}
    const blob=new FlatbufferWriter().finish(fixture.model,new Blob()),index=await parse(new Uint8Array(await blob.arrayBuffer())),snapshot=editWorkspaceSnapshot(index,{targets:[{graph:0,node:0}],includeNeighbours:false}),draft=modelEditDraft(snapshot),file=new File([blob],'fanout.tflite');
    const impact=deletionImpact(index,draft.state,'op:0:0')[0];assert.equal(impact.uses,71);assert.equal(impact.consumers.length,12);
    draft.apply(command('op:0:0','t:0:2','t:0:0'));const after=await reopen({index,snapshot,draft,file});assert.equal(after.raw.subgraphs[0].operators.filter(op=>op.inputs.includes(2)).length,0);assert.equal(after.raw.subgraphs[0].operators.length,73);
});

test('many-output preview and preferred suggestions do not materialize unrelated candidate metadata',()=>{
    const signature=JSON.stringify({type:0,shape:[2]}),values=new Map();
    for(let i=0;i<4096;i++){const v={id:`t:0:${i}`,name:'v'+i,type:'FLOAT32 [2]',signature,graph:0,order:-1,producer:i>=512&&i<1024?'op:0:0':null};if(i>=1024)Object.defineProperty(v,'signature',{get(){throw Error('Unrelated candidate metadata was eagerly read.');}});values.set(v.id,v);}
    const node={id:'op:0:0',source:{graph:0,node:0},name:'large.custom',removable:true,ordered:true,inputs:Array.from({length:512},(_,i)=>({value:`t:0:${i}`})),outputs:Array.from({length:512},(_,i)=>({value:`t:0:${i+512}`}))};
    const preview=editDeletePreview({format:'tflite',nodes:[node],values},node.id);assert.equal(preview.outputs.length,512);
    assert.ok(preview.outputs.every(o=>o.suggested===''));assert.equal(preview.outputs[0].choice('t:0:1').reason,'');
});

test('reconnecting one model output to another preserves both output slots and signature names',async()=>{
    const f=await setup([2]);f.index.raw.subgraphs[0].outputs=Int32Array.of(4,3);f.index.raw.signature_defs=[{signature_key:'serving_default',subgraph_index:0,inputs:[{name:'input',tensor_index:0}],outputs:[{name:'result',tensor_index:4},{name:'branch',tensor_index:3}]}];
    f.draft.apply(command('op:0:2','t:0:4','t:0:3'));const result=await exportEditWorkspace(f.index,f.file,f.snapshot,f.draft.commands,{updateSignatures:true}),after=await parse(new Uint8Array(await result.blob.arrayBuffer()));
    assert.deepEqual([...after.raw.subgraphs[0].outputs],[3,3]);assert.deepEqual(after.raw.signature_defs[0].outputs.map(p=>[p.name,p.tensor_index]),[['result',3],['branch',3]]);
});

test('signature-only tensor bindings fail automatic reconnect explicitly and static export rejects invalid bindings',async()=>{
    const f=await setup([0]);f.index.raw.signature_defs=[{signature_key:'alternate',subgraph_index:0,inputs:[{name:'input',tensor_index:0}],outputs:[{name:'internal',tensor_index:2}]}];
    assert.equal(deletionImpact(f.index,f.draft.state,'op:0:0')[0].signaturesOutsideOutputs,1);
    f.draft.apply(command('op:0:0','t:0:2','t:0:0'));await assert.rejects(exportEditWorkspace(f.index,f.file,f.snapshot,f.draft.commands,{updateSignatures:true}),/Signature 使用了子圖 outputs 之外/);
    f.draft.undo();f.draft.apply({kind:'remove',node:'op:0:0',boundary:true});await assert.rejects(exportEditWorkspace(f.index,f.file,f.snapshot,f.draft.commands,{updateSignatures:true}),/outputs tensor #2 不在模型介面/);
});

test('deleting an exposed clone can keep a generated constant as a model output',async()=>{
    const f=await setup();f.draft.apply({kind:'clone',node:'op:0:0',side:'after'});f.draft.apply({kind:'random',node:'new:1',slot:1,like:'t:0:1',seed:123,min:-1,max:1});f.draft.apply({kind:'expose',node:'new:1',enabled:true});
    assert.throws(()=>f.draft.apply({kind:'delete-reconnect',node:'new:1',replacements:[]}),/模型輸出必須/);
    f.draft.apply(command('new:1','new:1:out:0','const:1'));const after=await reopen(f),g=after.raw.subgraphs[0];
    assert.equal(g.operators.length,4);assert.equal(g.outputs.length,2);assert.equal(g.outputs[0],4);
    const tensor=g.tensors[g.outputs[1]],buffer=after.raw.buffers[tensor.buffer];assert.equal(Number(buffer.size),8);assert.deepEqual([...tensor.shape],[1,2]);
});

test('composition output bypass can expose a model input without adding unintended dangling outputs',async()=>{
    const f=await setup([0,1,2],{composition:true});f.draft.apply({kind:'import',node:'op:0:0',nodes:['op:0:0','op:0:1','op:0:2'],label:'branches'});
    f.draft.apply(command('op:0:2','t:0:4','t:0:0'));assert.deepEqual(compositionInterface(f.draft.state).outputs,['t:0:0']);
    const after=await reopen(f);assert.equal(after.raw.subgraphs[0].operators.length,2);assert.deepEqual([...after.raw.subgraphs[0].outputs],[0]);assert.ok(after.raw.subgraphs[0].inputs.includes(0));
    f.draft.undo();assert.deepEqual(compositionInterface(f.draft.state).outputs,['t:0:4']);
});
