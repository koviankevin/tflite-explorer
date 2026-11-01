import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {prepareTfliteModelEdit,editTfliteModel,validateTfliteModelGraph} from '../src/tflite-model-edit.js';
import {validateTfliteConstants} from '../src/tflite-constant-checks.js';
import {parseModel} from '../src/model-engine.js';
import {checkOperatorMetadata} from '../src/tflite-semantic-checks.js';
import {exportTflite} from '../src/tflite-export.js';
import {editWorkspaceSnapshot,exportEditWorkspace} from '../src/model-edit-workspace.js';
import {modelEditDraft} from '../src/model-edit-draft.js';
import {gatherFixture as fixture} from './gather-fixture.mjs';
const t=(shape,type=0,extra={})=>({shape,type,has_rank:true,...extra});
const dynamic=t([2,3],0,{shape_signature:[-1,3]});
const plan=[{graph:0,operators:[{template:0,inputs:[0,1],outputs:[2]}]}];
const invalid=[
    ['dynamic-params-result-dtype',{params:dynamic,output:t([2,2],2)},/GATHER.*dtype/],
    ['dynamic-result-dtype',{output:t([2,2],2,{shape_signature:[-1,2]})},/GATHER.*dtype/],
    ['floating-indices',{params:dynamic,indices:{shape:[2],type:0,values:[0,1]}},/GATHER.*indices/],
    ['invalid-axis',{params:dynamic,options:{axis:2}},/GATHER.*rank/],
    ['invalid-batch',{params:dynamic,options:{batch_dims:2}},/GATHER.*rank/],
    ['scalar-params',{params:t([]),output:t([],0,{has_rank:false}),options:{axis:0}},/GATHER.*rank/]
];

test('legal dynamic GATHER remains editable and explicitly unverified without reading constants',async()=>{
    const f=await fixture({params:dynamic,output:t([2,2],0,{shape_signature:[-1,2]})});
    assert.doesNotThrow(()=>prepareTfliteModelEdit(f.index,f.file,plan));
    const p=validateTfliteConstants(f.model,0,()=>assert.fail('Unknown extents must not trigger speculative reads.'));
    assert.equal(p.checked,0);assert.equal(p.unchecked,1);assert.equal(p.operators[0].status,'not-run');assert.match(p.operators[0].reason,/動態|未知/);
});

test('concrete GATHER dtype error remains rejected as the control',async()=>{
    const f=await fixture({output:t([2,2],2)});
    assert.throws(()=>prepareTfliteModelEdit(f.index,f.file,plan),/GATHER.*dtype/);
});

for(const [name,spec,error] of invalid){
    test(`GATHER actual edit independently refuses ${name}`,async()=>{
        const f=await fixture(spec);
        assert.throws(()=>prepareTfliteModelEdit(f.index,f.file,plan),reason=>/Subgraph #0.*OP #0.*inputs \[0, 1\].*outputs \[2\]/.test(reason.message)&&error.test(reason.message));
    });
    test(`GATHER serialized report independently refuses ${name} before any constant read`,async()=>{
        const f=await fixture(spec);
        assert.throws(()=>validateTfliteConstants(f.model,0,()=>assert.fail('Invalid metadata must precede data reads.')),reason=>/Subgraph #0.*OP #0 GATHER.*inputs tensor \[0, 1\].*outputs tensor \[2\]/.test(reason.message)&&error.test(reason.message));
    });
}

test('GATHER accepts negative axis, batch prefixes, scalar indices and empty indices without rewriting weights',async()=>{
    const metadata=JSON.parse(await readFile(new URL('../vendor/netron/tflite-metadata.json',import.meta.url),'utf8'));
    const specs=[
        {options:{axis:-1}},
        {indices:{shape:[2],type:4,values:[0,2]}},
        {indices:{shape:[2],type:7,values:[0,2]}},
        {indices:{shape:[],type:2,values:[1]},output:t([2])},
        {indices:{shape:[0],type:2,values:[]},output:t([2,0])},
        {params:t([2,2,3]),indices:{shape:[2,2],type:2,values:[0,2,1,0]},output:t([2,2,2]),options:{axis:-1,batch_dims:-1}},
        {params:t([2,2,3]),indices:{shape:[2,2],type:2,values:[1,2,0,1]},output:t([2,2]),options:{axis:2,batch_dims:2}},
        {params:t([2,3],0,{has_rank:false})}
    ];
    for(const spec of specs){
        const f=await fixture(spec),edited=editTfliteModel(f.index,f.file,plan),bytes=new Uint8Array(await edited.blob.arrayBuffer()),read=(o,n)=>bytes.subarray(o,o+n),r=await parseModel(read,bytes.length,metadata);
        const a=f.model.subgraphs[0],b=r.raw.subgraphs[0];
        assert.deepEqual(b.tensors.map(t=>[t.type,Array.from(t.shape),Array.from(t.shape_signature),t.has_rank]),a.tensors.map(t=>[t.type,Array.from(t.shape),Array.from(t.shape_signature),t.has_rank]));
        assert.deepEqual(b.operators[0].inputs,a.operators[0].inputs);assert.deepEqual(b.operators[0].outputs,a.operators[0].outputs);assert.deepEqual(b.operators[0].builtin_options,a.operators[0].builtin_options);
        for(const [id,buffer] of f.model.buffers.entries())if(buffer.size){const next=r.raw.buffers[id];assert.deepEqual(read(Number(next.offset),Number(next.size)),f.read(Number(buffer.offset),Number(buffer.size)));}
        const p=validateTfliteConstants(r.raw,0,read);assert.equal(p.checked,1);assert.equal(p.unchecked,0);assert.equal(p.operators[0].status,'passed');assert.match(p.operators[0].reason,/dtype.*batch_dims.*shape.*indices/);
        const budgeted=validateTfliteConstants(r.raw,0,()=>assert.fail('Zero budget must precede reads.'),{budget:0});assert.equal(budgeted.unchecked,spec.indices?.values?.length===0?0:1);
    }
});

test('GATHER compares output rank with known input ranks even when extents are dynamic',async()=>{
    const f=await fixture({params:dynamic,output:t([2,2,1],0,{shape_signature:[-1,2,1]})});
    assert.throws(()=>prepareTfliteModelEdit(f.index,f.file,plan),/GATHER.*output rank/);
    assert.throws(()=>validateTfliteConstants(f.model,0,()=>assert.fail('No reads for wrong rank.')),/GATHER.*output rank/);
});

test('GATHER preserves unknown rank and unsupported params dtype as explicit not-run results',async()=>{
    for(const [spec,reason] of [[{params:t([],0,{has_rank:false}),options:{axis:-1}},/動態|未知/],[{params:t([2,3],8),output:t([2,2],8)},/dtype/]]){
        const f=await fixture(spec);assert.doesNotThrow(()=>prepareTfliteModelEdit(f.index,f.file,plan));
        const p=validateTfliteConstants(f.model,0,()=>assert.fail('Unknown metadata must not read payloads.'));
        assert.equal(p.checked,0);assert.equal(p.unchecked,1);assert.equal(p.operators[0].status,'not-run');assert.match(p.operators[0].reason,reason);
    }
});

test('GATHER rejects invalid batch prefixes and index values with the serialized tensor context',async()=>{
    const badPrefix=await fixture({params:t([2,2,3]),indices:{shape:[1,2],type:2,values:[0,1]},output:t([2,2,2]),options:{axis:2,batch_dims:1}});
    assert.throws(()=>prepareTfliteModelEdit(badPrefix.index,badPrefix.file,plan),/GATHER.*batch_dims/);
    for(const values of [[-1],[3]]){
        const f=await fixture({indices:{shape:[1],type:4,values},output:t([2,1])});
        assert.throws(()=>validateTfliteConstants(f.model,0,f.read),/Subgraph #0.*OP #0 GATHER.*tensor #1.*indices/);
    }
});

test('GATHER validates option integers and arity without needing static dimensions',()=>{
    const indices=t([2],2),out=t([2,2]);
    for(const options of [{axis:0.5},{batch_dims:0.5},{axis:2147483648},{batch_dims:-2147483649}])assert.throws(()=>checkOperatorMetadata('GATHER',[dynamic,indices],[out],options),/GATHER.*int32/);
    assert.throws(()=>checkOperatorMetadata('GATHER',[dynamic],[out],{}),/GATHER.*2.*1/);
});

test('empty GATHER indices require a present non-default constant buffer and known zero shape',async()=>{
    for(const kind of ['default-buffer','absent-data','nonzero-shape','unknown-shape']){
        const f=await fixture({indices:{shape:[0],type:2,values:[]},output:t([2,0])}),g=f.model.subgraphs[0],indices=g.tensors[1];
        if(kind==='default-buffer')indices.buffer=0;
        if(kind==='absent-data')f.model.buffers[indices.buffer].data=null;
        if(kind==='nonzero-shape'){indices.shape=Int32Array.of(1);g.tensors[2].shape=Int32Array.of(2,1);}
        if(kind==='unknown-shape')indices.shape_signature=Int32Array.of(-1);
        assert.throws(()=>prepareTfliteModelEdit(f.index,f.file,plan),/OP #0.*tensor #1.*producer/);
    }
});

test('empty GATHER constants stay constants through submodel and composition exports',async()=>{
    const metadata=JSON.parse(await readFile(new URL('../vendor/netron/tflite-metadata.json',import.meta.url),'utf8'));
    const f=await fixture({indices:{shape:[0],type:2,values:[]},output:t([2,0])});
    const snapshot=editWorkspaceSnapshot(f.index,{targets:[{graph:0,node:0}],composition:true}),draft=modelEditDraft(snapshot);
    draft.apply({kind:'import',node:'op:0:0',nodes:['op:0:0'],label:'public empty Gather'});
    const results=[exportTflite(f.index,0,[0],f.file),await exportEditWorkspace(f.index,f.file,snapshot,draft.commands)];
    for(const result of results){
        const bytes=new Uint8Array(await result.blob.arrayBuffer()),read=(o,n)=>bytes.subarray(o,o+n),r=await parseModel(read,bytes.length,metadata),g=r.raw.subgraphs[0],indices=g.tensors[g.operators[0].inputs[1]],b=r.raw.buffers[indices.buffer];
        assert.equal(g.inputs.length,1,'constant must not turn into another required model input');
        assert.ok(indices.buffer>0);assert.ok(b.data instanceof Uint8Array);assert.equal(b.data.length,0);
        assert.equal(validateTfliteConstants(r.raw,0,read).checked,1);
    }
});

test('zero-byte string, opaque and sparse tensors never gain a producer from their shape',async()=>{
    for(const extra of [{type:5},{type:13},{type:14},{sparsity:{}}]){
        const f=await fixture({indices:{shape:[0],type:2,values:[]},output:t([2,0])});
        Object.assign(f.model.subgraphs[0].tensors[1],extra);
        assert.throws(()=>validateTfliteModelGraph(f.model,0),/OP #0.*tensor #1.*producer/);
    }
});
