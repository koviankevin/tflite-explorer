import test from 'node:test';
import assert from 'node:assert/strict';
import {lazyAdjacency} from '../src/lazy-adjacency.js';

test('read-only traversal keeps exact degree, membership and order, and sees materialized row mutations',()=>{
    const topology=lazyAdjacency([[2,1,2],[],[]],(row,add)=>row.forEach(add)),view=topology.nextNodes(0);
    assert.equal(view.size,2);assert.deepEqual([...view],[2,1]);assert.equal(view.has(2),true);assert.equal(view.has(0),false);assert.equal(view.has('2'),false);
    const mutable=topology.next[0];mutable.delete(2);mutable.add(0);
    assert.equal(view.size,2);assert.deepEqual([...view],[1,0]);assert.equal(view.has(2),false);assert.equal(view.has(0),true);
    assert.equal(topology.nextNodes(0),mutable);assert.deepEqual([...topology.previousNodes(2)],[0]);
    const assigned=[new Set([9])];topology.previous=assigned;assert.equal(topology.previousNodes(0),assigned[0]);
    assert.equal(topology.nextNodes(-1),undefined);assert.equal(topology.previousNodes(3),undefined);
});

test('high fan-out membership promotes only the requested row and retains exact Set membership',()=>{
    const nodes=Array.from({length:48},()=>[]);nodes[0]=Array.from({length:32},(_,i)=>32-i);
    const topology=lazyAdjacency(nodes,(row,add)=>row.forEach(add)),view=topology.nextNodes(0);
    assert.equal(view.has(32),true);assert.equal(view.has('32'),false);assert.equal(view.has(NaN),false);assert.equal(view.size,32);
    const mutable=topology.nextNodes(0);mutable.add(47);assert.equal(view.has(47),true);assert.equal(view.size,33);
    assert.deepEqual([...view],[...nodes[0],47]);assert.deepEqual([...topology.previousNodes(32)],[0]);
});

test('individual neighbors reuse read views without expanding unrelated rows',()=>{
    const topology=lazyAdjacency([[1,2],[2],[]],(row,add)=>row.forEach(add));
    const next=topology.nextNodes(0),previous=topology.previousNodes(2);
    assert.equal(topology.nextNodes(0),next);assert.equal(topology.previousNodes(2),previous);
    topology.next[0].add(0);topology.previous[2].add(99);assert.deepEqual([...next],[1,2,0]);assert.deepEqual([...previous],[0,1,99]);
    assert.equal(topology.nextNodes(1),topology.next[1]);assert.deepEqual([...topology.previous[0]],[]);
    assert.equal(topology.nextNodes(-1),undefined);assert.equal(topology.previousNodes(3),undefined);
    const assigned=[new Set([7])];topology.next=assigned;assert.equal(topology.nextNodes(0),assigned[0]);
});

test('encoded topology preserves order, duplicate edges, self loops and independent normal Set arrays',()=>{
    const nodes=[[2,1,2,0],[3],[3],[],[4]],topology=lazyAdjacency(nodes,(targets,add)=>targets.forEach(add));
    nodes[0].push(4);nodes[1]=[];
    assert.deepEqual(topology.next.map(s=>[...s]),[[2,1,0],[3],[3],[],[4]]);
    topology.next[0].add(4);topology.next[3].add(4);
    assert.deepEqual(topology.previous.map(s=>[...s]),[[0],[0],[0],[1,2],[4]]);
    assert.ok(Array.isArray(topology.next)&&topology.next.every(s=>s instanceof Set));assert.deepEqual(structuredClone(topology),{next:topology.next,previous:topology.previous});
    assert.notEqual(topology.next[0],topology.previous[0]);
    const assigned=[new Set([99])];topology.next=assigned;assert.equal(topology.next,assigned);topology.previous=null;assert.equal(topology.previous,null);
});

test('reverse-first materialization, sparse and empty graphs preserve own arrays and independent empty Sets',()=>{
    const nodes=new Array(4);nodes[0]=[3];nodes[3]=[];const topology=lazyAdjacency(nodes,(list,add)=>list.forEach(add));
    assert.equal(topology.previous.length,4);assert.equal(1 in topology.previous,false);assert.equal(2 in topology.next,false);assert.deepEqual([...topology.previous[3]],[0]);
    const empty=lazyAdjacency([[],[]],()=>{});empty.next[0].add(1);assert.equal(empty.next[1].size,0);assert.equal(empty.previous[1].size,0);
    assert.deepEqual(structuredClone(lazyAdjacency([],()=>assert.fail('No nodes.'))),{next:[],previous:[]});
    for(const invalid of [-1,4,NaN,1.5,'0'])assert.throws(()=>lazyAdjacency([[]],(_,add)=>add(invalid)),/Invalid adjacency/);
    assert.throws(()=>lazyAdjacency(nodes,(_,add)=>add(1)),/Invalid adjacency/);
});

test('deterministic branching and cyclic graph corpus matches eager topology in both directions',()=>{
    let seed=0x12345678;const random=n=>{seed^=seed<<13;seed^=seed>>>17;seed^=seed<<5;return (seed>>>0)%n;};
    for(let sample=0;sample<200;sample++){
        const length=1+random(40),nodes=Array.from({length},()=>Array.from({length:random(12)},()=>random(length))),next=nodes.map(row=>new Set(row)),previous=nodes.map(()=>new Set());
        next.forEach((to,from)=>{for(const i of to)previous[i].add(from);});
        const actual=lazyAdjacency(nodes,(row,add)=>row.forEach(add));
        for(let row=0;row<length;row++){
            const forward=actual.nextNodes(row),reverse=actual.previousNodes(row);
            assert.equal(forward.size,next[row].size);assert.equal(reverse.size,previous[row].size);
            assert.deepEqual([...forward],[...next[row]]);assert.deepEqual([...reverse],[...previous[row]]);
            for(let candidate=0;candidate<length;candidate++){
                assert.equal(forward.has(candidate),next[row].has(candidate));assert.equal(reverse.has(candidate),previous[row].has(candidate));
            }
        }
        if(sample%2)assert.deepEqual(actual.previous,previous);else assert.deepEqual(actual.next,next);
        assert.deepEqual(structuredClone(actual),{next,previous});
    }
});
