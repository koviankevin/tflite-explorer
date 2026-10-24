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
        const dto=mlirMatchSnapshot(index,item,{blockGraph:block.graph,full:true,singleBlock:true});
        assert.equal(dto.graphIndex,block.graph);assert.deepEqual(dto.selected,block.path);
        assert.equal(dto.graph.nodes.length,index.graphs[block.graph].graph.nodes.length);
        const metadataOnly=mlirMatchSnapshot(index,item,{blockGraph:block.graph,full:true,metadataOnly:true,singleBlock:true});
        assert.equal(metadataOnly.metadataOnly,true);assert.equal(metadataOnly.graph,undefined);
    }
    assert.throws(()=>mlirMatchSnapshot(index,item,{blockGraph:99}),/不在匹配/);
    const before=JSON.stringify(index.graphs.map(g=>g.graph)),dto=mlirMatchSnapshot(index,item);
    assert.equal(dto.combined,true);assert.equal(dto.selected.length,operators);
    assert.equal(new Set(dto.graph.nodes.map(n=>n.identifier)).size,dto.graph.nodes.length);
    assert.equal(dto.graph.nodes.filter(n=>n.diagramKind==='block').length,blocks);
    assert.equal(dto.graph.nodes.filter(n=>n.diagramKind==='operator').length,operators);
    assert.equal(dto.graph.nodes.filter(n=>n.diagramKind==='route').length,item.control.length);
    assert.ok(dto.links.some(e=>e.kind==='control'));
    for(const route of dto.graph.nodes.filter(n=>n.diagramKind==='route')) {
        assert.equal(dto.links.filter(e=>e.kind==='control' && e.from===route.identifier).length,1);
        assert.equal(dto.links.filter(e=>e.kind==='control' && e.to===route.identifier).length,1);
    }
    const produced=new Set(dto.graph.nodes.flatMap(n=>n.outputs.flatMap(a=>a.value.map(v=>v.identifier))));
    const boundary=new Set(dto.graph.inputs.flatMap(a=>a.value.map(v=>v.identifier)));
    for(const node of dto.graph.nodes)for(const a of node.inputs)for(const v of a.value)assert.ok(produced.has(v.identifier) || boundary.has(v.identifier));
    assert.equal(JSON.stringify(index.graphs.map(g=>g.graph)),before,'display projection must not change source graphs');
    assert.deepEqual(mlirMatchSnapshot(index,item,{blockGraph:blocks-1}).graph,dto.graph,'focus must not change the combined graph');
});

test('combined loop graph keeps distinct argument SSA, route bindings and the actual backedge',async()=>{
    const index=await parse(MLIR_CFG_LOOP),pattern=captureMLIRPattern(index,whole(index)),item=(await findMLIRPatterns(index,pattern)).items[0],dto=mlirMatchSnapshot(index,item);
    const back=dto.links.find(e=>e.from==='route:1:0' && e.to==='b1');assert.equal(back.kind,'control');
    const argument=dto.graph.nodes.find(n=>n.identifier==='b1:a0');
    assert.equal(argument.inputs.length,2,'initial and loop-carried values merge at the argument');
    assert.equal(new Set(argument.inputs.map(a=>a.value[0].identifier)).size,2);
    const step=dto.graph.nodes.find(n=>n.name==='company.step');
    assert.equal(step.inputs[0].value[0].identifier,argument.outputs[0].value[0].identifier);
    assert.notEqual(step.outputs[0].value[0].identifier,argument.outputs[0].value[0].identifier);
});

test('partial combined graph includes real terminators and marks omitted data producers as boundaries',async()=>{
    const index=await parse(MLIR_CFG_DIAMOND),item={mode:'mlir-cfg',kind:'patterns',graph:1,path:[0],blocks:[{graph:1,path:[0]},{graph:3,path:[0]}]};
    const dto=mlirMatchSnapshot(index,item);
    assert.ok(dto.graph.nodes.some(n=>n.name==='cf.br' && n.sourceGraph===1));
    assert.ok(dto.graph.inputs.length>0);
    assert.equal(dto.graph.nodes.some(n=>n.sourceGraph===2),false,'do not invent shortcuts through omitted blocks');
    assert.equal(dto.graph.nodes.filter(n=>n.diagramKind==='route').length,1);
    assert.ok(mlirMatchSnapshot(index,item,{full:true}).graph.nodes.length>dto.graph.nodes.length);
});

test('shared dominating branch operands retain their exact predecessor route in the combined diagram',async()=>{
    const text=MLIR_CFG_DIAMOND.replace('"cf.br"(%left_value)','"cf.br"(%input)').replace('"cf.br"(%right_value)','"cf.br"(%input)');
    const index=await parse(text),item={mode:'mlir-cfg',kind:'patterns',graph:0,path:[0],blocks:whole(index).map(b=>({graph:b.graph,path:b.nodes}))};
    const dto=mlirMatchSnapshot(index,item),merged=dto.graph.nodes.find(n=>n.identifier==='b3:a0');
    assert.equal(merged.inputs.length,2);
    for(const g of [1,2]) {
        const bindings=dto.graph.nodes.find(n=>n.identifier===`route:${g}:0`).outputs.filter(a=>a.value[0].type?.dataType!=='control');
        assert.equal(bindings.length,1);assert.ok(merged.inputs.some(a=>a.value[0]===bindings[0].value[0]));
    }
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
