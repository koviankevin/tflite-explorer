import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {parseMLIR} from '../src/mlir-engine.js';
import {validateMLIR,validateMLIRText,MLIRValidationError} from '../src/mlir-validate.js';
import {exportMLIR} from '../src/mlir-export.js';
import {MLIR_BRANCH,MLIR_EXPORT_BRANCH,MLIR_SCOPES} from './mlir-fixture.mjs';
const metadata=await readFile(new URL('../vendor/netron/mlir-metadata.json',import.meta.url),'utf8');
const parse=text=>parseMLIR(new TextEncoder().encode(text),{metadata});
const codes=result=>result.diagnostics.map(item=>item.code);

test('local validation accepts generic custom types, aliases, properties, nested scopes and multi-output SSA',async()=>{
    for(const text of [MLIR_BRANCH,MLIR_EXPORT_BRANCH,MLIR_SCOPES]) {
        const result=await validateMLIRText(text,{metadata});
        assert.equal(result.passed,true);
        assert.match(result.scope,/不含 dialect/);
    }
});

for(const [label,mutate,code] of [
    ['undefined value',t=>t.replace('"acme.reshape"(%split#0)','"acme.reshape"(%missing)'),'SSA_UNDEFINED'],
    ['wrong result index',t=>t.replace('%split#1','%split#9'),'SSA_RESULT_INDEX'],
    ['type mismatch',t=>t.replace('"acme.reshape"(%split#0) : (tensor<2xf32>)','"acme.reshape"(%split#0) : (tensor<3xf32>)'),'SSA_TYPE_MISMATCH'],
    ['duplicate value',t=>t.replace('%right =','%left ='),'SSA_REDEFINITION'],
    ['return mismatch',t=>t.replace('function_type = (tensor<2xf32>) -> tensor<2xf32>','function_type = (tensor<2xf32>) -> tensor<3xf32>'),'RETURN_SIGNATURE'],
    ['entry argument mismatch',t=>t.replace('function_type = (tensor<2xf32>)','function_type = (tensor<3xf32>)'),'FUNCTION_ARGUMENTS'],
    ['dominance',t=>{const lines=t.split('\n');const n=lines.findIndex(l=>l.includes('%left ='));const [line]=lines.splice(n,1);lines.splice(lines.findIndex(l=>l.includes('%split:2 =')),0,line);return lines.join('\n');},'SSA_DOMINANCE']
]) test(`local validation blocks ${label} before external values can become valid arguments`,async()=>{
    const index=await parse(mutate(MLIR_BRANCH));
    const result=validateMLIR(index,{graphIndex:0});
    assert.ok(codes(result).includes(code),JSON.stringify(result));
    const diagnostic=result.diagnostics.find(item=>item.code===code);
    assert.ok(diagnostic.line>0 && diagnostic.column>0);
    assert.ok(diagnostic.excerpt);
    await assert.rejects(exportMLIR(index,0,[0,1,2,3]),error=>error instanceof MLIRValidationError && error.validation.stage==='來源模型' && error.validation.diagnostics.some(item=>item.code===code));
});

test('syntax errors retain parser location and a structured error response',async()=>{
    await assert.rejects(validateMLIRText('%r = "acme.bad"(',{metadata}),error=>error instanceof MLIRValidationError && error.validation.stage==='匯出子圖' && error.validation.diagnostics[0].code==='SYNTAX' && error.validation.diagnostics[0].line===1);
});

test('undefined SSA diagnostics identify the precise source use, ignoring text inside attributes',async()=>{
    const source=MLIR_BRANCH.replace('"acme.reshape"(%split#0)','"acme.reshape"(%missing)').replace('custom op','%fake');
    const result=validateMLIR(await parse(source));
    const item=result.diagnostics.find(item=>item.code==='SSA_UNDEFINED');
    const line=source.split('\n')[4];
    assert.equal(item.line,5);assert.equal(item.column,line.indexOf('%missing')+1);
    assert.ok(result.diagnostics.every(d=>!d.message.includes('%fake')));
});

test('redefinition diagnostics point to the declaration, not a later type alias use',async()=>{
    const source=MLIR_BRANCH.replace('%right =','%left =');
    const item=validateMLIR(await parse(source)).diagnostics.find(item=>item.code==='SSA_REDEFINITION');
    assert.equal(item.line,6);assert.equal(item.column,5);
    assert.ok(item.excerpt.includes('%left = "acme.reshape"(%split#1)'));
});

test('SSA scopes reject visible parent shadowing and isolated function captures',async()=>{
    const shadowed=MLIR_SCOPES.replaceAll('%nested_x','%x');
    assert.ok(codes(validateMLIR(await parse(shadowed))).includes('SSA_REDEFINITION'));
    const isolated='%external = "acme.input"() : () -> i32\n"func.func"() <{sym_name = "f", function_type = () -> i32}> ({\n%out = "acme.use"(%external) : (i32) -> i32\n"func.return"(%out) : (i32) -> ()\n}) : () -> ()';
    assert.ok(codes(validateMLIR(await parse(isolated))).includes('SSA_UNDEFINED'));
});

test('errors in another function do not suppress or block the selected function context',async()=>{
    const text=MLIR_SCOPES.replace('"other.custom"(%x) : (tensor<2xf32>)','"other.custom"(%missing) : (tensor<2xf32>)');
    const index=await parse(text);
    assert.equal(validateMLIR(index,{graphIndex:1}).diagnostics.length,0);
    assert.ok(codes(validateMLIR(index,{graphIndex:2})).includes('SSA_UNDEFINED'));
    const exported=await exportMLIR(index,1,[0]);
    assert.equal(exported.validation.passed,true);
});

test('multi-block regions fail explicitly instead of claiming dominance verification',async()=>{
    const text='"acme.region"() ({\n^bb0:\n"cf.br"() [^bb1] : () -> ()\n^bb1:\n"acme.yield"() : () -> ()\n}) : () -> ()';
    const index=await parse(text);
    assert.ok(codes(validateMLIR(index)).includes('CFG_UNSUPPORTED'));
    await assert.rejects(exportMLIR(index,0,[0]),error=>error.validation?.diagnostics.some(item=>item.code==='CFG_UNSUPPORTED'));
});

test('verification runs on both source and generated text, and reports progress before download',async()=>{
    const stages=[];
    const result=await exportMLIR(await parse(MLIR_EXPORT_BRANCH),0,[0,1,2,3],{progress:stage=>stages.push(stage)});
    assert.equal(result.validation.passed,true);assert.equal(stages.length,2);
    assert.match(stages[0],/來源/);assert.match(stages[1],/匯出/);
});
