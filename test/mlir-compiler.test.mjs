import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { parseMLIR } from '../src/mlir-engine.js';
import { exportMLIR } from '../src/mlir-export.js';
import { MLIR_BRANCH, MLIR_EXPORT_BRANCH, MLIR_SCOPES } from './mlir-fixture.mjs';

// This suite runs the real C++ parser/verifier, independently of Netron.
// MLIR_OPT is an executable path; MLIR_OPT_COMMAND is a JSON argv array for
// wrappers such as WSL. Neither is evaluated by a shell.
const command = process.env.MLIR_OPT_COMMAND ? JSON.parse(process.env.MLIR_OPT_COMMAND) : process.env.MLIR_OPT ? [process.env.MLIR_OPT] : null;
if (command && (!Array.isArray(command) || !command.length || command.some(part=>typeof part!=='string'))) throw new Error('MLIR_OPT_COMMAND must be a nonempty JSON string array.');
const options = { skip: command ? false : 'Set MLIR_OPT to run the independent compiler verifier.' };
const metadata = await readFile(new URL('../vendor/netron/mlir-metadata.json',import.meta.url),'utf8');
const parse = text=>parseMLIR(new TextEncoder().encode(text),{metadata});
const compiler = (text,allowUnknown=true) => {
    const result=spawnSync(command[0],[...command.slice(1),...(allowUnknown ? ['--allow-unregistered-dialect'] : []),'--mlir-print-op-generic'],{input:text,encoding:'utf8',maxBuffer:8*1024*1024,timeout:30000,windowsHide:true});
    if(result.error) throw result.error;
    assert.equal(result.signal,null,'Compiler was terminated');
    return result;
};
const extracted = async (source,nodes,graph=0) => (await exportMLIR(await parse(source),graph,nodes)).blob.text();
const topology = index=>index.graphs.map(g=>({
    operators:g.graph.nodes.map(n=>n.type.name),
    edges:g.next.map(set=>[...set].sort((a,b)=>a-b)),
    inputs:g.graph.inputs.map(a=>a.value.map(v=>v.type.spelling)),
    outputs:g.graph.outputs.map(a=>a.value.map(v=>v.type.spelling))
}));

for (const [name,source,nodes,graph] of [
    ['branch and join',MLIR_BRANCH,[0,1,2,3],0],
    ['two boundary inputs and two outputs',MLIR_BRANCH,[1,2],0],
    ['all selected including func.return',MLIR_BRANCH,[0,1,2,3,4],0],
    ['custom types aliases properties and dense attributes',MLIR_EXPORT_BRANCH,[0,1,2,3],0],
    ['custom op from a nested scope',MLIR_SCOPES,[0],1],
    ['nested region and captured values',MLIR_SCOPES,[1],0],
    ['mixed result groups','%a:2, %b = "acme.three"() : () -> (i32, i32, i32)\n%r = "acme.use"(%a#1, %b) : (i32, i32) -> i32',[0],0],
    ['repeated return operands','%x = "acme.input"() : () -> i32\n"func.return"(%x, %x) : (i32, i32) -> ()',[0,1],0],
    ['no result custom op','"acme.effect"() {enabled = true} : () -> ()',[0],0]
]) test(`real MLIR verifier accepts ${name} and preserves SSA topology`,options,async ()=>{
    const text=await extracted(source,nodes,graph);
    const result=compiler(text);
    assert.equal(result.status,0,result.stderr);
    assert.deepEqual(topology(await parse(result.stdout)),topology(await parse(text)));
});

for (const [name,mutate,diagnostic] of [
    ['malformed generic syntax',text=>text.replace('"acme.join"(','"acme.join"'),/expected.*\(/i],
    ['undefined SSA operand',text=>text.replace('"acme.reshape"(%split#0)','"acme.reshape"(%missing)'),/undeclared|undefined/i],
    ['inconsistent SSA type',text=>text.replace('"acme.reshape"(%split#0) : (tensor<2xf32>)','"acme.reshape"(%split#0) : (tensor<3xf32>)'),/type.*(different|mismatch)|prior use|expected/i],
    ['invalid result number',text=>text.replace('%split#1','%split#9'),/result number|result.*(range|number)|invalid SSA/i],
    ['duplicate SSA definition',text=>text.replace('%right =','%left ='),/redefinition/i],
    ['use before definition in function SSA region',text=>{
        const lines=text.split('\n');
        const use=lines.findIndex(line=>line.includes('%left ='));
        const [line]=lines.splice(use,1);
        lines.splice(lines.findIndex(item=>item.includes('%split:2 =')),0,line);
        return lines.join('\n');
    },/dominat/i],
    ['function return signature mismatch',text=>text.replace('function_type = (tensor<2xf32>) -> (tensor<2xf32>)','function_type = (tensor<2xf32>) -> ()'),/return|result|operand/i]
]) test(`real MLIR verifier rejects ${name}`,options,async ()=>{
    const result=compiler(mutate(await extracted(MLIR_BRANCH,[0,1,2,3])));
    assert.notEqual(result.status,0,'Malformed input was accepted');
    assert.match(result.stderr,diagnostic);
});

test('unknown dialect requires explicit permission in compiler mode',options,async ()=>{
    const result=compiler(await extracted(MLIR_BRANCH,[0,1,2,3]),false);
    assert.notEqual(result.status,0);
    assert.match(result.stderr,/unregistered|unknown|not.*(registered|found)/i);
});

test('registered Arith operations verify without allowing unknown dialects',options,async ()=>{
    const text=await extracted('%one = "arith.constant"() <{value = 1 : i32}> : () -> i32\n%sum = "arith.addi"(%one, %one) : (i32, i32) -> i32',[0,1]);
    const accepted=compiler(text,false);
    assert.equal(accepted.status,0,accepted.stderr);
    const rejected=compiler(text.replace('"arith.addi"(%one, %one) : (i32, i32)','"arith.addi"(%one) : (i32)'),false);
    assert.notEqual(rejected.status,0);
    assert.match(rejected.stderr,/operand/i);
});

test('compiler rejects a nested SSA definition that shadows a visible outer value',options,async ()=>{
    const text=await extracted(MLIR_SCOPES,[1],0);
    const broken=text.replaceAll('%nested_x','%ml_input_0');
    const result=compiler(broken);
    assert.notEqual(result.status,0);
    assert.match(result.stderr,/redefinition/i);
});

test('actual downloaded MLIR passes compiler verification when supplied',{
    skip: command && process.env.MLIR_EXPORTED_FILE ? false : 'Set MLIR_EXPORTED_FILE to verify a downloaded artifact.'
},async ()=>{
    const text=await readFile(process.env.MLIR_EXPORTED_FILE,'utf8');
    const result=compiler(text);
    assert.equal(result.status,0,result.stderr);
    assert.deepEqual(topology(await parse(result.stdout)),topology(await parse(text)));
});
