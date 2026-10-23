import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { parseMLIR } from '../src/mlir-engine.js';
import { search, selectionSnapshot } from '../src/model-engine.js';
import { captureGraphPattern, prepareGraphPattern, findSubgraphPatterns } from '../src/subgraph-pattern.js';
import { modelFormat, openModelFile } from '../src/model-adapters.js';
import { hydrate } from '../src/hydrate.js';
import { reusablePattern, exportPatterns, parsePatternFile } from '../src/pattern-library.js';
import { MLIR_BRANCH, MLIR_SCOPES } from './mlir-fixture.mjs';
const metadata = await readFile(new URL('../vendor/netron/mlir-metadata.json', import.meta.url), 'utf8');
const parse = (text, options={}) => parseMLIR(new TextEncoder().encode(text), { metadata, ...options });

test('generic MLIR unknown custom ops preserve names, two results and branch/join connections', async () => {
    const index = await parse(MLIR_BRANCH);
    assert.equal(index.graphs.length, 1);
    const graph = index.graphs[0];
    assert.deepEqual(graph.graph.nodes.map(n=>n.type.name), ['acme.split','acme.reshape','acme.reshape','acme.join','func.return']);
    assert.deepEqual([...graph.next[0]], [1,2]);
    assert.deepEqual([...graph.previous[3]], [1,2]);
    assert.ok(graph.tensors.has('%split#0'));
    assert.equal(search(index,'layers','acme.split').length,1);
    assert.equal(search(index,'layers','acme.').length,4);
    assert.equal(search(index,'tensors','%split#1').length,1);
    assert.equal(search(index,'layers','other.split').length,0);
    assert.equal(graph.graph.nodes[0].attributes[0].value,'custom op');
    const pattern = captureGraphPattern(graph,[0,1,2,3]);
    const matches = await findSubgraphPatterns(index,{...prepareGraphPattern(pattern.nodes,pattern.edges),induced:true},'all');
    assert.equal(matches.items.length,1);
    const dto = structuredClone(selectionSnapshot(index,matches.items[0]));
    const restored = hydrate(dto,new Blob());
    assert.deepEqual(restored.selected,[0,1,2,3]);
    assert.equal(restored.graph.nodes[0].outputs[0].value[0].type.toString(),'f32[2]');
    assert.equal(index.capabilities.tfliteExport,false);
});

test('MLIR functions and nested regions have separate SSA scopes, custom types and attributes remain inspectable', async () => {
    const index = await parse(MLIR_SCOPES);
    assert.equal(index.graphs.length,3);
    const nested = index.graphs.find(g=>g.graph.name.includes('#1 acme.region'));
    assert.ok(nested);
    assert.equal(nested.graph.nodes[0].type.name,'other.custom');
    assert.ok(nested.graph.nodes[0].attributes[0].value.includes('internal.layout'));
    assert.ok(nested.tensors.get('%nested_y').type.spelling.includes('internal.value'));
    assert.equal(search(index,'layers','other.custom','all').length,2);
    assert.equal(search(index,'layers','other.custom',String(index.graphs.indexOf(nested))).length,1);
    assert.deepEqual(index.graphs[0].tensors.get('%x').type.shape.dimensions,['?',4]);
    assert.notEqual(index.graphs[0].tensors.get('%x'),index.graphs[2].tensors.get('%x'));
});

test('MLIR adapter exposes dialect decoration without replacing canonical operator identity', async () => {
    const index = await parse(MLIR_BRANCH,{dialects:[{namespace:'acme',describeOperation:()=>[{name:'internal info',type:'string',value:'extension'}]}]});
    assert.equal(index.graphs[0].graph.nodes[0].type.name,'acme.split');
    assert.ok(index.graphs[0].graph.nodes[0].attributes.some(a=>a.name==='internal info'));
});

test('MLIR file dispatch rejects binary, malformed and oversized files explicitly', async () => {
    assert.equal(modelFormat('network.MLIR'),'mlir');
    assert.equal(modelFormat('network.lite'),'tflite');
    assert.throws(()=>modelFormat('network.txt'),/mlir/);
    await assert.rejects(parse('this is not valid MLIR'),/./);
    await assert.rejects(parseMLIR(Uint8Array.of(0x4d,0x4c,0xef,0x52)),/bytecode/);
    await assert.rejects(openModelFile({name:'huge.mlir',size:65*1024*1024},{readMetadata:()=>metadata}),/64 MiB/);
    const file = new Blob([MLIR_BRANCH]); Object.defineProperty(file,'name',{value:'test.mlir'});
    const index = await openModelFile(file,{readMetadata:()=>metadata});
    assert.equal(index.sourceFormat,'mlir');
});

test('custom op patterns keep namespace identity through JSON export/import', async () => {
    const original = await parse(MLIR_BRANCH);
    const captured = captureGraphPattern(original.graphs[0],[0,1,2,3]);
    const pattern = reusablePattern('MLIR custom branch',captured);
    const imported = parsePatternFile(exportPatterns([pattern]))[0];
    const spec = {...prepareGraphPattern(imported.nodes,imported.edges),induced:imported.induced};
    assert.equal((await findSubgraphPatterns(original,spec,'all')).items.length,1);
    const other = await parse(MLIR_BRANCH.replaceAll('"acme.reshape"','"other.reshape"'));
    assert.equal(search(other,'layers','acme.reshape').length,0);
    assert.equal(search(other,'layers','other.reshape').length,2);
    assert.equal((await findSubgraphPatterns(other,spec,'all')).items.length,0);
    const differentCase = await parse(MLIR_BRANCH.replaceAll('"acme.reshape"','"Acme.reshape"'));
    assert.equal((await findSubgraphPatterns(differentCase,spec,'all')).items.length,0);
});

test('custom shaped types retain nested commas and namespace; unranked tensors keep their element dtype', async () => {
    const index=await parse('%x = "acme.input"() : () -> tensor<2x!internal.elem<foo,bar>>\n%y = "acme.unranked"() : () -> tensor<*xf32>');
    const tensors=index.graphs[0].tensors;
    assert.equal(tensors.get('%x').type.dataType,'!internal.elem<foo,bar>');
    assert.deepEqual(tensors.get('%x').type.shape.dimensions,[2]);
    assert.equal(tensors.get('%y').type.dataType,'f32');
    assert.deepEqual(tensors.get('%y').type.shape.dimensions,['*']);
});
