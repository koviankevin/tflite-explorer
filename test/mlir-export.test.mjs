import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { parseMLIR, MLIR_ATTRIBUTE_PREVIEW_LIMIT } from '../src/mlir-engine.js';
import { exportMLIR } from '../src/mlir-export.js';
import { search } from '../src/model-engine.js';
import { MLIR_BRANCH, MLIR_SCOPES, MLIR_REPEATED_RETURN } from './mlir-fixture.mjs';
const metadata = await readFile(new URL('../vendor/netron/mlir-metadata.json', import.meta.url), 'utf8');
const parse = text => parseMLIR(new TextEncoder().encode(text), { metadata });
const roundTrip = async (text,nodes,graph=0) => {
    const original = await parse(text);
    const result = await exportMLIR(original,graph,nodes);
    const source = await result.blob.text();
    return {original,result,source,reopened:await parse(source)};
};

test('partial MLIR round trip preserves unknown custom op branch, join, properties, types and attributes verbatim', async () => {
    const text = MLIR_BRANCH.replace('{tag = "custom op"}', '<{count = 9223372036854775807 : i64}> {tag = "custom op %input", cfg = #internal.layout<packed>, data = dense<[1.0, 2.0]> : tensor<2xf32>}');
    const {original,result,source,reopened} = await roundTrip(text,[3,2,0,1,1]);
    assert.equal(result.layers,4);
    assert.equal(result.inputs.length,1); assert.equal(result.inputs[0].name,'%input');
    assert.equal(result.outputs.length,1); assert.equal(result.outputs[0].name,'%joined');
    assert.ok(source.includes('<{count = 9223372036854775807 : i64}> {tag = "custom op %input", cfg = #internal.layout<packed>, data = dense<[1.0, 2.0]> : tensor<2xf32>}'));
    const graph=reopened.graphs[0];
    assert.deepEqual(graph.graph.nodes.map(n=>n.type.name),['acme.split','acme.reshape','acme.reshape','acme.join','func.return']);
    assert.deepEqual([...graph.next[0]],[1,2]); assert.deepEqual([...graph.previous[3]],[1,2]);
    assert.deepEqual(graph.graph.nodes[0].attributes,original.graphs[0].graph.nodes[0].attributes);
    assert.equal(graph.graph.nodes[0].attributes.find(a=>a.name==='count').value,'9223372036854775807 : i64');
    assert.equal(graph.graph.nodes[0].attributes.find(a=>a.name==='data').value,'dense<[1.0, 2.0]> : tensor<2xf32>');
    assert.equal(search(reopened,'layers','acme.split').length,1);
    assert.equal(search(reopened,'tensors','%split#1').length,1);
});

test('cutting grouped result boundaries makes independent typed arguments and retains both live outputs', async () => {
    const {result,source,reopened}=await roundTrip(MLIR_BRANCH,[1,2]);
    assert.deepEqual(result.inputs.map(v=>v.name),['%split#0','%split#1']);
    assert.deepEqual(result.outputs.map(v=>v.name),['%left','%right']);
    assert.equal(reopened.graphs[0].graph.inputs.length,2);
    assert.equal(reopened.graphs[0].graph.outputs.length,2);
    assert.equal(search(reopened,'layers','acme.split').length,0);
    assert.ok(source.includes('"acme.reshape"(%ml_input_0)'));
    assert.ok(source.includes('"acme.reshape"(%ml_input_1)'));
});

test('nested scope custom op keeps opaque types, attrs and dynamic input shape when exported alone', async () => {
    const {result,source,reopened}=await roundTrip(MLIR_SCOPES,[0],1);
    assert.equal(result.inputs[0].type,'tensor<?x4xf32>');
    assert.equal(result.outputs[0].type,'!internal.value<packed>');
    assert.ok(source.includes('{config = #internal.layout<packed>}'));
    assert.equal(reopened.graphs[0].tensors.get('%nested_y').type.spelling,'!internal.value<packed>');
    assert.equal(search(reopened,'layers','other.custom').length,1);
});

test('aliases, unicode strings and locations survive extraction without rewriting text inside attributes', async () => {
    const text = '!T = tensor<2x!internal.elem<foo,bar>>\n#cfg = #internal.layout<packed>\n'+
        '%x = "acme.input"() : () -> !T\n'+
        '%y = "other.custom"(%x) {config = #cfg, text = "中文😀 %x @fake"} : (!T) -> !T loc(#loc)\n'+
        '#loc = loc("input.mlir":4:2)';
    const {source,result,reopened}=await roundTrip(text,[1]);
    assert.ok(source.includes('#cfg = #internal.layout<packed>'));
    assert.ok(source.includes('#loc = loc("input.mlir":4:2)'));
    assert.ok(source.includes('text = "中文😀 %x @fake"'));
    assert.equal(result.outputs[0].type,'!T');
    assert.equal(reopened.graphs[0].tensors.get('%y').type.dataType,'!internal.elem<foo,bar>');
});

test('export retains nested region bodies, local arguments and implicit outer SSA captures', async () => {
    const text = '%unused = "acme.input"() : () -> tensor<2xf32>\n'+
        '%outer = "acme.input"() : () -> tensor<2xf32>\n'+
        '%z = "acme.region"() ({\n'+
        '^bb0(%x: tensor<2xf32>):\n'+
        '  %y = "other.custom"(%outer, %x) {tag = "nested"} : (tensor<2xf32>, tensor<2xf32>) -> tensor<2xf32>\n'+
        '  "acme.yield"(%y) : (tensor<2xf32>) -> ()\n'+
        '}) : () -> tensor<2xf32>';
    const {source,result,reopened}=await roundTrip(text,[2]);
    assert.equal(result.inputs.length,1); assert.equal(result.inputs[0].name,'%outer');
    assert.ok(source.includes('"other.custom"(%ml_input_0, %x)'));
    assert.equal(reopened.graphs.length,2);
    assert.equal(reopened.graphs[1].graph.nodes[0].type.name,'other.custom');
});

test('mixed grouped results and repeated return operands preserve exact SSA identities and output arity', async () => {
    const text='%a:2, %b = "acme.three"() : () -> (i32, i32, i32)\n'+
        '%out = "acme.join"(%a#1, %b) : (i32, i32) -> i32';
    const {result,reopened}=await roundTrip(text,[0]);
    assert.deepEqual(result.outputs.map(v=>v.name),['%a#0','%a#1','%b']);
    assert.ok(reopened.graphs[0].tensors.has('%a#1'));
    const repeated=await roundTrip(MLIR_REPEATED_RETURN,[0,1]);
    assert.deepEqual(repeated.result.outputs.map(v=>v.name),['%x','%x']);
    assert.ok(repeated.source.includes('function_type = () -> (i32, i32)'));
});

test('complete selected return and no-output custom ops produce reopenable function boundaries', async () => {
    const full=await roundTrip(MLIR_BRANCH,[0,1,2,3,4]);
    assert.equal((full.source.match(/"func.return"/g)||[]).length,1);
    const empty=await roundTrip('"acme.effect"() {enabled = true} : () -> ()',[0]);
    assert.equal(empty.result.outputs.length,0);
    assert.equal(empty.reopened.graphs[0].graph.nodes[0].type.name,'acme.effect');
});

test('unsafe selections report concrete errors rather than downloading incomplete MLIR', async () => {
    const index=await parse(MLIR_BRANCH);
    await assert.rejects(exportMLIR(index,0,[]),/1～32/);
    await assert.rejects(exportMLIR(index,0,[99]),/1～32/);
    await assert.rejects(exportMLIR(index,9,[0]),/scope/);
    await assert.rejects(exportMLIR({capabilities:{}},0,[0]),/不支援/);
    const scopes=await parse(MLIR_SCOPES);
    await assert.rejects(exportMLIR(scopes,1,[0,1]),/terminator/);
    const symbols=await parse('%r = "acme.call"() {callee = @outside} : () -> tensor<2xf32>');
    await assert.rejects(exportMLIR(symbols,0,[0]),/symbol reference/);
});

test('large attribute previews are bounded while exported attributes remain complete', async () => {
    const payload='abcdef'.repeat(6000);
    const {source,reopened}=await roundTrip(`%x = "acme.payload"() {data = "${payload}"} : () -> tensor<2xf32>`,[0]);
    assert.ok(source.includes(`data = "${payload}"`));
    const preview=reopened.graphs[0].graph.nodes[0].attributes[0].value;
    assert.ok(preview.length < MLIR_ATTRIBUTE_PREVIEW_LIMIT+100);
    assert.ok(preview.endsWith('匯出保留完整原文）'));
});
