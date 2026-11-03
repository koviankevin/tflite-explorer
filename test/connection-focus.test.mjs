import {test} from 'node:test';
import assert from 'node:assert/strict';
import {connectionIndex} from '../src/connection-focus.js';

test('focus retains branch, merge, parallel SSA/control and loop direction without matching unrelated edges',()=>{
    const edges=[['a','b'],['a','c'],['b','d'],['c','d'],['d','a'],['b','b'],['a','b'],['x','y']].map(([from,to])=>({from,to})),index=connectionIndex(edges);
    assert.deepEqual([...index.focus(['b','b'])].map(([e,mask])=>[edges.indexOf(e),mask]).sort((a,b)=>a[0]-b[0]),[[0,1],[2,2],[5,3],[6,1]]);
    const both=index.focus(['a','b']);assert.equal(both.get(edges[0]),3);assert.equal(both.get(edges[1]),2);assert.equal(both.get(edges[4]),1);assert.equal(both.has(edges[3]),false);assert.equal(both.has(edges[7]),false);
    assert.equal(index.focus([]).size,0);assert.equal(index.focus(['missing']).size,0);
    assert.equal(index.focus(['a']).get(edges[0]),2,'Earlier focused sets must not contaminate a new selection.');
});

test('large graph focus consults the indexed adjacency without rereading all edge endpoints',()=>{
    let reads=0;const edges=Array.from({length:21005},(_,i)=>({get from(){reads++;return i;},get to(){reads++;return i+1;}})),index=connectionIndex(edges),built=reads;
    for(let i=0;i<1000;i++){const focus=index.focus([i]);assert.equal(focus.size,i===0?1:2);}
    assert.equal(reads,built);assert.equal(index.focus(['1']).get(edges[0]),1,'Numeric and string model identifiers refer to the same node.');
});
