import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {cleanPatternLibrary,readLegacyPatterns,readPatternRecord,mutatePatternLibrary,patternStore} from '../src/pattern-store.js';
import {exportPatterns,parsePatternFile} from '../src/pattern-library.js';
import {parseMLIR} from '../src/mlir-engine.js';
import {captureMLIRPattern,findMLIRPatterns} from '../src/mlir-pattern.js';
import {MLIR_CFG_LOOP} from './mlir-fixture.mjs';
const p=(name,type='Reshape')=>({name,nodes:[{alias:'N1',type}],edges:[],induced:false});
const storage=entries=>({getItem:key=>entries.get(key)??null});

test('stale tabs merge unrelated additions and imports without discarding a newer pattern',()=>{
    const base=[p('original')],first=mutatePatternLibrary(base,{type:'save',base,pattern:p('tab A','Add')});
    const second=mutatePatternLibrary(first.patterns,{type:'save',base,pattern:p('tab B','Mul')});
    assert.deepEqual(second.patterns.map(p=>p.name),['original','tab A','tab B']);
    const imported=mutatePatternLibrary(second.patterns,{type:'import',text:exportPatterns([p('file','Transpose')])});
    assert.deepEqual(imported.patterns.map(p=>p.name),['original','tab A','tab B','file']);
    assert.deepEqual(base,[p('original')]);
});
test('divergent edits to the same name retain both; retry reuses the same copy',()=>{
    const base=[p('shared')],first=mutatePatternLibrary(base,{type:'save',base,pattern:p('shared','Add')});
    const operation={type:'save',base,pattern:p('shared','Mul')};
    const second=mutatePatternLibrary(first.patterns,operation);
    assert.equal(second.conflict,true);assert.equal(second.pattern.name,'shared（2）');
    assert.deepEqual(second.patterns.map(p=>[p.name,p.nodes[0].type]),[['shared','Add'],['shared（2）','Mul']]);
    const retry=mutatePatternLibrary(second.patterns,operation);
    assert.equal(retry.pattern.name,'shared（2）');assert.equal(retry.patterns.length,2);
    assert.equal(retry.skipped,1);
    const identical=mutatePatternLibrary(first.patterns,{type:'save',base,pattern:p('shared','Add')});
    assert.equal(identical.patterns.length,1);assert.equal(identical.skipped,1);
});
test('a fresh edit can replace its own version after an unrelated peer addition',()=>{
    const base=[p('same'),p('other')],current=[...base,p('peer')];
    const result=mutatePatternLibrary(current,{type:'save',base,pattern:p('same','Transpose')});
    assert.equal(result.renamed,0);assert.equal(result.pattern.name,'same');
    assert.deepEqual(result.patterns.map(p=>p.name),['other','peer','same']);
});
test('legacy priority preserves original bytes; corrupt or future data never falls through to empty/older data',()=>{
    const raw=JSON.stringify([p('v2')]),entries=new Map([['model-lens.patterns.v2',raw]]);
    assert.deepEqual(readLegacyPatterns(storage(entries)),{patterns:[p('v2')],legacyKey:'model-lens.patterns.v2'});
    entries.set('model-lens.patterns.v3','{"schemaVersion":99}');
    assert.throws(()=>readLegacyPatterns(storage(entries)),/原記錄未覆蓋/);
    entries.set('model-lens.patterns.v3','{');assert.throws(()=>readLegacyPatterns(storage(entries)));
    entries.set('model-lens.patterns.v3','[]');assert.deepEqual(readLegacyPatterns(storage(entries)).patterns,[]);
    assert.equal(entries.get('model-lens.patterns.v2'),raw);
    assert.deepEqual(readLegacyPatterns(storage(new Map())).patterns,[]);
});
test('capacity, malformed entries and future records are refused without changing input',()=>{
    const full=Array.from({length:50},(_,i)=>p(`p${i}`)),before=JSON.stringify(full);
    assert.throws(()=>mutatePatternLibrary(full,{type:'save',base:[],pattern:p('new')}),/50/);
    assert.equal(JSON.stringify(full),before);
    assert.throws(()=>cleanPatternLibrary([p('same'),p('same')]));
    assert.throws(()=>readPatternRecord({key:'library',schemaVersion:99,revision:1,patterns:[]}));
    assert.throws(()=>readPatternRecord({key:'library',schemaVersion:1,revision:1,patterns:[{name:'bad'}]}));
    assert.deepEqual(readPatternRecord({key:'library',schemaVersion:1,revision:4,patterns:[p('ok')]}).patterns,[p('ok')]);
});
test('cross-block pattern ports, control flow and conditions survive collision copies and JSON export',async()=>{
    const metadata=await readFile(new URL('../vendor/netron/mlir-metadata.json',import.meta.url),'utf8');
    const model=await parseMLIR(new TextEncoder().encode(MLIR_CFG_LOOP),{metadata});
    const selections=model.graphs.map((g,graph)=>({graph,nodes:g.graph.nodes.map((_,i)=>i)}));
    const pattern={name:'loop',...captureMLIRPattern(model,selections)};
    const conditional=structuredClone(pattern),node=conditional.nodes.find(n=>n.kind==='operator');
    node.conditions=[{kind:'dtype',side:'output',port:0,value:'i32'}];
    const result=mutatePatternLibrary([pattern],{type:'save',base:[],pattern:conditional});
    assert.equal(result.pattern.name,'loop（2）');
    const roundtrip=parsePatternFile(exportPatterns([result.pattern]))[0];
    assert.deepEqual(roundtrip,result.pattern);
    assert.deepEqual(roundtrip.edges,conditional.edges);
    assert.equal((await findMLIRPatterns(model,pattern)).items.length,1);
});
test('unavailable database is an explicit save failure, not a false success',async()=>{
    const store=patternStore({indexedDB:null,legacyStorage:()=>storage(new Map())});
    await assert.rejects(store.save(p('not saved'),[]),/無法保存/);
    await assert.rejects(store.remove(p('not saved')),/無法保存/);
});

test('delete removes only the selected version, remains idempotent and supports an empty persistent record',()=>{
    const base=[p('delete me'),p('keep','Mul')],before=JSON.stringify(base),result=mutatePatternLibrary(base,{type:'delete',pattern:base[0]});
    assert.deepEqual(result.patterns,[base[1]]);assert.equal(result.removed,true);assert.equal(JSON.stringify(base),before);
    const retry=mutatePatternLibrary(result.patterns,{type:'delete',pattern:base[0]});assert.equal(retry.removed,false);assert.deepEqual(retry.patterns,[base[1]]);
    const last=mutatePatternLibrary(result.patterns,{type:'delete',pattern:base[1]});assert.deepEqual(readPatternRecord({key:'library',schemaVersion:1,revision:3,patterns:last.patterns}).patterns,[]);
});
test('a stale delete cannot discard a peer update or unrelated additions',()=>{
    const old=p('shared'),updated=p('shared','Add'),current=[updated,p('peer','Mul')],before=JSON.stringify(current);
    assert.throws(()=>mutatePatternLibrary(current,{type:'delete',pattern:old}),/其他分頁更新/);assert.equal(JSON.stringify(current),before);
    assert.deepEqual(mutatePatternLibrary(current,{type:'delete',pattern:updated}).patterns,[current[1]]);
});
test('stale saves cannot resurrect a deleted pattern; undo restores safely alongside a peer replacement',()=>{
    const original=p('shared'),deleted=mutatePatternLibrary([original],{type:'delete',pattern:original});
    assert.throws(()=>mutatePatternLibrary(deleted.patterns,{type:'save',base:[original],pattern:p('shared','Mul')}),/其他分頁刪除/);
    const restored=mutatePatternLibrary(deleted.patterns,{type:'save',base:[],pattern:original});assert.deepEqual(restored.patterns,[original]);
    const peer=mutatePatternLibrary([],{type:'save',base:[],pattern:p('shared','Add')}),undo=mutatePatternLibrary(peer.patterns,{type:'save',base:[],pattern:original});
    assert.equal(undo.conflict,true);assert.deepEqual(undo.patterns.map(p=>[p.name,p.nodes[0].type]),[['shared','Add'],['shared（2）','Reshape']]);
});
