import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {runtimeFixture} from './runtime-fixture.mjs';
import {tflite as s} from '../vendor/netron/tflite-schema.js';
import {FlatbufferWriter} from '../src/flatbuffer-writer.js';
import {parseModel} from '../src/model-engine.js';
import {validateTfliteConstants} from '../src/tflite-constant-checks.js';
import {roundTripReadStats} from '../src/blob-memory-parts.js';
const metadata=JSON.parse(await readFile(new URL('../vendor/netron/tflite-metadata.json',import.meta.url),'utf8'));
async function candidate(name,values,output,options={},input=[2,3]){
    const {model}=await runtimeFixture({inputShapes:[input,[values.length]],outputShape:output}),g=model.subgraphs[0];
    model.operator_codes[0].builtin_code=s.BuiltinOperator[name];model.operator_codes[0].deprecated_builtin_code=s.BuiltinOperator[name];
    const bytes=new Uint8Array(values.length*4),dv=new DataView(bytes.buffer);values.forEach((v,i)=>dv.setInt32(i*4,v,true));
    model.buffers.push({data:bytes,offset:0n,size:0n});Object.assign(g.tensors[1],{buffer:1,type:2});g.inputs=Int32Array.of(0);g.operators[0].builtin_options=options;
    const blob=new FlatbufferWriter().finish(model,new Blob()),raw=new Uint8Array(await blob.arrayBuffer()),index=await parseModel((o,n)=>raw.subarray(o,o+n),raw.length,metadata);
    return {model:index.raw,stats:index.stats,fileBytes:raw.length,read:(o,n)=>raw.subarray(o,o+n)};
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
