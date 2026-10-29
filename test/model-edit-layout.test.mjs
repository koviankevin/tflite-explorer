import {test} from 'node:test';
import assert from 'node:assert/strict';
import {modelEditLayout} from '../src/model-edit-layout.js';
const node=(id,inputs=[],graph=0)=>({id,source:{graph},inputs:inputs.map(value=>({value}))});
const noOverlap=plan=>{const ps=[...plan.positions.values()];for(let i=0;i<ps.length;i++)for(let j=i+1;j<ps.length;j++){const a=ps[i],b=ps[j];assert.ok(a.x+a.width<=b.x||b.x+b.width<=a.x||a.y+a.height<=b.y||b.y+b.height<=a.y,JSON.stringify({a,b}));}};
test('tensor dependencies separate a fork and merge using actual long-card heights',()=>{
 const nodes=[node('a'),node('b',['a']),node('c',['a']),node('d',['b','c'])],values=new Map(nodes.map(n=>[n.id,{producer:n.id}])),sizes=new Map([['a',400],['b',950],['c',240],['d',1200]]);
 const plan=modelEditLayout(nodes,values,sizes,{width:470}),p=plan.positions;assert.equal(p.get('b').x,p.get('c').x);assert.ok(p.get('a').x<p.get('b').x&&p.get('b').x<p.get('d').x);assert.ok(p.get('c').y>=p.get('b').y+950+64);noOverlap(plan);
 assert.deepEqual(modelEditLayout(nodes,values,sizes,{width:470}),plan,'Repeated layout is stable and does not change model state');
});
test('disconnected nodes, subgraphs and temporarily cyclic drafts remain distinct',()=>{
 const nodes=[node('a',['c']),node('b'),node('c',['a']),node('new',['b']),node('child',[],1)],values=new Map(nodes.map(n=>[n.id,{producer:n.id}]));
 const plan=modelEditLayout(nodes,values,new Map(nodes.map(n=>[n.id,700])));assert.equal(plan.positions.size,5);assert.equal(plan.blocks.length,2);assert.ok(plan.positions.get('child').y>plan.positions.get('new').y);noOverlap(plan);
});
test('96 cards with multiple branches never overlap at large measured sizes',()=>{
 const nodes=Array.from({length:96},(_,i)=>node(String(i),i>3?[String(Math.floor((i-1)/3))]:[])),values=new Map(nodes.map(n=>[n.id,{producer:n.id}]));
 const plan=modelEditLayout(nodes,values,new Map(nodes.map((n,i)=>[n.id,300+i%7*120])),{width:470});assert.equal(plan.positions.size,96);noOverlap(plan);
});
