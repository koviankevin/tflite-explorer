import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
import vm from 'node:vm';
import {runtimeFixture} from './runtime-fixture.mjs';
import {tflite as s} from '../vendor/netron/tflite-schema.js';
import {FlatbufferWriter} from '../src/flatbuffer-writer.js';
import {parseModel} from '../src/model-engine.js';
import {validateTfliteConstants} from '../src/tflite-constant-checks.js';
import {roundTripReadStats} from '../src/blob-memory-parts.js';
import {editTfliteModel,prepareTfliteModelEdit} from '../src/tflite-model-edit.js';
import {inferTfliteOutputs} from '../src/tflite-shape-inference.js';
import {createModelEditReport} from '../src/model-edit-report.js';
import {executeRuntime} from '../src/tflite-runtime-execute.js';
import {runtimePlan} from '../src/tflite-runtime-policy.js';
import {Archive} from '../vendor/netron/zip.js';
const metadata=JSON.parse(await readFile(new URL('../vendor/netron/tflite-metadata.json',import.meta.url),'utf8'));
async function candidate(name,values,output,options={},input=[2,3],valueType=2,operandShape=[values?.length??0]){
    const {model}=await runtimeFixture({inputShapes:[input,operandShape],outputShape:output}),g=model.subgraphs[0];
    model.operator_codes[0].builtin_code=s.BuiltinOperator[name];model.operator_codes[0].deprecated_builtin_code=s.BuiltinOperator[name];
    if(values===null)g.operators[0].inputs=Int32Array.of(0);
    else{
        const width=valueType===4?8:4,bytes=new Uint8Array(values.length*width),dv=new DataView(bytes.buffer);values.forEach((v,i)=>valueType===4?dv.setBigInt64(i*8,BigInt(v),true):dv.setInt32(i*4,v,true));
        model.buffers.push({data:bytes,offset:0n,size:0n});Object.assign(g.tensors[1],{buffer:1,type:valueType});
    }
    g.inputs=Int32Array.of(0);g.operators[0].builtin_options=options;
    const blob=new FlatbufferWriter().finish(model,new Blob()),raw=new Uint8Array(await blob.arrayBuffer()),index=await parseModel((o,n)=>raw.subarray(o,o+n),raw.length,metadata);
    return {index,blob,model:index.raw,stats:index.stats,fileBytes:raw.length,read:(o,n)=>raw.subarray(o,o+n)};
}
test('round-trip accounting includes the actual constant read bytes after candidate parsing',async()=>{
    const c=await candidate('TRANSPOSE',[1,0],[3,2],null);let actualConstantReads=0;
    const proof=validateTfliteConstants(c.model,0,(o,n)=>{actualConstantReads+=n;return c.read(o,n);});
    assert.equal(actualConstantReads,8);const stats=roundTripReadStats(c.stats,c.fileBytes,[proof]);assert.equal(stats.bytesRead,c.stats.bytesRead+actualConstantReads);
    assert.equal(stats.parseBytesRead,c.stats.bytesRead);assert.equal(stats.semanticBytesRead,8);assert.equal(stats.fileBytes,c.fileBytes);
});
test('in-memory constant inspection is not reported as a file read and malformed totals fail closed',async()=>{
    const c=await candidate('TRANSPOSE',[1,0],[3,2],null),buffer=c.model.buffers[c.model.subgraphs[0].tensors[1].buffer];buffer.data=c.read(Number(buffer.offset),Number(buffer.size));buffer.size=0n;
    const proof=validateTfliteConstants(c.model,0,()=>assert.fail('inline memory must not invoke the File reader'));assert.equal(proof.bytesRead,0);assert.equal(proof.inspectedBytes,8);assert.equal(proof.checked,1);
    assert.equal(roundTripReadStats(c.stats,c.fileBytes,[proof]).bytesRead,c.stats.bytesRead);
    assert.throws(()=>roundTripReadStats(c.stats,c.fileBytes,[{bytesRead:-1}]),/統計無效/);assert.throws(()=>roundTripReadStats(c.stats,c.fileBytes,[{bytesRead:NaN}]),/統計無效/);
});
for(const [name,v,output,options]of [['TRANSPOSE',[1,0],[3,2],null],['RESHAPE',[3,-1],[3,2],Object.assign(new s.ReshapeOptions(),{new_shape:[]})],['EXPAND_DIMS',[-1],[2,3,1],null],['GATHER',[0,2],[2,2],Object.assign(new s.GatherOptions(),{axis:1,batch_dims:0})]])test(`${name} validates actual serialized constant bytes`,async()=>{
    const c=await candidate(name,v,output,options);assert.equal(validateTfliteConstants(c.model,0,c.read).checked,1);
    const budgeted=validateTfliteConstants(c.model,0,()=>assert.fail('budget must precede data reads'),{budget:0});assert.equal(budgeted.unchecked,1);
});
for(const [name,v,out,opts]of [['TRANSPOSE',[0,0],[2,3],null],['TRANSPOSE',[1,0],[2,3],null],['RESHAPE',[-1,-1],[2,3],new s.ReshapeOptions()],['GATHER',[3],[2,1],Object.assign(new s.GatherOptions(),{axis:1,batch_dims:0})]])test(`${name} rejects invalid constant ${v}`,async()=>{
    const c=await candidate(name,v,out,opts);assert.throws(()=>validateTfliteConstants(c.model,0,c.read),/Subgraph #0.*OP #0.*tensor #1/);
});

test('TRANSPOSE accepts negative axes without changing the serialized permutation or read budget',async()=>{
    for(const [input,axes,output]of [[[2,3],[-1,0],[3,2]],[[2,3],[1,-2],[3,2]],[[2,3],[-2,-1],[2,3]],[[1],[-1],[1]],[[1,2,3,4],[-4,-2,-3,-1],[1,3,2,4]]]){
        const c=await candidate('TRANSPOSE',axes,output,null,input),before=c.read(0,c.fileBytes).slice();
        const proof=validateTfliteConstants(c.model,0,c.read);assert.equal(proof.checked,1);assert.equal(proof.unchecked,0);assert.equal(proof.bytesRead,axes.length*4);assert.equal(proof.inspectedBytes,axes.length*4);
        assert.deepEqual(c.read(0,c.fileBytes),before,'validation must preserve the original signed constant bytes');
        const skipped=validateTfliteConstants(c.model,0,()=>assert.fail('budget must precede constant reads'),{budget:0});assert.equal(skipped.checked,0);assert.equal(skipped.unchecked,1);
    }
});

test('TRANSPOSE rejects axis aliases after negative normalization and both range boundaries',async()=>{
    for(const [axes,output]of [[[-1,1],[3,3]],[[-2,0],[2,2]],[[-3,0],[3,2]],[[2,0],[3,2]]]){
        const c=await candidate('TRANSPOSE',axes,output,null);assert.throws(()=>validateTfliteConstants(c.model,0,c.read),/Subgraph #0.*OP #0.*tensor #1.*permutation/);
    }
});

test('TRANSPOSE checks the output shape after normalizing negative axes',async()=>{
    const c=await candidate('TRANSPOSE',[-1,0],[2,3],null);
    assert.throws(()=>validateTfliteConstants(c.model,0,c.read),/Subgraph #0.*OP #0.*tensor #1.*output tensor #2 shape/);
});

test('TRANSPOSE rejects int64 permutation metadata before reading constant bytes, including dynamic inputs',async()=>{
    const c=await candidate('TRANSPOSE',[0,1],[1,2],null,[1,2],4),noRead=()=>assert.fail('invalid permutation dtype must fail before reading values');
    assert.throws(()=>validateTfliteConstants(c.model,0,noRead),/Subgraph #0.*OP #0.*tensor #1.*int32/);
    c.model.subgraphs[0].inputs=Int32Array.of(0,1);
    assert.throws(()=>validateTfliteConstants(c.model,0,noRead),/Subgraph #0.*OP #0.*tensor #1.*int32/);
});

test('GATHER continues to inspect valid int64 indices',async()=>{
    const c=await candidate('GATHER',[0,1],[1,2],Object.assign(new s.GatherOptions(),{axis:1,batch_dims:0}),[1,2],4);
    const proof=validateTfliteConstants(c.model,0,c.read);assert.equal(proof.checked,1);assert.equal(proof.bytesRead,16);
});

const reshapeOptions=(...new_shape)=>Object.assign(new s.ReshapeOptions(),{new_shape});

test('RESHAPE rejects fallback options that disagree with the output even when ignored tensor values match',async()=>{
    for(const [dtype,operandShape] of [[4,[2]],[2,[1,2]]]){
        const c=await candidate('RESHAPE',[3,2],[3,2],reshapeOptions(2,3),[2,3],dtype,operandShape);
        assert.throws(()=>validateTfliteConstants(c.model,0,()=>assert.fail('Ignored shape tensor must not be read.')),
            /Subgraph #0.*OP #0 RESHAPE.*output tensor #2.*new_shape.*output shape/);
        assert.throws(()=>prepareTfliteModelEdit(c.index,c.blob,[{graph:0,operators:[{template:0,inputs:[0,1],outputs:[2]}]}]),
            /Subgraph #0.*OP #0.*RESHAPE.*new_shape/);
    }
});

test('RESHAPE validates options-only shapes and legacy scalar options without reading buffers',async()=>{
    for(const [input,options,out] of [[[2,3],reshapeOptions(3,-1),[3,2]],[[1],reshapeOptions(0),[]]]){
        const c=await candidate('RESHAPE',null,out,options,input);
        const proof=validateTfliteConstants(c.model,0,()=>assert.fail('Options require no payload.'),{budget:0});
        assert.equal(proof.operators[0].status,'passed');
        assert.equal(proof.bytesRead,0);
        assert.deepEqual(inferTfliteOutputs('RESHAPE',[{shape:input,type:0}],[{shape:out,type:0}],options).shapes,[out]);
    }
});

test('RESHAPE leaves absent or indistinguishable empty options unverified',async()=>{
    for(const options of [null,reshapeOptions()]){
        const c=await candidate('RESHAPE',null,[],options,[1]);
        const proof=validateTfliteConstants(c.model,0,()=>assert.fail('No readable shape source.'));
        assert.equal(proof.operators[0].status,'not-run');
        assert.match(proof.operators[0].reason,/new_shape/);
    }
});

test('RESHAPE rejects invalid new_shape values despite dynamic input extents',async()=>{
    const c=await candidate('RESHAPE',null,[3,2],reshapeOptions(-1,-1));
    c.model.subgraphs[0].tensors[0].shape_signature=Int32Array.of(-1,3);
    assert.throws(()=>validateTfliteConstants(c.model,0,()=>assert.fail('Options require no payload.')),/RESHAPE.*new_shape.*-1/);
});

test('RESHAPE inspects the int32 vector and reports contradictory options as unverified',async()=>{
    const c=await candidate('RESHAPE',[3,2],[3,2],reshapeOptions(2,3));
    const proof=validateTfliteConstants(c.model,0,c.read);
    assert.equal(proof.checked,0);
    assert.match(proof.operators[0].reason,/shape tensor.*new_shape.*一致/);
    assert.equal(proof.inspectedBytes,8);
});

test('RESHAPE distinguishes literal zero in a shape tensor from legacy scalar options',async()=>{
    const c=await candidate('RESHAPE',[0],[0],null,[0,2]);
    assert.equal(validateTfliteConstants(c.model,0,c.read).checked,1);
    const uncertain=await candidate('RESHAPE',[0,-1],[0,2],null,[0,2]);
    const proof=validateTfliteConstants(uncertain.model,0,uncertain.read);
    assert.equal(proof.operators[0].status,'not-run');
    assert.match(proof.operators[0].reason,/零維度/);
});

test('RESHAPE keeps dynamic shape tensor inputs unverified without falling back to options',async()=>{
    const c=await candidate('RESHAPE',[3,2],[3,2],reshapeOptions(-1,-1));
    c.model.subgraphs[0].inputs=Int32Array.of(0,1);
    const proof=validateTfliteConstants(c.model,0,()=>assert.fail('Runtime input must not be read.'));
    assert.equal(proof.operators[0].status,'not-run');
    assert.match(proof.operators[0].reason,/模型輸入/);
});

test('pinned LiteRT executes edited RESHAPE variants and exposes mismatched shape sources',async()=>{
    const base=new URL('../vendor/litert/2.6.0/',import.meta.url);
    globalThis.self=globalThis;
    globalThis.require=createRequire(import.meta.url);
    globalThis.__dirname=fileURLToPath(base);
    globalThis.importScripts=url=>vm.runInThisContext(readFileSync(new URL(url),'utf8'),{filename:fileURLToPath(url)});
    globalThis.Module={locateFile:name=>fileURLToPath(new URL(name,base))};
    const rt=await import('../vendor/litert/2.6.0/core.js');
    await rt.loadLiteRt(new URL('litert_wasm_compat_internal.js',base).href);
    const run=(blob,model,values)=>executeRuntime({blob,plan:runtimePlan(model,blob.size),rt,specs:[{mode:'bin',file:new File([Float32Array.from(values)],'input.bin')}]});
    try{
        const input=[1,2,3,4,5,6],bad=await candidate('RESHAPE',[3,2],[3,2],reshapeOptions(2,3),[2,3],4);
        const failure=await run(bad.blob,bad.model,input);
        assert.equal(failure.status,'failed');
        assert.match(failure.reason,/shape.*不符/);
        const conflict=await candidate('RESHAPE',[3,2],[3,2],reshapeOptions(2,3));
        assert.equal((await run(conflict.blob,conflict.model,input)).status,'passed');
        const rankTwo=await candidate('RESHAPE',[3,2],[2,3],reshapeOptions(2,3),[2,3],2,[1,2]);
        const rankTwoOriginal=await run(rankTwo.blob,rankTwo.model,input);
        assert.equal(rankTwoOriginal.status,'failed');
        assert.match(rankTwoOriginal.reason,/shape.*不符/);
        for(const [label,c,values,passes,staticPass] of [
            ['legacy-scalar',await candidate('RESHAPE',null,[],reshapeOptions(0),[1]),[7],true,true],
            ['int64-fallback',await candidate('RESHAPE',[3,2],[2,3],reshapeOptions(2,3),[2,3],4),input,true,true],
            ['rank-two-fallback',rankTwo,input,false,false],
            ['vector',await candidate('RESHAPE',[3,2],[3,2],reshapeOptions(3,-1)),input,true,true],
            ['vector-conflict',conflict,input,true,false]
        ]){
            const source=new File([c.blob],'source.tflite'),op=c.model.subgraphs[0].operators[0];
            const exported=editTfliteModel(c.index,source,[{graph:0,operators:[{template:0,inputs:op.inputs,outputs:op.outputs}]}]);
            const raw=new Uint8Array(await exported.blob.arrayBuffer()),read=(o,n)=>raw.subarray(o,o+n);
            const reopened=await parseModel(read,raw.length,metadata);
            const [before,after]=[c.model,reopened.raw].map(model=>model.subgraphs[0].operators[0].builtin_options?.new_shape);
            assert.deepEqual(after,before,label+' options');
            if(op.inputs.length===2){
                const original=c.model.buffers[c.model.subgraphs[0].tensors[1].buffer];
                const written=reopened.raw.buffers[reopened.raw.subgraphs[0].tensors[1].buffer];
                assert.equal(written.size,original.size);
                assert.deepEqual(read(Number(written.offset),Number(written.size)),c.read(Number(original.offset),Number(original.size)),label+' shape tensor bytes');
            }
            exported.semanticValidation=[validateTfliteConstants(reopened.raw,0,read)];
            exported.roundTrip=true;
            const report=createModelEditReport(c.index,source,exported,reopened,{graph:0,node:0,mode:'replace'},{outputName:'edited.tflite'});
            assert.equal(report.summary.operatorSummary.checked,staticPass?1:0,label);
            assert.ok(report.summary.checks.filter(check=>check.id.startsWith('runtime')).every(check=>check.status==='not-run'));
            const result=await run(exported.blob,reopened.raw,values);
            assert.equal(result.status,passes?'passed':'failed',JSON.stringify({
                label,result,inputs:Array.from(op.inputs),sourceOptions:Array.from(op.builtin_options?.new_shape||[]),
                outputOptions:Array.from(reopened.raw.subgraphs[0].operators[0].builtin_options?.new_shape||[])
            }));
            if(!passes){
                assert.ok(reopened.raw.buffers[reopened.raw.subgraphs[0].tensors[1].buffer].offset>0n);
                assert.match(result.reason,/shape.*不符/);
                continue;
            }
            assert.equal(result.invoked,true);
            const zip=result.io.archive instanceof Uint8Array?result.io.archive:new Uint8Array(await result.io.archive.arrayBuffer());
            const output=Archive.open(zip,'zip').entries.get('outputs-0.bin').peek().slice();
            assert.deepEqual(output,new Uint8Array(Float32Array.from(values).buffer));
        }
    }finally{await rt.unloadLiteRt();}
});
