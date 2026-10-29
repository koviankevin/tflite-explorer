import {test} from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {readFile} from 'node:fs/promises';
import {runtimeLoopFixture} from './runtime-loop-fixture.mjs';
import {parseModel} from '../src/model-engine.js';
import {runtimePlan} from '../src/tflite-runtime-policy.js';

test('finite and in-kernel watchdog fixtures differ only in one constant BOOL byte',async()=>{
    const a=await runtimeLoopFixture(false),b=await runtimeLoopFixture(true);assert.equal(a.bytes.length,b.bytes.length);assert.ok(a.bytes.length<8192);
    const changed=[];for(let i=0;i<a.bytes.length;i++)if(a.bytes[i]!==b.bytes[i])changed.push(i);assert.equal(changed.length,1);assert.equal(a.bytes[changed[0]],0);assert.equal(b.bytes[changed[0]],1);
    const metadata=JSON.parse(await readFile(new URL('../vendor/netron/tflite-metadata.json',import.meta.url),'utf8'));
    for(const f of [a,b]){
        const parsed=await parseModel((o,n)=>f.bytes.subarray(o,o+n),f.bytes.length,metadata),m=parsed.raw,p=runtimePlan(m,f.bytes.length);assert.equal(p.eligible,true,p.reason);assert.equal(p.controlFlow,true);assert.deepEqual(p.inputs.map(t=>[t.dtype,t.shape]),[['float32',[1]]]);assert.deepEqual(p.outputs.map(t=>[t.dtype,t.shape]),[['float32',[1]]]);assert.equal(m.subgraphs.length,3);assert.equal(m.subgraphs[0].operators[0].builtin_options.cond_subgraph_index,1);assert.equal(m.subgraphs[0].operators[0].builtin_options.body_subgraph_index,2);assert.equal(m.subgraphs[1].operators.length,0);assert.equal(m.subgraphs[1].tensors[1].type,6);
    }
    await assert.rejects(()=>runtimeLoopFixture(1),/explicit boolean/);
});

test('actual CPU WHILE false-predicate control returns the supplied input; child has an external hard timeout',()=>{
    const output=execFileSync(process.execPath,[fileURLToPath(new URL('./helpers/runtime-loop-finite-reference.mjs',import.meta.url)),'--finite-reference'],{encoding:'utf8',windowsHide:true,timeout:15000,maxBuffer:1024**2});const result=JSON.parse(output.trim());assert.equal(result.status,'passed',JSON.stringify(result));assert.equal(result.compiled,true);assert.equal(result.invoked,true);assert.deepEqual(result.output,[7]);assert.match(result.modelSHA256,/^[a-f0-9]{64}$/);assert.doesNotMatch(result.diagnostics.join('\n'),/ERROR|Failed to allocate/);
});
