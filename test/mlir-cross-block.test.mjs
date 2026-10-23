import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {parseMLIR} from '../src/mlir-engine.js';
import {captureMLIRPattern,findMLIRPatterns,mlirMatchSnapshot} from '../src/mlir-pattern.js';
import {prepareMLIRPattern} from '../src/mlir-pattern-spec.js';
import {exportPatterns,parsePatternFile,importPatterns,loadPatterns} from '../src/pattern-library.js';
import {MLIR_CFG_DIAMOND,MLIR_CFG_LOOP,MLIR_CFG_SWITCH,MLIR_SCOPES} from './mlir-fixture.mjs';
const metadata=await readFile(new URL('../vendor/netron/mlir-metadata.json',import.meta.url),'utf8');
const parse=(source,options={})=>parseMLIR(new TextEncoder().encode(source),{metadata,...options});
const whole=index=>index.graphs.map((g,graph)=>({graph,nodes:g.graph.nodes.map((_,n)=>n)}));

for(const [name,text,blocks,operators] of [['diamond',MLIR_CFG_DIAMOND,4,7],['loop',MLIR_CFG_LOOP,3,4],['switch',MLIR_CFG_SWITCH,4,4]])test(`cross-block ${name} capture/search preserves CFG, SSA ports, block arguments and localizes every block`,async()=>{
    const index=await parse(text),pattern=captureMLIRPattern(index,whole(index));
    assert.ok(pattern.edges.some(e=>e.kind==='control'));
    assert.ok(pattern.edges.some(e=>e.kind==='argument'));
    const result=await findMLIRPatterns(index,pattern);
    assert.equal(result.items.length,1);const item=result.items[0];
    assert.equal(item.blocks.length,blocks);assert.equal(item.operatorCount,operators);
    for(const block of item.blocks) {
        const dto=mlirMatchSnapshot(index,item,{blockGraph:block.graph,full:true});
        assert.equal(dto.graphIndex,block.graph);assert.deepEqual(dto.selected,block.path);
        assert.equal(dto.graph.nodes.length,index.graphs[block.graph].graph.nodes.length);
        const metadataOnly=mlirMatchSnapshot(index,item,{blockGraph:block.graph,full:true,metadataOnly:true});
        assert.equal(metadataOnly.metadataOnly,true);assert.equal(metadataOnly.graph,undefined);
    }
    assert.throws(()=>mlirMatchSnapshot(index,item,{blockGraph:99}),/不在匹配/);
});

test('portable cross-block patterns ignore model names, labels, SSA identifiers and attributes',async()=>{
    const index=await parse(MLIR_CFG_DIAMOND),pattern=captureMLIRPattern(index,whole(index));
    const file=exportPatterns([{name:'跨 block',...pattern}]);
    for(const secret of ['%left_value','^left','diamond','9223372036854775807','保留','tag'])assert.equal(file.includes(secret),false,secret);
    assert.equal(JSON.parse(file).version,2);
    const storage={value:null,getItem(){return this.value;},setItem(k,v){this.value=v;}};
    importPatterns(storage,[],file);const [imported]=loadPatterns(storage);
    assert.deepEqual(parsePatternFile(file),[imported]);
    const renamed=MLIR_CFG_DIAMOND.replaceAll('^left','^renamed').replaceAll('%left_value','%arbitrary').replaceAll('"diamond"','"other_function"').replace('tag = "left"','tag = "changed"');
    assert.equal((await findMLIRPatterns(await parse(renamed),imported)).items.length,1);
});

for(const [label,mutate] of [
    ['a merge receives a different source',s=>s.replace('"cf.br"(%left_value)','"cf.br"(%input)')],
    ['true and false routes are exchanged',s=>s.replace('[^left, ^right]','[^right, ^left]')],
    ['operator namespace is changed',s=>s.replace('company.custom_long_name_with_attributes','other.custom_long_name_with_attributes')]
])test(`cross-block matching rejects ${label}`,async()=>{
    const source=await parse(MLIR_CFG_DIAMOND),pattern=captureMLIRPattern(source,whole(source));
    assert.equal((await findMLIRPatterns(await parse(mutate(MLIR_CFG_DIAMOND)),pattern)).items.length,0);
});

test('loop pattern requires the actual backedge and carried SSA binding',async()=>{
    const index=await parse(MLIR_CFG_LOOP),pattern=captureMLIRPattern(index,whole(index));
    assert.ok(pattern.edges.some(e=>e.kind==='control' && e.from===e.to));
    for(const text of [MLIR_CFG_LOOP.replace('[^loop, ^exit]','[^exit, ^exit]'),MLIR_CFG_LOOP.replace('(%condition, %next, %next)','(%condition, %initial, %next)')])assert.equal((await findMLIRPatterns(await parse(text),pattern)).items.length,0);
});

test('identical functions produce distinct matches, while current-block scope searches its complete region',async()=>{
    const index=await parse(MLIR_CFG_LOOP+'\n'+MLIR_CFG_LOOP.replace('sym_name = "loop"','sym_name = "other"'));
    const pattern=captureMLIRPattern(index,whole(index).slice(0,3));
    const all=await findMLIRPatterns(index,pattern);assert.equal(all.items.length,2);
    for(const scope of ['0','1','2','3','4','5'])assert.equal((await findMLIRPatterns(index,pattern,scope)).items.length,1);
    assert.throws(()=>captureMLIRPattern(index,[{graph:0,nodes:[0]},{graph:4,nodes:[0]}]),/同一個 region/);
    const nested=await parse(MLIR_SCOPES);
    assert.throws(()=>captureMLIRPattern(nested,[{graph:0,nodes:[0]},{graph:1,nodes:[0]}]),/同一個 region/);
});

test('multiple identical arms are deduplicated without merging distinct physical regions',async()=>{
    const source=MLIR_CFG_DIAMOND.replaceAll('company.custom_long_name_with_attributes','company.custom');
    const index=await parse(source),pattern=captureMLIRPattern(index,whole(index));
    assert.equal((await findMLIRPatterns(index,pattern)).items.length,1);
});

test('capture supports a single branch in a self-loop and validates portable schema strictly',async()=>{
    const text='"func.func"() <{sym_name="forever", function_type=() -> ()}> ({^entry:\n"cf.br"()[^loop] : () -> ()\n^loop:\n"cf.br"()[^loop] : () -> ()}) : () -> ()';
    const index=await parse(text),pattern=captureMLIRPattern(index,[{graph:1,nodes:[0]}]);
    assert.equal((await findMLIRPatterns(index,pattern)).items.length,1);
    for(const mutate of [p=>({...p,edges:p.edges.filter(e=>e.kind!=='contains')}),p=>({...p,nodes:[...p.nodes,p.nodes[0]]}),p=>({...p,edges:[...p.edges,{from:p.nodes[0].alias,to:p.nodes[0].alias,kind:'javascript'}]})])assert.throws(()=>prepareMLIRPattern(mutate(pattern)));
    assert.throws(()=>parsePatternFile(exportPatterns([{name:'cycle',...pattern}]).replace('"version": 2','"version": 1')),/version 2/);
});

test('search refuses invalid dominance and unknown custom branch rules instead of inventing edges',async()=>{
    const original=await parse(MLIR_CFG_DIAMOND),pattern=captureMLIRPattern(original,whole(original));
    await assert.rejects(findMLIRPatterns(await parse(MLIR_CFG_DIAMOND.replace('"company.finish"(%merged)','"company.finish"(%left_value)')),pattern),/SSA_DOMINANCE/);
    await assert.rejects(findMLIRPatterns(await parse(MLIR_CFG_DIAMOND.replace('cf.cond_br','internal.cond_br')),pattern),/CFG_BRANCH_UNSUPPORTED/);
});

test('internal branch adapters participate in cross-block capture and searching',async()=>{
    const source=MLIR_CFG_DIAMOND.replace('cf.cond_br','internal.cond_br');
    const dialects=[{namespace:'internal',operationSemantics:()=>({terminator:true,branch:true,successorOperands:()=>[[],[]]})}];
    const index=await parse(source,{dialects}),pattern=captureMLIRPattern(index,whole(index));
    assert.equal((await findMLIRPatterns(index,pattern)).items.length,1);
});

test('dense cross-block candidate search yields and can be cancelled',async()=>{
    const source='"func.func"() <{sym_name="dense",function_type=()->()}> ({'+Array.from({length:100},(_,i)=>`%v${i}="company.same"():()->i32`).join('\n')+'\n"func.return"():()->()}) : ()->()';
    const index=await parse(source),pattern=captureMLIRPattern(index,[{graph:0,nodes:[0,1,2,3]}]);
    let checks=0;assert.equal(await findMLIRPatterns(index,pattern,'all',()=>++checks>5),null);
});

test('large pattern libraries cannot export a file that exceeds the import size limit',()=>{
    const nodes=[{alias:'B',kind:'block',type:'block',arity:254},{alias:'O',kind:'operator',type:'company.op',order:0},...Array.from({length:254},(_,slot)=>({alias:`A${slot}`,kind:'argument',type:'argument',slot}))];
    const pattern={mode:'mlir-cfg',nodes,edges:nodes.slice(1).map(n=>({from:'B',to:n.alias,kind:'contains'})),induced:true};
    assert.throws(()=>exportPatterns(Array.from({length:50},(_,n)=>({name:`p${n}`,...pattern}))),/1 MiB/);
    assert.equal(parsePatternFile(exportPatterns([{name:'one',...pattern}])).length,1);
});
