import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {readMLIRFile,mlirBlob} from '../src/mlir-file.js';
import {parseMLIRFile,parseMLIRSource} from '../src/mlir-engine.js';
import {checkDensePayloads} from '../src/mlir-dense-check.js';
import {validateMLIR} from '../src/mlir-validate.js';
import {exportMLIR} from '../src/mlir-export.js';
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

test('resource-only files explicitly report unverified encoding before and after byte-preserving local export',async()=>{
    const hex='aB'.repeat(6000),source=`%w = "acme.weight"() {value=dense_resource<weights> : tensor<6000xi8>} : () -> tensor<6000xi8>\n{-# dialect_resources: { builtin: { weights: "0x01000000${hex}" } } #-}`;
    const index=await parseMLIRFile(file(source),{metadata}),validation=validateMLIR(index);
    assert.deepEqual(validation.diagnostics,[]);assert.equal(validation.dense.checked,0);assert.equal(validation.dense.unchecked,1);assert.match(validation.dense.payloads[0].reason,/Resource.*未驗證/);assert.match(validation.scope,/1 段編碼未檢查/);
    const result=await exportMLIR(index,0,[0]);assert.equal(result.validation.passed,true);assert.equal(result.validation.dense.unchecked,1);
    const output=await result.blob.text();assert.ok(output.includes(`weights: "0x01000000${hex}"`));const reopened=await parseMLIRFile(result.blob,{metadata});assert.deepEqual(validateMLIR(reopened).diagnostics,[]);assert.equal(reopened.stats.denseValidation.unchecked,1);
});

test('mixed dense/resource counts distinguish checked literals from opaque resource and ignore omitted payload tokens',async()=>{
    const source=op('"0x'+'AB'.repeat(6000)+'"','tensor<6000xi8>')+`\n%r = "acme.weight"() {value=dense_resource<weights> : tensor<6000xi8>} : () -> tensor<6000xi8>\n{-# dialect_resources: { builtin: { weights: "0x01000000${'CD'.repeat(6000)}" } } #-}`;
    const prepared=await readMLIRFile(file(source)),result=checkDensePayloads(prepared.source,prepared.payloads);assert.equal(result.checked,1);assert.equal(result.unchecked,1);
    const resource=prepared.payloads.find(p=>p.kind==='resource');assert.equal(checkDensePayloads(prepared.source.replace(resource.token,'"0x00"'),prepared.payloads).unchecked,0);
    const unknown=checkDensePayloads(prepared.source,[{...resource,kind:'future-payload'}]);assert.equal(unknown.checked,0);assert.equal(unknown.unchecked,1);assert.match(unknown.payloads[0].reason,/未知/);
});
