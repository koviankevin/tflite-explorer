import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {softmaxCases,softmaxFixture} from './softmax-fixture.mjs';
import {SOFTMAX_EXPECTATIONS,assertSoftmaxProof} from './browser/softmax-proof.mjs';
const proof=()=>({status:'passed',modelWorkers:16,runtimeWorkers:4,downloads:16,allWorkersClosed:true,cases:SOFTMAX_EXPECTATIONS.map(([name,modelSHA256,status,expected])=>({name,modelSHA256,status,...(status==='rejected'?{runtimeWorkers:0,downloads:0,preflight:'subgraph 0 OP #0 SOFTMAX invalid metadata',error:'Subgraph #0 OP #0 SOFTMAX invalid metadata'}:{operators:2,reopened:true,quantizationPreserved:true,byteComparison:'not-applicable',outputSHA256:'a'.repeat(64),automaticRuntime:false,...(expected?{inputsMatch:true,numericMatches:true,zipSHA256:'b'.repeat(64),expected,output:expected}:{} )})}))});
test('Softmax proof rejects absent evidence, changed fixtures, skipped checks and false numerical results',()=>{
    assert.doesNotThrow(()=>assertSoftmaxProof(proof()));assert.throws(()=>assertSoftmaxProof(null));
    for(const mutate of [p=>p.cases.pop(),p=>p.modelWorkers--,p=>p.runtimeWorkers++,p=>p.downloads++,p=>p.allWorkersClosed=false,p=>p.cases[0].modelSHA256='a'.repeat(64),p=>p.cases[0].downloads=1,p=>p.cases[1].runtimeWorkers=1,p=>p.cases[2].preflight='',p=>p.cases[3].status='passed',p=>p.cases[4].output[0]=0,p=>p.cases[4].expected[0]=0,p=>p.cases[5].output[0]=NaN,p=>p.cases[6].automaticRuntime=true,p=>p.cases[7].inputsMatch=false,p=>p.cases[8].status='passed',p=>p.cases[9].quantizationPreserved=false,p=>p.cases[8].outputSHA256='bad']){
        const p=structuredClone(proof());mutate(p);assert.throws(()=>assertSoftmaxProof(p));
    }
});
test('Softmax browser proof fixture hashes bind the independently generated FlatBuffers',async()=>{
    const invalid=[];for(const name of ['SOFTMAX','LOG_SOFTMAX'])for(const [suffix,options]of [['shape',{output:[6]}],['dtype',{outputType:2}]])invalid.push({...await softmaxFixture({name,...options}),name:name+'-bad-'+suffix});
    const fixtures=[...invalid,...(await softmaxCases()).filter(c=>c.options.inputType===undefined||c.options.outputType===7)];assert.equal(fixtures.length,10);
    for(const [i,f]of fixtures.entries()){assert.equal(f.name,SOFTMAX_EXPECTATIONS[i][0]);assert.equal(createHash('sha256').update(f.bytes).digest('hex'),SOFTMAX_EXPECTATIONS[i][1]);}
});
