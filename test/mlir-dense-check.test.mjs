import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {readMLIRFile,mlirBlob} from '../src/mlir-file.js';
import {parseMLIRFile,parseMLIRSource} from '../src/mlir-engine.js';
import {checkDensePayloads} from '../src/mlir-dense-check.js';
const metadata=await readFile(new URL('../vendor/netron/mlir-metadata.json',import.meta.url),'utf8');
const file=s=>new Blob([s]),op=(body,type)=>`%w = "acme.weight"() {value=dense<${body}> : ${type}} : () -> ${type}`;
for(const chunkSize of [7,65536,1048576])test(`streamed dense counts survive token/comment boundaries (${chunkSize})`,async()=>{
    const source=op('['+Array(40000).fill('1.25e-3').join(', // split\n')+']','tensor<200x200xf32>'),p=await readMLIRFile(file(source),{chunkSize});
    const v=checkDensePayloads(p.source,p.payloads);assert.equal(v.checked,1);assert.equal(v.unchecked,0);assert.equal(p.payloads[0].count.count,'40000');
    assert.equal(await mlirBlob(p.source,p.payloads).text(),source);
});
test('actual file parser rejects numeric/hex element-count mismatches before exposing a model',async()=>{
    for(const [body,type]of [['['+'1,'.repeat(5000)+'2]','tensor<5000xi32>'],['"0x'+'AB'.repeat(5000)+'"','tensor<5001xi8>'],['tensor<5000xi32>: ['+'1,'.repeat(5000)+'2]','tensor<5001xi32>']]){
        const source=body.startsWith('tensor')?`%w = "acme.weight"() {value=dense<${body}>} : () -> ${type}`:op(body,type);
        await assert.rejects(parseMLIRFile(file(source),{metadata}),/dense.*不符/);
    }
});
test('known hex sizes accept single-element splats, reject reshaped candidate types, and leave packing unknown explicitly',async()=>{
    const source=op('"0x'+'AB'.repeat(5000)+'"','tensor<5000xi8>'),p=await readMLIRFile(file(source));
    assert.equal(checkDensePayloads(p.source,p.payloads).checked,1);
    await assert.rejects(parseMLIRSource(p.source.replaceAll('5000xi8','5001xi8'),{metadata,payloads:p.payloads}),/dense.*不符/);
    const unknown=checkDensePayloads(p.source.replaceAll('5000xi8','5000xindex'),p.payloads);assert.equal(unknown.unchecked,1);
    assert.equal(checkDensePayloads(p.source.replaceAll('5000xi8','5000xi1'),p.payloads).unchecked,1);
    const scalar=op(' // '+'comment '.repeat(900)+'\n 1.0','tensor<999999xf32>'),s=await readMLIRFile(file(scalar));assert.equal(checkDensePayloads(s.source,s.payloads).checked,1);
});
