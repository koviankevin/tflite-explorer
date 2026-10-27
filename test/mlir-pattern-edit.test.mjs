import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {editMLIRPattern} from '../src/mlir-pattern-edit.js';
import {prepareMLIRPattern} from '../src/mlir-pattern-spec.js';
import {captureMLIRPattern,findMLIRPatterns} from '../src/mlir-pattern.js';
import {parseMLIR} from '../src/mlir-engine.js';
import {reusablePattern,parsePatternFile,exportPatterns} from '../src/pattern-library.js';
import {MLIR_CFG_DIAMOND,MLIR_CFG_LOOP} from './mlir-fixture.mjs';
const metadata=await readFile(new URL('../vendor/netron/mlir-metadata.json',import.meta.url),'utf8');
async function fixture(text){const index=await parseMLIR(new TextEncoder().encode(text),{metadata});return {index,pattern:captureMLIRPattern(index,index.mlir.graphs.map((g,graph)=>({graph,nodes:g.operations.map((_,i)=>i)})))};}
const matches=async(index,pattern)=>(await findMLIRPatterns(index,pattern)).items.length;
const owner=(p,alias)=>p.edges.find(e=>e.kind==='contains'&&e.to===alias).from;

for(const [name,text] of [['branch/join/custom',MLIR_CFG_DIAMOND],['loop',MLIR_CFG_LOOP]])test(`${name} query editing preserves source and round-trips original pattern semantics`,async()=>{
    const {index,pattern}=await fixture(text),original=structuredClone(pattern);
    assert.equal(await matches(index,pattern),1);
    const block=pattern.nodes.find(n=>n.kind==='block').alias;
    let draft=editMLIRPattern(pattern,{kind:'add-operator',block,type:'company.new_op'});
    const added=draft.nodes.find(n=>!pattern.nodes.some(p=>p.alias===n.alias));
    prepareMLIRPattern(draft);assert.equal(await matches(index,draft),0);
    draft=editMLIRPattern(draft,{kind:'remove-node',alias:added.alias});
    assert.equal(await matches(index,draft),1);assert.deepEqual(pattern,original);
    draft=editMLIRPattern(draft,{kind:'add-argument',block});const arg=draft.nodes.find(n=>!pattern.nodes.some(p=>p.alias===n.alias));
    prepareMLIRPattern(draft);assert.equal(await matches(index,draft),0);
    draft=editMLIRPattern(draft,{kind:'remove-node',alias:arg.alias});assert.equal(await matches(index,draft),1);
    draft=editMLIRPattern(draft,{kind:'add-block',type:'company.extra'});assert.throws(()=>prepareMLIRPattern(draft),/連成同一組/);
    const created=draft.nodes.find(n=>n.kind==='block'&&!pattern.nodes.some(p=>p.alias===n.alias));
    draft=editMLIRPattern(draft,{kind:'remove-node',alias:created.alias});assert.equal(await matches(index,draft),1);
    const saved=reusablePattern('edited '+name,draft),restored=parsePatternFile(exportPatterns([saved]))[0];
    assert.equal(await matches(index,restored),1);assert.deepEqual(pattern,original);
});

test('changing custom type, SSA ports, argument routing and successor order rejects wrong matches',async()=>{
    const {index,pattern}=await fixture(MLIR_CFG_DIAMOND),op=pattern.nodes.find(n=>n.type.startsWith('company.'));
    const draft=editMLIRPattern(pattern,{kind:'set-operator',alias:op.alias,type:'company.different'});assert.equal(await matches(index,draft),0);
    for(const kind of ['ssa','argument','control']){
        const edge=pattern.edges.findIndex(e=>e.kind===kind);assert.ok(edge>=0);
        const changed=editMLIRPattern(pattern,{kind:'set-edge',index:edge,edge:{port:kind==='control'?'63':'0:63'}});
        prepareMLIRPattern(changed);assert.equal(await matches(index,changed),0,kind);
    }
    const control=pattern.edges.findIndex(e=>e.kind==='control');
    assert.equal(await matches(index,editMLIRPattern(pattern,{kind:'remove-edge',index:control})),0,'Induced matching must detect a removed original branch.');
});

test('moving OP order and block membership changes the query without silently reconnecting SSA',async()=>{
    const {index,pattern}=await fixture(MLIR_CFG_LOOP),op=pattern.nodes.find(n=>n.type==='company.step'),block=owner(pattern,op.alias);
    let draft=editMLIRPattern(pattern,{kind:'move-operator',alias:op.alias,delta:1});assert.equal(await matches(index,draft),0);
    draft=editMLIRPattern(draft,{kind:'move-operator',alias:op.alias,delta:-1});assert.equal(await matches(index,draft),1);
    const other=pattern.nodes.find(n=>n.kind==='block'&&n.alias!==block).alias;
    draft=editMLIRPattern(pattern,{kind:'set-operator',alias:op.alias,block:other});
    assert.deepEqual(draft.edges.filter(e=>e.kind!=='contains'),pattern.edges.filter(e=>e.kind!=='contains'));
    assert.equal(await matches(index,draft),0);
    draft=editMLIRPattern(draft,{kind:'set-operator',alias:op.alias,block});
    draft=editMLIRPattern(draft,{kind:'move-operator',alias:op.alias,delta:-1});assert.equal(await matches(index,draft),1);
});

test('deleting arguments reindexes slots while preserving surviving routing aliases; deleting blocks removes incident edges',async()=>{
    const {pattern}=await fixture(MLIR_CFG_LOOP),block=pattern.nodes.find(n=>n.kind==='block'&&n.arity===2),args=pattern.nodes.filter(n=>n.kind==='argument'&&owner(pattern,n.alias)===block.alias);
    const draft=editMLIRPattern(pattern,{kind:'remove-node',alias:args[0].alias});
    assert.equal(draft.nodes.find(n=>n.alias===args[1].alias).slot,0);assert.equal(draft.nodes.find(n=>n.alias===block.alias).arity,1);
    assert.deepEqual(draft.edges.filter(e=>e.from===args[1].alias||e.to===args[1].alias),pattern.edges.filter(e=>e.from===args[1].alias||e.to===args[1].alias));
    const cut=editMLIRPattern(pattern,{kind:'remove-node',alias:block.alias}),aliases=new Set(cut.nodes.map(n=>n.alias));
    assert.ok(cut.edges.every(e=>aliases.has(e.from)&&aliases.has(e.to)));assert.ok(!aliases.has(block.alias));
});

test('incomplete drafts remain repairable; limits reject additions atomically and do not mutate caller',()=>{
    const pattern={mode:'mlir-cfg',induced:true,nodes:[{alias:'B',kind:'block',type:'block',arity:0},...Array.from({length:32},(_,i)=>({alias:`O${i}`,kind:'operator',type:'company.op',order:i}))],edges:Array.from({length:32},(_,i)=>({from:'B',to:`O${i}`,kind:'contains'}))};
    const original=structuredClone(pattern);prepareMLIRPattern(pattern);
    assert.throws(()=>editMLIRPattern(pattern,{kind:'add-operator',block:'B'}),/最多/);assert.deepEqual(pattern,original);
    let empty=editMLIRPattern(pattern,{kind:'remove-node',alias:'B'});assert.equal(empty.nodes.length,0);assert.throws(()=>prepareMLIRPattern(empty));
    empty=editMLIRPattern(empty,{kind:'add-block',type:'company.op'});prepareMLIRPattern(empty);
    let added=editMLIRPattern(empty,{kind:'add-edge'});const index=added.edges.findIndex(e=>e.kind==='ssa');
    added=editMLIRPattern(added,{kind:'set-edge',index,edge:{port:'bad'}});assert.throws(()=>prepareMLIRPattern(added),/連線無效/);
    added=editMLIRPattern(added,{kind:'remove-edge',index});prepareMLIRPattern(added);
    assert.throws(()=>editMLIRPattern(pattern,{kind:'set-edge',index:0,edge:{kind:'control'}}),/可編輯/);
});
