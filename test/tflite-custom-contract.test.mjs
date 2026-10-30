import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {flexScalarMap} from '../src/flex-scalar-map.js';
import {BinaryReader as FlexReader} from '../vendor/netron/flexbuffers.js';
import {validateCustomContracts,customOptionReferences} from '../src/tflite-custom-contract.js';
import {planTfliteReferences} from '../src/tflite-reference-plan.js';
import {exportTflite} from '../src/tflite-export.js';
import {tfliteExportPreview} from '../src/tflite-export-preview.js';
import {parseModel} from '../src/model-engine.js';
import {FlatbufferWriter} from '../src/flatbuffer-writer.js';
import {customFixture} from './custom-fixture.mjs';
import {flexScalarFixture,detectionOptions} from './flex-scalar-fixture.mjs';
import {editWorkspaceSnapshot} from '../src/model-edit-workspace.js';
import {modelEditDraft,editChanges} from '../src/model-edit-draft.js';
import {exportComposition} from '../src/tflite-composition-export.js';
import {detectionPostprocessFixture} from './detection-postprocess-fixture.mjs';
import {tflite as schema} from '../vendor/netron/tflite-schema.js';
import {createExportReport} from '../src/export-report.js';
const metadata=JSON.parse(await readFile(new URL('../vendor/netron/tflite-metadata.json',import.meta.url),'utf8'));
const parse=b=>parseModel((o,n)=>b.subarray(o,o+n),b.length,metadata);
const contract={interfaceVersion:1,customCode:'InternalSplitFoo',versionMin:3,versionMax:3,coverage:'local-ports-options-only',options:{format:'fixed-u32-le',byteLength:8,prefix:[80,82,69,70],references:[{offset:4,kind:'tensor'}]}};
async function fixture({reference=0,metadataOpaque=false,external=false}={}){
    const options=Uint8Array.of(80,82,69,70,0,0,0,0);new DataView(options.buffer).setUint32(4,reference,true);
    const f=await customFixture({optionBytes:options,external});
    if(!metadataOpaque){f.model.metadata=[];f.model.metadata_buffer=[];}
    if(external)return {...f,index:await parse(f.bytes),file:new File([f.bytes],'custom.tflite')};
    const blob=new FlatbufferWriter().finish(f.model,new Blob()),bytes=new Uint8Array(await blob.arrayBuffer());return {...f,bytes,index:await parse(bytes),file:new File([blob],'custom.tflite')};
}
test('bounded FlexBuffers scalar maps agree with independent Netron decoder and refuse recursive/oversized layouts',()=>{
    const data=flexScalarFixture({a:3,b:-2,c:.5,d:true});assert.deepEqual({...flexScalarMap(data)},FlexReader.open(data).read());assert.equal(flexScalarMap(new Uint8Array(65537)),null);
    const malicious=data.slice();malicious[malicious.length-2]=10<<2;assert.equal(flexScalarMap(malicious),null);assert.equal(flexScalarMap(Uint8Array.of(0,38,0)),null);
});
test('contract registration is bounded, immutable, rejects overlap and never accepts executable hooks',()=>{
    const list=validateCustomContracts([contract]);assert.ok(Object.isFrozen(list)&&Object.isFrozen(list[0].options.references));assert.throws(()=>validateCustomContracts([contract,contract]),/重複/);
    assert.throws(()=>validateCustomContracts([{...contract,describeReferences(){}}]),/無效/);assert.throws(()=>validateCustomContracts([{...contract,options:{...contract.options,references:[{offset:7,kind:'tensor'}]}}]),/無效/);
    const data=Uint8Array.of(80,82,69,70,7,0,0,0);assert.deepEqual(customOptionReferences(list[0],{custom_options:data}),[{kind:'tensor',id:7}]);assert.equal(customOptionReferences(list[0],{custom_options:data,customOptionsDeferred:true}),null);
});
test('shared reference plan retains implicit tensor weights and rejects invalid matched references',async()=>{
    const f=await fixture(),p=planTfliteReferences(f.index.raw,0,[1],{customContracts:[contract]});assert.equal(p.mode,'custom-contract');assert.ok(p.usedTensors.includes(0));assert.ok(p.bufferDataIds.includes(1)&&p.bufferDataIds.includes(3));assert.ok(p.elidedBuffers.includes(2));
    const bad=await fixture({reference:999});assert.throws(()=>planTfliteReferences(bad.index.raw,0,[1],{customContracts:[contract]}),/OP #1.*tensor #999/);
    const opaque=await fixture({metadataOpaque:true});assert.equal(planTfliteReferences(opaque.index.raw,0,[1],{customContracts:[contract]}).mode,'custom-opaque');
    const version=structuredClone(f.index.raw);version.operator_codes[1].version=4;assert.equal(planTfliteReferences(version,0,[1],{customContracts:[contract]}).mode,'custom-opaque');
});
test('actual cut and preview share contract references while preserving IDs, options and required bytes',async()=>{
    const f=await fixture(),preview=tfliteExportPreview(f.index,0,[1],{customContracts:[contract]}),result=exportTflite(f.index,0,[1],f.file,{customContracts:[contract]});
    assert.equal(preview.referenceMode,'custom-contract');assert.equal(result.referencePlan.mode,'custom-contract');
    const bytes=new Uint8Array(await result.blob.arrayBuffer()),after=await parse(bytes);assert.equal(after.raw.buffers.length,f.index.raw.buffers.length);assert.equal(after.raw.subgraphs[0].tensors.length,10);
    assert.equal(after.raw.buffers[2].size,0n);assert.equal(after.raw.buffers[2].data,null);assert.deepEqual([...after.raw.subgraphs[0].operators[0].custom_options],[...f.options]);
    for(const id of [1,3]){const before=f.index.raw.buffers[id],retained=after.raw.buffers[id];assert.deepEqual(bytes.subarray(Number(retained.offset),Number(retained.offset+retained.size)),f.bytes.subarray(Number(before.offset),Number(before.offset+before.size)));}
    const retained=after.raw.buffers.reduce((n,b)=>n+Number(b.size),0);assert.equal(retained,preview.retainedBytes);assert.equal(result.preservedIds,true);
});
test('public Detection PostProcess contract recognizes only its closed scalar options format',async()=>{
    const f=await fixture(),m=f.model;m.operator_codes[1].custom_code='TFLite_Detection_PostProcess';m.operator_codes[1].version=1;const op=m.subgraphs[0].operators[1];op.inputs=Int32Array.of(4,5,6);op.outputs=Int32Array.of(6,7,8,9);op.custom_options=detectionOptions();op.custom_options_format=0;
    const blob=new FlatbufferWriter().finish(m,new Blob()),bytes=new Uint8Array(await blob.arrayBuffer()),index=await parse(bytes),p=planTfliteReferences(index.raw,0,[1]);assert.equal(p.mode,'custom-contract');assert.ok(p.elidedBuffers.includes(1));
    const unknown=structuredClone(index.raw);unknown.subgraphs[0].operators[1].custom_options=flexScalarFixture({unexpected_buffer:1});assert.equal(planTfliteReferences(unknown,0,[1]).mode,'custom-opaque');
});
test('contracts preserve optional sentinels and explicit buffer references; opaque or external options cannot opt in',async()=>{
    const f=await fixture(),bufferFixture=await fixture({reference:2}),c={...contract,options:{...contract.options,references:[{offset:4,kind:'buffer'}]}};
    const plan=planTfliteReferences(bufferFixture.index.raw,0,[1],{customContracts:[c]});assert.ok(plan.bufferDataIds.includes(2)&&plan.elidedBuffers.includes(1));
    const invalid=await fixture({reference:999});assert.throws(()=>planTfliteReferences(invalid.index.raw,0,[1],{customContracts:[c]}),/buffer #999/);
    const optional=validateCustomContracts([{...contract,options:{...contract.options,references:[{offset:4,kind:'tensor',optional:true}]}}])[0];assert.deepEqual(customOptionReferences(optional,{custom_options:Uint8Array.of(80,82,69,70,255,255,255,255)}),[]);
    const external=await fixture({external:true});external.index.raw.metadata=[];external.index.raw.metadata_buffer=[];assert.equal(planTfliteReferences(external.index.raw,0,[1],{customContracts:[contract]}).mode,'custom-opaque');
    const other=structuredClone(f.index.raw);other.subgraphs[0].operators[1].custom_options[0]=0;assert.equal(planTfliteReferences(other,0,[1],{customContracts:[contract]}).mode,'custom-opaque');
    f.index.raw.tfliteCustomContracts=[contract];assert.equal(planTfliteReferences(f.index.raw,0,[1]).mode,'custom-opaque','model-supplied registration is ignored');
});
test('public default contract prunes unrelated weights in cuts/composition, retains anchors/options and survives repeated reopen',async()=>{
    const f=detectionPostprocessFixture(),bytes=new Uint8Array(await f.blob.arrayBuffer()),index=await parse(bytes),preview=tfliteExportPreview(index,0,[0]);
    assert.equal(preview.referenceMode,'custom-contract');assert.equal(preview.retainedBytes,64);let current=index,file=f.file;
    for(let i=0;i<3;i++){
        const result=exportTflite(current,0,[0],file),out=new Uint8Array(await result.blob.arrayBuffer()),again=await parse(out);assert.ok(out.length<65536);assert.equal(again.raw.buffers.length,3);assert.equal(again.raw.subgraphs[0].tensors.length,8);assert.equal(again.raw.buffers[2].data,null);assert.deepEqual([...again.raw.subgraphs[0].operators[0].custom_options],[...f.options]);
        const b=again.raw.buffers[1];assert.deepEqual(out.subarray(Number(b.offset),Number(b.offset+b.size)),f.anchors);current=again;file=new File([out],'reopened.tflite');
    }
    const snapshot=editWorkspaceSnapshot(index,{targets:[{graph:0,node:0}],composition:true}),draft=modelEditDraft(snapshot);draft.apply({kind:'import',node:'op:0:0',nodes:['op:0:0'],label:'public detection'});
    const result=exportComposition(index,f.file,draft.state,editChanges(snapshot,draft.state));assert.equal(result.referencePlan.mode,'custom-contract');assert.ok(result.blob.size<65536);
    const unknown=detectionPostprocessFixture({version:2}),u=await parse(new Uint8Array(await unknown.blob.arrayBuffer()));assert.equal(tfliteExportPreview(u,0,[0]).referenceMode,'custom-opaque');assert.ok(exportTflite(u,0,[0],unknown.file).blob.size>512*1024);
});
test('large unreferenced data is cleared without even slicing it; unknown contracts still retain it',async()=>{
    const f=await fixture();f.model.buffers.push({data:new Uint8Array(2*1024**2),offset:0n,size:0n});
    const blob=new FlatbufferWriter().finish(f.model,new Blob()),bytes=new Uint8Array(await blob.arrayBuffer()),index=await parse(bytes),last=index.raw.buffers.at(-1),slices=[];
    const file={size:blob.size,slice(start,end){slices.push({start,end});return blob.slice(start,end);}};
    const output=exportTflite(index,0,[1],file,{customContracts:[contract]});assert.ok(output.blob.size<65536);assert.ok(slices.every(s=>s.end<=Number(last.offset)||s.start>=Number(last.offset+last.size)));
    const preview=tfliteExportPreview(index,0,[1],{customContracts:[contract]});assert.equal(preview.referenceMode,'custom-contract');assert.equal(preview.retainedBytes,16);
    const opaque=exportTflite(index,0,[1],blob);assert.ok(opaque.blob.size>2*1024**2);assert.equal(opaque.referencePlan.mode,'custom-opaque');
});
test('composition shares reference planning, retaining hidden constants and creating required hidden boundary inputs',async()=>{
    for(const reference of [0,1]){
        const f=await fixture({reference}),snapshot=editWorkspaceSnapshot(f.index,{targets:[{graph:0,node:1}],composition:true}),draft=modelEditDraft(snapshot);
        draft.apply({kind:'import',node:'op:0:1',nodes:['op:0:1'],label:'custom public fixture'});
        const output=exportComposition(f.index,f.file,draft.state,editChanges(snapshot,draft.state),{customContracts:[contract]}),bytes=new Uint8Array(await output.blob.arrayBuffer()),after=await parse(bytes);
        assert.equal(output.referencePlan.mode,'custom-contract');assert.equal(after.raw.buffers[2].data,null);assert.deepEqual([...after.raw.subgraphs[0].operators[0].custom_options],[...f.options]);
        if(reference===0)assert.equal(after.raw.buffers[1].size,8n);else assert.ok(after.raw.subgraphs[0].inputs.includes(1));
    }
});
test('selected blockwise quantization retains referenced scale/zero-point tensors and payloads without reindexing',async()=>{
    const f=await fixture(),g=f.model.subgraphs[0];
    f.model.buffers.push({data:new Uint8Array(Float32Array.of(.25,.25).buffer),offset:0n,size:0n},{data:Uint8Array.of(0,0),offset:0n,size:0n});
    g.tensors.push({name:'block_scales',type:0,shape:Int32Array.of(2),has_rank:true,buffer:4},{name:'block_zero_points',type:9,shape:Int32Array.of(2),has_rank:true,buffer:5});
    g.tensors[7].quantization.details=Object.assign(new schema.BlockwiseQuantization(),{scales:10,zero_points:11,block_size:1});
    const blob=new FlatbufferWriter().finish(f.model,new Blob()),bytes=new Uint8Array(await blob.arrayBuffer()),index=await parse(bytes),plan=planTfliteReferences(index.raw,0,[1],{customContracts:[contract]});
    assert.ok(plan.bufferDataIds.includes(4)&&plan.bufferDataIds.includes(5));const cut=exportTflite(index,0,[1],blob,{customContracts:[contract]}),out=new Uint8Array(await cut.blob.arrayBuffer()),after=await parse(out);
    assert.equal(after.raw.subgraphs[0].tensors[7].quantization.details.scales,10);assert.equal(after.raw.subgraphs[0].tensors[7].quantization.details.zero_points,11);assert.equal(after.raw.buffers[4].size,8n);assert.equal(after.raw.buffers[5].size,2n);
});
test('downloadable report records contract pruning separately from unverified runtime semantics',async()=>{
    const f=detectionPostprocessFixture(),index=await parse(new Uint8Array(await f.blob.arrayBuffer())),result=exportTflite(index,0,[0],f.file),report=createExportReport(index,f.file,result,{graph:0,nodes:[0],outputName:'cut.tflite'}),json=JSON.parse(await report.blob.text());
    assert.equal(json.preservation.referencePlan.mode,'custom-contract');assert.equal(json.preservation.referencePlan.elidedBufferCount,1);assert.equal(json.checks.find(c=>c.id==='custom-references').status,'passed');assert.equal(json.checks.find(c=>c.id==='runtime-load').status,'not-run');assert.equal(json.checks.find(c=>c.id==='runtime-equivalence').status,'not-run');
});
test('connected public two-OP fixture preserves reshape operands, custom branches and preview bytes',async()=>{
    const f=detectionPostprocessFixture({withReshape:true}),index=await parse(new Uint8Array(await f.blob.arrayBuffer())),preview=tfliteExportPreview(index,0,[0,1]),result=exportTflite(index,0,[0,1],f.file),bytes=new Uint8Array(await result.blob.arrayBuffer()),after=await parse(bytes);
    assert.equal(preview.retainedBytes,72);assert.equal(after.raw.subgraphs[0].operators.length,2);assert.deepEqual([...after.raw.subgraphs[0].operators[1].inputs],[3,9]);assert.deepEqual([...after.raw.subgraphs[0].outputs],[4,5,6,8]);assert.equal(after.raw.buffers[3].size,8n);assert.equal(after.raw.buffers[2].data,null);
});
