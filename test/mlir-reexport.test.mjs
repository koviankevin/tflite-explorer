import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {spawnSync} from 'node:child_process';
import {parseMLIR} from '../src/mlir-engine.js';
import {exportMLIR} from '../src/mlir-export.js';
import {captureMLIRPattern,findMLIRPatterns} from '../src/mlir-pattern.js';
import {validateMLIR} from '../src/mlir-validate.js';
import {MLIR_CFG_LOOP,MLIR_CFG_DIAMOND,MLIR_CFG_SWITCH} from './mlir-fixture.mjs';
const metadata=await readFile(new URL('../vendor/netron/mlir-metadata.json',import.meta.url),'utf8');
const parse=text=>parseMLIR(new TextEncoder().encode(text),{metadata});
const counts=index=>({blocks:index.mlir.graphs.length,ops:index.mlir.graphs.reduce((n,g)=>n+g.operations.length,0),arguments:index.mlir.graphs.reduce((n,g)=>n+g.block.arguments.length,0)});
async function repeat(index,selections,rounds=6) {
    const pattern=captureMLIRPattern(index,selections);let baseline;
    for(let round=0;round<rounds;round++) {
        const result=await exportMLIR(index,selections[0].graph,selections[0].nodes,{scope:'slice',selections});
        const text=await result.blob.text();index=await parse(text);
        assert.deepEqual(validateMLIR(index).diagnostics,[]);
        const found=await findMLIRPatterns(index,pattern);assert.equal(found.items.length,1);
        selections=found.items[0].blocks.map(b=>({graph:b.graph,nodes:b.path}));
        assert.deepEqual(captureMLIRPattern(index,selections),pattern);
        const actual={...counts(index),inputs:result.inputs.length,outputs:result.outputs.length};baseline ||= actual;
        assert.deepEqual(actual,baseline,`round ${round+1}`);
        if(process.env.MLIR_OPT) {
            const opt=spawnSync(process.env.MLIR_OPT,['--allow-unregistered-dialect','--mlir-print-op-generic'],{input:text,encoding:'utf8',windowsHide:true,timeout:30000});
            if(opt.error)throw opt.error;assert.equal(opt.status,0,opt.stderr);
            const printed=await parse(opt.stdout);assert.equal((await findMLIRPatterns(printed,pattern)).items.length,1);
            assert.deepEqual(counts(printed),counts(index));
        }
    }
    return index;
}
test('repeatedly slicing one loop OP does not accumulate entry routes or SSA arguments',async()=>{
    const index=await repeat(await parse(MLIR_CFG_LOOP),[{graph:1,nodes:[0]}]);
    assert.deepEqual(counts(index),{blocks:4,ops:5,arguments:5});
});
test('conditional branch outputs and multi-exit switch interfaces stay bounded on repeated export',async()=>{
    await repeat(await parse(MLIR_CFG_DIAMOND),[{graph:0,nodes:[0]},{graph:1,nodes:[0]},{graph:2,nodes:[0]}]);
    await repeat(await parse(MLIR_CFG_SWITCH),[{graph:2,nodes:[0]}]);
});
test('legacy accumulated entry blocks are removed while original blocks and the saved pattern survive',async()=>{
    const index=await parse(await readFile(new URL('fixtures/legacy-wrapped-loop.mlir',import.meta.url),'utf8'));
    assert.equal(index.mlir.slicePatterns.size,1);assert.equal(counts(index).blocks,6);
    const source=await parse(MLIR_CFG_LOOP),pattern=captureMLIRPattern(source,[{graph:1,nodes:[0]}]);
    const item=(await findMLIRPatterns(index,pattern)).items[0];
    const clean=await repeat(index,item.blocks.map(b=>({graph:b.graph,nodes:b.path})));
    assert.deepEqual(counts(clean),{blocks:4,ops:5,arguments:5});
});
test('an explicitly selected synthetic entry terminator is retained rather than silently deleted',async()=>{
    const original=await parse(MLIR_CFG_LOOP),first=await exportMLIR(original,1,[0],{scope:'slice'});
    const index=await parse(await first.blob.text()),result=await exportMLIR(index,0,[0],{scope:'slice'});
    assert.equal(result.slice.selected,1);assert.equal(result.slice.blocks,5);
    assert.deepEqual(validateMLIR(await parse(await result.blob.text())).diagnostics,[]);
});
test('edited or unverified annotations never authorize removing entry blocks',async()=>{
    const text=await readFile(new URL('fixtures/legacy-wrapped-loop.mlir',import.meta.url),'utf8');
    const corrupt=text.replace(/(\\"seal\\":\\")[a-f0-9]/,'$1z');assert.notEqual(corrupt,text);
    const index=await parse(corrupt);assert.equal(index.mlir.slicePatterns.size,0);
    const graph=index.mlir.graphs.findIndex(g=>g.operations.some(op=>op.name.getStringRef()==='company.step'));
    const result=await exportMLIR(index,graph,[0],{scope:'slice'});
    assert.equal(result.slice.blocks,7,'preserve all six unchecked source blocks');
    assert.deepEqual(validateMLIR(await parse(await result.blob.text())).diagnostics,[]);
});
