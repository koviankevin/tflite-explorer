import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { parseMlir } from '../src/mlir-engine.js';
import { search, snapshot } from '../src/model-engine.js';
import { captureGraphPattern, findSubgraphPatterns, prepareGraphPattern } from '../src/subgraph-pattern.js';
const metadata = await readFile(new URL('../vendor/netron/mlir-metadata.json', import.meta.url), 'utf8');
export const genericMlir = `module {
  func.func @main(%arg0: tensor<1x4xf32>) -> tensor<1x4xf32> {
    %0:2 = "internal.split"(%arg0) {axis = 1 : i64} : (tensor<1x4xf32>) -> (tensor<1x2xf32>, tensor<1x2xf32>)
    %1 = "internal.join"(%0#0, %0#1) : (tensor<1x2xf32>, tensor<1x2xf32>) -> tensor<1x4xf32>
    return %1 : tensor<1x4xf32>
  }
}`;
test('text MLIR handles unknown generic dialect, multi-result SSA edges, details and pattern capture', async () => {
    const index = await parseMlir(new TextEncoder().encode(genericMlir), 'custom.mlir', metadata);
    assert.equal(index.graphs.length, 1);
    const entry = index.graphs[0];
    assert.equal(entry.graph.nodes.length, 2);
    assert.equal(search(index, 'layers', 'internal.split').length, 1);
    assert.equal(search(index, 'tensors', '%0.1').length, 1);
    assert.deepEqual([...entry.next[0]], [1]);
    assert.equal(entry.tensors.get('%0.1').type.dataType, 'float32');
    assert.deepEqual(entry.tensors.get('%0.1').type.shape.dimensions.map(Number), [1,2]);
    assert.equal(entry.graph.nodes[0].attributes[0].name, 'axis');
    const captured = captureGraphPattern(entry, [0,1]);
    assert.equal((await findSubgraphPatterns(index, prepareGraphPattern(captured.nodes, captured.edges))).items.length, 1);
    const dto = structuredClone(snapshot(index, 0, [0]));
    assert.equal(dto.graph.outputs[0].value[0].identifier, '%1');
});
test('standard MLIR functions do not share SSA values or pattern matches', async () => {
    const source = ['a','b'].map(name=>`func.func @${name}(%arg0: tensor<2xf32>) -> tensor<2xf32> { %0 = arith.addf %arg0, %arg0 : tensor<2xf32> return %0 : tensor<2xf32> }`).join('\n');
    const index = await parseMlir(new TextEncoder().encode(source), 'standard.mlir', metadata);
    assert.equal(index.graphs.length, 2);
    assert.equal(search(index, 'layers', 'arith.addf', '1').length, 1);
    assert.equal(search(index, 'tensors', '%arg0').length, 2);
});
test('unsupported bytecode and invalid custom syntax fail with actionable errors', async () => {
    await assert.rejects(parseMlir(Uint8Array.of(77,76,239,82), 'x.mlir', metadata), /bytecode/);
    await assert.rejects(parseMlir(new TextEncoder().encode('module { %0 = private.unknown %arg : tensor<2xf32> }'), 'x.mlir', metadata), /通用語法/);
});
