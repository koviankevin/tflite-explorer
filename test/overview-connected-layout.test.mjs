import {test} from 'node:test';
import assert from 'node:assert/strict';
import {overviewLayout,spatialIndex} from '../src/overview-layout.js';

const node=identifier=>({identifier,group:'model',diagramKind:'operator',type:{name:'company.custom'}});
const edge=(from,to,kind='ssa')=>({from,to,kind});
const cross=(n,direction)=>direction==='vertical'?n.x+n.width/2:n.y+n.height/2;
const main=(n,direction)=>direction==='vertical'?n.y:n.x;
const options=[14,32].flatMap(font=>['vertical','horizontal'].map(direction=>({font,direction})));

test('a wide input rank centers its narrow trunk on the connected inputs instead of the left edge',()=>{
    const inputs=Array.from({length:40},(_,i)=>node('input'+i)),trunk=Array.from({length:8},(_,i)=>node('op'+i));
    const links=inputs.map(n=>edge(n.identifier,'op0')).concat(trunk.slice(1).map((n,i)=>edge('op'+i,n.identifier)));
    for(const o of options){const l=overviewLayout([...inputs,...trunk],links,o),byId=new Map(l.nodes.map(n=>[n.identifier,n]));
        const center=inputs.reduce((s,n)=>s+cross(byId.get(n.identifier),o.direction),0)/inputs.length;
        for(const n of trunk)assert.ok(Math.abs(cross(byId.get(n.identifier),o.direction)-center)<1,'the main data flow must follow its actual input center');
    }
});

test('a fork and join align with their branches in either direction at large fonts',()=>{
    const nodes=['start','left','right','join','tail'].map(node),links=[edge('start','left'),edge('start','right'),edge('left','join'),edge('right','join'),edge('join','tail')];
    for(const o of options){const l=overviewLayout(nodes,links,o),p=new Map(l.nodes.map(n=>[n.identifier,n])),center=(cross(p.get('left'),o.direction)+cross(p.get('right'),o.direction))/2;
        for(const id of ['start','join','tail'])assert.ok(Math.abs(cross(p.get(id),o.direction)-center)<1,id+' should align with its branches');
        assert.equal(main(p.get('left'),o.direction),main(p.get('right'),o.direction));
    }
});

test('independent late inputs sit near their consumers rather than making one enormous first rank',()=>{
    const count=80,nodes=Array.from({length:count},(_,i)=>node('op'+i)).concat(Array.from({length:count-1},(_,i)=>node('weight'+i)));
    const links=Array.from({length:count-1},(_,i)=>edge('op'+i,'op'+(i+1))).concat(Array.from({length:count-1},(_,i)=>edge('weight'+i,'op'+(i+1))));
    for(const o of options){const l=overviewLayout(nodes,links,o),p=new Map(l.nodes.map(n=>[n.identifier,n])),span=o.direction==='vertical'?l.width:l.height,size=o.direction==='vertical'?p.get('op0').width:p.get('op0').height;
        assert.ok(span<size*6,'local side inputs must not force the entire model to zoom out');
        for(let i=0;i<count-1;i++){const weight=p.get('weight'+i),consumer=p.get('op'+(i+1));assert.equal(main(weight,o.direction),main(p.get('op'+i),o.direction));assert.ok(main(weight,o.direction)<main(consumer,o.direction));}
    }
});

test('long bypasses and loop controls retain endpoints and use bounded side routes included in viewport bounds',()=>{
    const nodes=['a','b','c','d','exit'].map(node),links=[edge('a','b'),edge('b','c'),edge('c','d'),edge('a','d'),edge('d','d','control'),edge('d','exit','control')];
    for(const o of options){const l=overviewLayout(nodes,links,o),p=new Map(l.nodes.map(n=>[n.identifier,n])),index=spatialIndex(l.edges);
        assert.deepEqual(l.edges.map(({from,to,kind})=>({from,to,kind})),links);
        for(const e of l.edges.filter(e=>e.from==='a'&&e.to==='d'||e.from===e.to)){
            assert.equal(e.route,'side');assert.ok(e.points.length>=4);const lane=o.direction==='vertical'?e.points[2].x:e.points[2].y,lo=Math.min(...l.nodes.map(n=>o.direction==='vertical'?n.x:n.y)),hi=Math.max(...l.nodes.map(n=>o.direction==='vertical'?n.maxX:n.maxY));assert.ok(lane<lo||lane>hi,'the long segment must run outside the node columns');
            assert.ok(e.minX>=0&&e.minY>=0&&e.maxX<=l.width&&e.maxY<=l.height);const point=e.points[2];assert.ok(index.query({minX:point.x-1,maxX:point.x+1,minY:point.y-1,maxY:point.y+1}).includes(e));
        }
        assert.equal(p.size,nodes.length);
    }
});

test('connection ordering is deterministic, preserves source objects and never overlaps nodes or scope lanes',()=>{
    let seed=235;const random=()=>((seed=Math.imul(seed,1664525)+1013904223>>>0)/2**32);
    const nodes=Array.from({length:240},(_,i)=>({...node(String(i)),group:'function'+Math.floor(i/120)})),links=[];
    for(let scope=0;scope<2;scope++)for(let i=0;i<120;i++){if(i%12!==11)links.push(edge(String(scope*120+i),String(scope*120+i+1)));if(i>12&&random()<.7)links.push(edge(String(scope*120+i-12),String(scope*120+i)));if(i%29===0)links.push(edge(String(scope*120+i),String(scope*120+i),'control'));}
    const original=JSON.stringify({nodes,links});
    for(const o of options){const l=overviewLayout(nodes,links,o);assert.deepEqual(overviewLayout(nodes,links,o),l);assert.equal(JSON.stringify({nodes,links}),original);
        for(let i=0;i<l.nodes.length;i++){const a=l.nodes[i];assert.ok(a.minX>=0&&a.minY>=0&&a.maxX<=l.width&&a.maxY<=l.height);for(let j=i+1;j<l.nodes.length;j++){const b=l.nodes[j];assert.ok(a.maxX<=b.minX||b.maxX<=a.minX||a.maxY<=b.minY||b.maxY<=a.minY,'nodes must remain individually selectable');}}
        assert.equal(l.groups.length,2);assert.deepEqual(l.edges.map(({from,to,kind})=>({from,to,kind})),links);assert.ok(l.edges.every(e=>e.minX>=0&&e.minY>=0&&e.maxX<=l.width&&e.maxY<=l.height));
    }
});
