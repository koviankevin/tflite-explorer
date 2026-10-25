import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {readMLIRFile,mlirBlob} from '../src/mlir-file.js';
import {parseMLIRFile} from '../src/mlir-engine.js';
import {exportMLIR} from '../src/mlir-export.js';
import {assertValidMLIR,validateMLIR} from '../src/mlir-validate.js';
import {matchesConditions} from '../src/pattern-conditions.js';
import {captureGraphPattern,findSubgraphPatterns,prepareGraphPattern} from '../src/subgraph-pattern.js';
import {MLIR_CFG_LOOP} from './mlir-fixture.mjs';
const metadata=await readFile(new URL('../vendor/netron/mlir-metadata.json',import.meta.url),'utf8');
const file=text=>Object.assign(new Blob([text]),{name:'large.mlir'});
const hex='aB0123'.repeat(12000);
const dense=`dense<"0x${hex}"> : tensor<36000xi8>`;
const source=`// 中文 dense<leave comments alone>\n%x = "acme.weights"() {tag = "dense<not a literal>", value = ${dense}} : () -> tensor<36000xi8>\n%y = "acme.use"(%x) : (tensor<36000xi8>) -> tensor<36000xi8>`;

for(const chunkSize of [7,1024,1024*1024])test(`file-backed dense survives UTF-8/token splits at ${chunkSize} bytes`,async()=>{
    const p=await readMLIRFile(file(source),{chunkSize});
    assert.equal(p.payloads.length,1);assert.ok(p.source.length<1000);
    assert.equal(await mlirBlob(p.source,p.payloads).text(),source);
    assert.ok(p.source.includes('中文'));assert.ok(p.source.includes('"dense<not a literal>"'));
    assert.equal(p.stats.fileBytes,Buffer.byteLength(source));
});

test('numeric and type-first dense literals remain exact without expanding values',async()=>{
    for(const body of ['['+'1, '.repeat(30000)+'2]', 'tensor<30001xi32>: ['+'1, '.repeat(30000)+'2]']) {
        const text=`%v = "acme.weights"() {value = dense<${body}>${body.startsWith('tensor')?'':' : tensor<30001xi32>'}} : () -> tensor<30001xi32>`;
        const p=await readMLIRFile(file(text),{chunkSize:997});
        assert.equal(p.payloads.length,1);assert.equal(await mlirBlob(p.source,p.payloads).text(),text);
        assertValidMLIR(await parseMLIRFile(file(text),{metadata}));
    }
});

test('resource metadata blobs are streamed and restored with original alignment/header',async()=>{
    const text=`%v = "acme.weights"() {value = dense_resource<weights> : tensor<36000xi8>} : () -> tensor<36000xi8>\n{-#\n dialect_resources: { builtin: { weights: "0x01000000${hex}" } }\n#-}`;
    const p=await readMLIRFile(file(text),{chunkSize:19});
    assert.equal(p.payloads[0].kind,'resource');assert.equal(await mlirBlob(p.source,p.payloads).text(),text);
    const original=await parseMLIRFile(file(text),{metadata});
    assert.equal(original.mlir.graphs[0].operations[0].getAttr('value').value,null);
    assert.equal(original.mlir.graphs[0].operations[0].getAttr('value').modelLensDeferred,true);
    const result=await exportMLIR(original,0,[0]);
    assert.ok((await result.blob.text()).includes(`weights: "0x01000000${hex}"`));
    assertValidMLIR(await parseMLIRFile(result.blob,{metadata}));
});

test('subgraph export restores dense bytes; reopened patterns/attributes stay stable',async()=>{
    const index=await parseMLIRFile(file(source),{metadata});
    assert.equal(index.mlir.graphs[0].operations[0].getAttr('value').value,null);
    assert.equal(index.mlir.graphs[0].operations[0].getAttr('value').modelLensDeferred,true);
    const attribute=index.graphs[0].graph.nodes[0].attributes.find(a=>a.name==='value');
    assert.match(attribute.value,/權重留在原始檔案/);
    assert.equal(matchesConditions(index.graphs[0].graph.nodes[0],[{kind:'attribute',name:'value',value:attribute.value}]),false);
    const captured=captureGraphPattern(index.graphs[0],[0,1]);
    const spec=prepareGraphPattern(captured.nodes,captured.edges);
    const result=await exportMLIR(index,0,[0,1]);
    assert.ok((await result.blob.text()).includes(dense));
    assert.equal(result.validation.deferredPayloads,1);
    const reopened=await parseMLIRFile(result.blob,{metadata});
    assertValidMLIR(reopened);
    assert.equal((await findSubgraphPatterns(reopened,spec,'all')).items.length,1);
    assert.deepEqual(reopened.graphs[0].graph.nodes[0].attributes,index.graphs[0].graph.nodes[0].attributes);
    const again=await exportMLIR(reopened,0,[0,1]);
    assert.ok((await again.blob.text()).includes(dense));
});

test('CFG slice and complete-function export both preserve deferred custom attributes',async()=>{
    const text=MLIR_CFG_LOOP.replace('{mode = "loop"}',`{mode = "loop", weights = ${dense}}`);
    const index=await parseMLIRFile(file(text),{metadata});
    for(const scope of ['slice','function']) {
        const result=await exportMLIR(index,1,[0],{scope});
        assert.ok((await result.blob.text()).includes(dense));
        assertValidMLIR(await parseMLIRFile(result.blob,{metadata}));
    }
});

test('structural budget is separate from file bytes and malformed payloads fail clearly',async()=>{
    const prepared=await readMLIRFile(file(source),{structureLimit:1024});
    assert.ok(prepared.stats.fileBytes>64*1024);
    await assert.rejects(readMLIRFile(file('x'.repeat(2048)),{structureLimit:1024}),/結構文字/);
    await assert.rejects(readMLIRFile(file('%v = "acme.op"() {value = dense<['+'0,'.repeat(40000)+'>} : () -> i32')),/括號/);
    await assert.rejects(readMLIRFile(file('dense<"0x'+'00'.repeat(40000))),/未閉合/);
    await assert.rejects(readMLIRFile(new Blob([Uint8Array.of(0xff)])),/encoded|encoding|UTF/i);
    await assert.rejects(readMLIRFile(file('{-# dialect_resources: { builtin: { x: "0x'+'g0'.repeat(40000)+'" } } #-}')),/十六進位/);
    await assert.rejects(readMLIRFile(file('dense<"0x'+'g0'.repeat(40000)+'">')),/十六進位/);
});

test('multiline deferred literals keep SSA diagnostic locations in the original file',async()=>{
    const literal='['+'0,\n'.repeat(30000)+'1]';
    const text=`%w = "acme.weights"() {value = dense<${literal}> : tensor<30001xi32>} : () -> tensor<30001xi32>\n%x = "acme.use"(%missing) : (i32) -> i32`;
    const index=await parseMLIRFile(file(text),{metadata});
    const issue=validateMLIR(index).diagnostics.find(d=>d.code==='SSA_UNDEFINED');
    assert.equal(issue.line,30002);assert.equal(issue.column,17);
});

test('small scalar splats do not allocate millions of weight elements',async()=>{
    const index=await parseMLIRFile(file('%w = "acme.weights"() {value = dense<1.0> : tensor<5000000xf32>} : () -> tensor<5000000xf32>'),{metadata});
    assert.equal(index.mlir.graphs[0].operations[0].getAttr('value').value,null);
    const result=await exportMLIR(index,0,[0]);
    assert.ok((await result.blob.text()).includes('dense<1.0> : tensor<5000000xf32>'));
});

test('multiple deferred payloads preserve same-line offsets and stable workspace fingerprints',async()=>{
    const {workspaceIdentity}=await import('../src/workspace.js');
    const text=`%x = "acme.constant"() {a = ${dense}, b = ${dense}} : () -> i32\n%bad = "acme.use"(%missing) : (i32) -> i32`;
    const a=await parseMLIRFile(file(text),{metadata}),b=await parseMLIRFile(file(text),{metadata});
    assert.notEqual(a.mlir.payloads[0].token,b.mlir.payloads[0].token);
    assert.deepEqual(await workspaceIdentity(a,file(text)),await workspaceIdentity(b,file(text)));
    assert.equal(validateMLIR(a).diagnostics.find(d=>d.code==='SSA_UNDEFINED').line,2);
    assert.equal(await mlirBlob(a.mlir.source,a.mlir.payloads).text(),text);
});
