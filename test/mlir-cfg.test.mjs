import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {parseMLIR} from '../src/mlir-engine.js';
import {exportMLIR} from '../src/mlir-export.js';
import {validateMLIR,validateMLIRText} from '../src/mlir-validate.js';
import {buildDominance} from '../src/mlir-ir.js';
import {MLIR_CFG_DIAMOND,MLIR_CFG_LOOP,MLIR_CFG_FORWARD,MLIR_CFG_SWITCH} from './mlir-fixture.mjs';
const metadata=await readFile(new URL('../vendor/netron/mlir-metadata.json',import.meta.url),'utf8');
const parse=(text,options={})=>parseMLIR(new TextEncoder().encode(text),{metadata,...options});

for(const [name,source,blocks] of [['diamond',MLIR_CFG_DIAMOND,4],['loop',MLIR_CFG_LOOP,3],['forward printed definition',MLIR_CFG_FORWARD,3],['switch and multiple exits',MLIR_CFG_SWITCH,4]]) test(`CFG export from every ${name} block preserves the complete function verbatim`,async()=>{
    const index=await parse(source);
    assert.deepEqual(validateMLIR(index).diagnostics,[]);
    assert.equal(index.graphs.length,blocks);
    for(let graph=0;graph<blocks;graph++) {
        const result=await exportMLIR(index,graph,[0]);
        assert.equal(result.controlFlow.blocks,blocks);
        assert.equal(result.validation.passed,true);
        const text=await result.blob.text();
        const original=index.mlir.source.slice(...index.mlir.info.operations.get(index.mlir.graphs[graph].cfgFunction));
        assert.ok(text.includes(original));
        const reopened=await parse(text);
        assert.equal(reopened.graphs.length,blocks);
        assert.deepEqual(reopened.graphs.map(g=>g.graph.nodes.map(n=>n.type.name)),index.graphs.map(g=>g.graph.nodes.map(n=>n.type.name)));
    }
});

for(const [name,mutate,code] of [
    ['non-dominating sibling result at join',t=>t.replace('"company.finish"(%merged)','"company.finish"(%left_value)'),'SSA_DOMINANCE'],
    ['block argument escaping its branch',t=>t.replace('"company.custom"(%input)','"company.custom"(%merged)'),'SSA_DOMINANCE'],
    ['undefined target',t=>t.replace('[^join]','[^missing]'),'CFG_TARGET_UNDEFINED'],
    ['wrong branch arity',t=>t.replace('"cf.br"(%left_value)[^join] : (i32)','"cf.br"()[^join] : ()'),'CFG_ARGUMENTS'],
    ['wrong branch type',t=>t.replace('^join(%merged: i32)','^join(%merged: i64)'),'CFG_ARGUMENTS'],
    ['wrong condition type',t=>t.replace('function_type = (i1, i32)','function_type = (i32, i32)').replace('%cond: i1','%cond: i32').replace(': (i1) -> ()',': (i32) -> ()'),'CFG_BRANCH_SIGNATURE'],
    ['invalid segment sizes',t=>t.replace('array<i32: 1, 0, 0>','array<i32: 1, 2, -2>'),'CFG_BRANCH_SIGNATURE'],
    ['branch to entry',t=>t.replace('[^join]','[^entry]'),'CFG_ENTRY_PREDECESSOR'],
    ['duplicate block labels',t=>t.replace('^right:','^left:'),'CFG_BLOCK_REDEFINITION'],
    ['duplicate SSA across blocks',t=>t.replaceAll('%right_value','%left_value'),'SSA_REDEFINITION'],
    ['operation after branch',t=>t.replace('^right:','"company.effect"() : () -> ()\n^right:'),'TERMINATOR_POSITION'],
    ['missing terminator',t=>t.replace('"cf.br"(%left_value)[^join] : (i32) -> ()',''),'CFG_TERMINATOR_UNSUPPORTED'],
    ['unknown branch semantics',t=>t.replace('"cf.cond_br"','"company.cond_br"'),'CFG_BRANCH_UNSUPPORTED'],
    ['return mismatch on a second exit',t=>t.replace('"cf.br"(%right_value)[^join] : (i32) -> ()','"func.return"() : () -> ()'),'RETURN_SIGNATURE']
]) test(`CFG blocks ${name} before download`,async()=>{
    const index=await parse(mutate(MLIR_CFG_DIAMOND));
    const result=validateMLIR(index,{graphIndex:1});
    assert.ok(result.diagnostics.some(d=>d.code===code),JSON.stringify(result));
    await assert.rejects(exportMLIR(index,1,[0]),error=>error.validation?.diagnostics.some(d=>d.code===code));
});

test('loop uses cannot precede their definition and loop-carried values retain argument identity',async()=>{
    const index=await parse(MLIR_CFG_LOOP);
    const loop=index.mlir.graphs[1].block;
    assert.equal(loop.operations[0].operands[0],loop.arguments[0]);
    const broken=MLIR_CFG_LOOP.replace('"company.step"(%iteration)','"company.step"(%next)');
    await assert.rejects(validateMLIRText(broken,{metadata}),error=>error.validation?.diagnostics.some(d=>d.code==='SSA_DOMINANCE'));
});

test('dialect adapter registers branch groups, isolated scope, terminators and custom validation across export',async()=>{
    const source=MLIR_CFG_DIAMOND.replaceAll('cf.cond_br','internal.cond_br').replaceAll('func.return','internal.return');
    const dialects=[{namespace:'internal',operationSemantics({name}) {
        if(name==='internal.cond_br') return {terminator:true,branch:true,successorOperands:()=>[[],[]]};
        if(name==='internal.return') return {terminator:true,verify:({uses})=>uses.length===1 ? [] : [{code:'INTERNAL_RETURN',message:'需要一個回傳值。'}]};
    }}];
    const index=await parse(source,{dialects});
    assert.deepEqual(validateMLIR(index).diagnostics,[]);
    assert.equal((await exportMLIR(index,2,[0])).validation.passed,true);
    const broken=source.replace('"internal.return"(%result) : (i32)','"internal.return"() : ()');
    assert.ok(validateMLIR(await parse(broken,{dialects})).diagnostics.some(d=>d.code==='INTERNAL_RETURN'));
    const isolated='%outer = "company.input"() : () -> i32\n"internal.isolated"() ({"company.use"(%outer) : (i32) -> ()}) : () -> ()';
    const strict=[{namespace:'internal',operationSemantics:()=>({isolated:true,regionKind:'ssacfg'})}];
    assert.ok(validateMLIR(await parse(isolated,{dialects:strict})).diagnostics.some(d=>d.code==='SSA_UNDEFINED'));
});

test('dominator tree agrees with path-removal reachability on cyclic and irreducible graphs',()=>{
    let seed=71;const random=n=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed%n;};
    for(let run=0;run<30;run++) {
        const blocks=Array.from({length:18},()=>({}));
        const edges=new Map(blocks.map((b,i)=>[b,i<17 ? [blocks[i+1]] : []]));
        for(let i=1;i<18;i++)for(let j=0;j<2;j++)edges.get(blocks[i]).push(blocks[1+random(17)]);
        const dom=buildDominance(blocks,edges);
        for(const a of blocks) {
            const reachable=new Set(),stack=a===blocks[0] ? [] : [blocks[0]];
            while(stack.length) {const b=stack.pop();if(b===a || reachable.has(b))continue;reachable.add(b);stack.push(...edges.get(b));}
            for(const b of blocks)assert.equal(dom.dominates(a,b),!reachable.has(b));
        }
    }
});

test('dialect region kinds apply to source and export, while incomplete CFG slicing is refused',async()=>{
    const source='"internal.graph"() ({%a = "company.use"(%b) : (i32) -> i32\n%b = "company.source"() : () -> i32}) : () -> ()';
    const dialects=[{namespace:'internal',operationSemantics:()=>({regionKind:i=>i===0 ? 'graph' : 'ssacfg'})}];
    const index=await parse(source,{dialects});
    assert.deepEqual(validateMLIR(index).diagnostics,[]);
    assert.equal((await exportMLIR(index,0,[0])).validation.passed,true);
    assert.ok(validateMLIR(await parse(source)).diagnostics.some(d=>d.code==='SSA_DOMINANCE'));
    const cfg='"internal.region"() ({^entry:\n"cf.br"()[^exit] : () -> ()\n^exit:\n"internal.finish"() : () -> ()}) : () -> ()';
    const rules=[{namespace:'internal',operationSemantics:({name})=>name==='internal.finish' ? {terminator:true} : {regionKind:'ssacfg'}}];
    const complete=await parse(cfg,{dialects:rules});
    assert.equal((await exportMLIR(complete,0,[0])).validation.passed,true);
    await assert.rejects(exportMLIR(complete,1,[0]),/上層 scope/);
});

test('large CFG analysis uses linear storage and iterative graph traversal',()=>{
    const blocks=Array.from({length:15000},()=>({}));
    const edges=new Map(blocks.map((b,i)=>[b,i<blocks.length-1 ? [blocks[i+1]] : [blocks[1]]]));
    const dom=buildDominance(blocks,edges);
    assert.equal(dom.dominates(blocks[1],blocks.at(-1)),true);
    assert.equal(dom.dominates(blocks.at(-1),blocks[1]),false);
});
