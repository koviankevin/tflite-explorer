import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {spawnSync} from 'node:child_process';
import {parseMLIR} from '../src/mlir-engine.js';
import {exportMLIR} from '../src/mlir-export.js';
import {validateMLIR} from '../src/mlir-validate.js';
import {operationSemantics} from '../src/mlir-dialects.js';
import {typeSpelling} from '../src/mlir-engine.js';
import {MLIR_CFG_DIAMOND,MLIR_CFG_LOOP,MLIR_CFG_FORWARD,MLIR_CFG_SWITCH,MLIR_BRANCH} from './mlir-fixture.mjs';
const metadata=await readFile(new URL('../vendor/netron/mlir-metadata.json',import.meta.url),'utf8');
const parse=text=>parseMLIR(new TextEncoder().encode(text),{metadata});
async function cut(source,selections) {
    const index=await parse(source),result=await exportMLIR(index,selections[0].graph,selections[0].nodes,{scope:'slice',selections});
    const text=await result.blob.text(),reopened=await parse(text);
    assert.deepEqual(validateMLIR(reopened).diagnostics,[]);
    if(process.env.MLIR_OPT) {
        const check=spawnSync(process.env.MLIR_OPT,['--allow-unregistered-dialect','--mlir-print-op-generic'],{input:text,encoding:'utf8',windowsHide:true,timeout:30000});
        if(check.error)throw check.error;assert.equal(check.status,0,check.stderr);
        assert.deepEqual(validateMLIR(await parse(check.stdout)).diagnostics,[]);
    }
    return {result,text,reopened};
}
test('slice exports a single custom branch op, prunes unrelated ops/arguments, and exposes a conditional output contract',async()=>{
    const {result,text}=await cut(MLIR_CFG_DIAMOND,[{graph:1,nodes:[0]}]);
    assert.ok(text.includes('count = 9223372036854775807 : i64'));
    assert.ok(text.includes('<{mode = "保留"}>'));
    assert.ok(!text.includes('"company.custom"('));assert.ok(!text.includes('"company.finish"('));
    assert.equal(result.slice.selected,1);assert.equal(result.slice.retained,1);
    assert.equal(result.outputs.length,1);assert.equal(result.outputs[0].conditional,true);
    assert.equal(result.inputs.filter(v=>v.role==='inactive-output').length,1);
    assert.equal((text.match(/"cf.cond_br"/g)||[]).length,1);
});
test('mutually exclusive branch outputs have independent flags and typed seeds without fabricated SSA values',async()=>{
    const {result,text}=await cut(MLIR_CFG_DIAMOND,[{graph:1,nodes:[0]},{graph:2,nodes:[0]}]);
    assert.equal(result.outputs.length,2);assert.equal(result.slice.conditionalOutputs,2);
    assert.equal(result.inputs.filter(v=>v.role==='inactive-output').length,2);
    assert.ok(!text.includes('"company.finish"('));assert.ok(!/undef|poison|unrealized_conversion_cast/.test(text));
});
test('loop slice retains a required loop-carried producer and dynamic condition instead of freezing them as inputs',async()=>{
    const source=MLIR_CFG_LOOP.replace('  "cf.cond_br"(%condition,','  %dynamic = "company.test"(%next) : (i32) -> i1\n  "cf.cond_br"(%dynamic,');
    const {result,text}=await cut(source,[{graph:1,nodes:[1]}]);
    assert.deepEqual(result.slice.added,['company.step']);
    assert.ok(text.includes('"company.step"(%iteration)'));assert.ok(text.includes('"company.test"(%next)'));
    assert.ok(!result.inputs.some(v=>v.name==='%dynamic' || v.name==='%next'));
    assert.equal(result.slice.conditionalOutputs,0);
});
test('loop custom op slice returns loop SSA, keeps backedge, and drops unused original exit argument',async()=>{
    const {result,text,reopened}=await cut(MLIR_CFG_LOOP,[{graph:1,nodes:[0]}]);
    assert.equal(result.slice.conditionalOutputs,0);assert.ok(!text.includes('%answer'));
    assert.ok(reopened.mlir.graphs.some(g=>g.block.operations.at(-1).successors?.some(s=>(s.label || s.name)===g.block.name)));
    assert.equal(result.outputs[0].name,'%next');
});
test('forward printed external definitions become typed inputs without retaining the producer',async()=>{
    const {result,text}=await cut(MLIR_CFG_FORWARD,[{graph:1,nodes:[0]}]);
    assert.ok(!text.includes('"company.define"'));assert.ok(result.inputs.some(v=>v.name==='%later'));
});
test('switch slice rebuilds operand segments, preserves case values and returns an explicit original exit tag',async()=>{
    const {result,text}=await cut(MLIR_CFG_SWITCH,[{graph:2,nodes:[0]}]);
    assert.equal(result.slice.exitTag,true);assert.equal(result.slice.conditionalOutputs,1);
    assert.ok(text.includes('case_values = dense<[0, 1]> : vector<2xi32>'));
});
test('all selected CFG operators remain valid and complete function export is still available',async()=>{
    const index=await parse(MLIR_CFG_DIAMOND),selections=index.graphs.map((g,graph)=>({graph,nodes:g.graph.nodes.map((_,n)=>n)}));
    const {result}=await cut(MLIR_CFG_DIAMOND,selections);
    assert.equal(result.outputs.length,1);assert.equal(result.slice.conditionalOutputs,0);
    const full=await exportMLIR(index,1,[0],{scope:'function'});
    assert.ok((await full.blob.text()).includes('"company.finish"'));assert.equal(full.controlFlow.blocks,4);
});

// Execute only the scalar test fixture operations. This checks routing and
// validity semantics independently of merely accepting generated syntax.
function execute(index,args) {
    const blocks=index.mlir.graphs.map(g=>g.block),labels=new Map(blocks.map(b=>[b.name,b])),values=new Map();let block=blocks[0],incoming=args;
    for(let budget=0;budget<100;budget++) {
        block.arguments.forEach((v,i)=>values.set(v,incoming[i]));let jumped=false;
        for(const op of block.operations) {
            const name=op.name.getStringRef(),row=index.mlir.ir.byOp.get(op),operands=row.uses.map(u=>values.get(u.value));
            if(name==='func.return')return operands;
            const sem=operationSemantics(op);
            if(sem.branch) {
                const groups=sem.successorOperands({op,uses:row.uses,typeOf:typeSpelling}),route=name==='cf.cond_br'?(operands[0]?0:1):0;
                incoming=groups[route].map(u=>values.get(u.value));block=labels.get(op.successors[route].label || op.successors[route].name);jumped=true;break;
            }
            const result=name==='arith.constant'?op.getAttr('value').value
                :name==='company.custom_long_name_with_attributes'?operands[0]+10
                :name==='company.custom'?operands[0]+20
                :name==='company.step'?operands[0]+1
                :name==='company.test'?operands[0]<3:undefined;
            assert.notEqual(result,undefined,`unsupported fixture operation ${name}`);
            assert.equal(op.results.length,1);values.set(op.results[0],result);
        }
        assert.ok(jumped);
    }
    throw new Error('fixture failed to terminate');
}
test('conditional output values and valid flags follow both real branch paths, preserving caller seeds on untaken paths',async()=>{
    const {result,reopened}=await cut(MLIR_CFG_DIAMOND,[{graph:1,nodes:[0]},{graph:2,nodes:[0]}]);
    const args=cond=>result.inputs.map(v=>v.name==='%cond'?cond:v.name==='%input'?5:v.output===0?-1:-2);
    assert.deepEqual(execute(reopened,args(true)),[true,15,false,-2]);
    assert.deepEqual(execute(reopened,args(false)),[false,-1,true,25]);
});
test('a partial loop computes multiple real iterations with its changing condition and latest carried value',async()=>{
    const source=MLIR_CFG_LOOP.replace('  "cf.cond_br"(%condition,','  %dynamic = "company.test"(%next) : (i32) -> i1\n  "cf.cond_br"(%dynamic,');
    const {result,reopened}=await cut(source,[{graph:1,nodes:[0]}]);
    assert.ok(result.slice.added.includes('company.test'));
    assert.deepEqual(execute(reopened,result.inputs.map(v=>{assert.equal(v.name,'%initial');return 0;})),[3]);
});
test('single-block cross-block selection payload still uses the existing local SSA exporter',async()=>{
    const {result,text}=await cut(MLIR_BRANCH,[{graph:0,nodes:[1]}]);
    assert.ok(!result.slice);assert.equal(result.layers,1);assert.ok(!text.includes('"acme.split"'));
    const full=await exportMLIR(await parse(MLIR_BRANCH),0,[1],{scope:'function'});
    assert.ok((await full.blob.text()).includes('"acme.split"'));assert.equal(full.controlFlow.blocks,1);
    const multiple=await parse(MLIR_BRANCH+'\n'+MLIR_BRANCH.replace('"main"','"second"'));
    await assert.rejects(exportMLIR(multiple,0,[1],{scope:'function',selections:[{graph:0,nodes:[1]},{graph:1,nodes:[1]}]}),/同一個 function/);
});
test('slice rejects invalid source dominance, cross-function selection, symbol dependencies and unsupported branch serializers',async()=>{
    const broken=await parse(MLIR_CFG_DIAMOND.replace('"company.custom"(%input)','"company.custom"(%merged)'));
    await assert.rejects(exportMLIR(broken,1,[0],{scope:'slice'}),e=>e.validation?.diagnostics.some(d=>d.code==='SSA_DOMINANCE'));
    const multiple=await parse(MLIR_CFG_LOOP+'\n'+MLIR_CFG_LOOP.replaceAll('"loop"','"second"'));
    await assert.rejects(exportMLIR(multiple,1,[0],{scope:'slice',selections:[{graph:1,nodes:[0]},{graph:4,nodes:[0]}]}),/同一個 function/);
    const symbols=await parse(MLIR_CFG_DIAMOND.replace('{tag = "left",','{callee = @missing, tag = "left",'));
    await assert.rejects(exportMLIR(symbols,1,[0],{scope:'slice'}),/symbol reference/);
    const originalSem=op=>operationSemantics({name:{getStringRef:()=> 'cf.cond_br'},getAttr:key=>op.getAttr(key),successors:op.successors});
    const dialects=[{namespace:'internal',operationSemantics:({op})=>originalSem(op)}];
    const unknown=await parseMLIR(new TextEncoder().encode(MLIR_CFG_DIAMOND.replace('"cf.cond_br"','"internal.cond_br"')),{metadata,dialects});
    await assert.rejects(exportMLIR(unknown,1,[0],{scope:'slice'}),/exportBranch/);
    assert.equal((await exportMLIR(unknown,1,[0],{scope:'function'})).validation.passed,true);
});
test('trusted dialect adapter can serialize filtered successor arguments through the CFG slice seam',async()=>{
    const dialects=[{namespace:'internal',operationSemantics({op}) {
        const sem=operationSemantics({name:{getStringRef:()=> 'cf.cond_br'},getAttr:key=>op.getAttr(key),successors:op.successors});
        return {...sem,exportBranch({conditions,successors}) {
            const values=[...conditions,...successors.flatMap(s=>s.values)];
            return `"internal.cond_br"(${values.map(v=>v.name).join(', ')})[${successors.map(s=>s.label).join(', ')}] <{operandSegmentSizes = array<i32: 1, ${successors.map(s=>s.values.length).join(', ')}>}> : (${values.map(v=>v.type).join(', ')}) -> ()`;
        }};
    }}];
    const index=await parseMLIR(new TextEncoder().encode(MLIR_CFG_DIAMOND.replace('"cf.cond_br"','"internal.cond_br"')),{metadata,dialects});
    const result=await exportMLIR(index,1,[0],{scope:'slice'}),text=await result.blob.text();
    assert.equal(result.validation.passed,true);assert.ok(text.includes('"internal.cond_br"'));
});
