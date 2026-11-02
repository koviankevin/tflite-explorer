import {test} from 'node:test';
import assert from 'node:assert/strict';
import {overviewLayout} from '../src/overview-layout.js';

test('short OPs stay compact beside long custom names, including cyclic components at 32px',()=>{
    const nodes=['Add','company.very_long_custom_operator_'.repeat(8),'乘法'].map((name,i)=>({identifier:String(i),name,type:{name},diagramKind:'operator',sourceGraph:1,sourceNode:i}));
    for(const font of [14,32])for(const direction of ['vertical','horizontal']){
        const layout=overviewLayout(nodes,[{from:'0',to:'1'},{from:'1',to:'0'},{from:'1',to:'2'}],{font,direction}),[short,long]=layout.nodes;
        assert.ok(short.width<long.width,'a short title must not inherit the longest width');
        assert.ok(short.width<=font*9+32,'short names should avoid the old 28-em allocation');
        assert.ok(long.width<=font*18+24,'long custom titles must be bounded');
        for(const a of layout.nodes){assert.ok(a.minX>=0&&a.minY>=0&&a.maxX<=layout.width&&a.maxY<=layout.height);for(const b of layout.nodes)if(a!==b)assert.ok(a.maxX<=b.minX||b.maxX<=a.minX||a.maxY<=b.minY||b.maxY<=a.minY);}
        assert.deepEqual(layout.edges.map(({from,to})=>({from,to})),[{from:'0',to:'1'},{from:'1',to:'0'},{from:'1',to:'2'}]);
    }
});
