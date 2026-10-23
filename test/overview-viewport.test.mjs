import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {overviewLayout,spatialIndex,OverviewCamera} from '../src/overview-layout.js';
import {parseMLIR} from '../src/mlir-engine.js';
import {captureMLIRPattern,findMLIRPatterns} from '../src/mlir-pattern.js';
import {preparePatternOverview,patternOverviewSnapshot} from '../src/pattern-overview.js';
import {MLIR_CFG_LOOP} from './mlir-fixture.mjs';

test('a 50k OP chain has a finite iterative layout and a distant viewport loads a bounded different set',()=>{
    const nodes=Array.from({length:50000},(_,i)=>({identifier:String(i),name:'custom.very_long_operator_name',group:'function',diagramKind:'operator'})),edges=nodes.slice(1).map((n,i)=>({from:String(i),to:n.identifier,kind:'ssa'}));
    const layout=overviewLayout(nodes,edges),index=spatialIndex(layout.nodes),camera=new OverviewCamera(1100,720);
    assert.equal(layout.nodes.length,50000);assert.equal(layout.edges.length,49999);
    assert.ok(layout.nodes.every(n=>Number.isFinite(n.x+n.y+n.width+n.height)));
    camera.focus([layout.nodes[0]],1);const first=index.query(camera.bounds(80));assert.ok(first.length<20);
    camera.focus([layout.nodes[49000]],1);const last=index.query(camera.bounds(80));assert.ok(last.length<20);assert.ok(last.some(n=>n.identifier==='49000'));assert.ok(last.every(n=>!first.includes(n)));
});

test('spatial queries retain crossing edges whose endpoints are both offscreen, including loop control curves',()=>{
    const nodes=['a','b','join','loop','exit'].map(identifier=>({identifier,group:'region'})),edges=[['a','join','ssa'],['b','join','ssa'],['join','loop','ssa'],['loop','loop','control'],['loop','exit','control']].map(([from,to,kind])=>({from,to,kind}));
    for(const font of [14,32])for(const direction of ['vertical','horizontal']){
        const layout=overviewLayout(nodes,edges,{font,direction}),index=spatialIndex(layout.edges);
        assert.equal(layout.edges.length,edges.length);assert.equal(layout.edges.filter(e=>e.kind==='control').length,2);
        for(const edge of layout.edges){const rect={minX:(edge.minX+edge.maxX)/2-1,maxX:(edge.minX+edge.maxX)/2+1,minY:(edge.minY+edge.maxY)/2-1,maxY:(edge.minY+edge.maxY)/2+1};
            const expected=layout.edges.filter(e=>e.minX<=rect.maxX && e.maxX>=rect.minX && e.minY<=rect.maxY && e.maxY>=rect.minY);
            assert.deepEqual(new Set(index.query(rect)),new Set(expected));assert.ok(index.query(rect).includes(edge));
        }
    }
    const crossing={minX:-1000,minY:10,maxX:1000,maxY:11};assert.deepEqual(spatialIndex([crossing]).query({minX:0,minY:0,maxX:100,maxY:100}),[crossing]);
});

test('zooming preserves the point under the cursor; pan, focus and resizing keep coordinates invertible',()=>{
    const camera=new OverviewCamera(390,500);camera.fit({width:500000,height:1000000});
    const at=camera.world(240,180);camera.zoomAt(17,240,180);assert.ok(Math.abs(camera.world(240,180).x-at.x)<1e-6);assert.ok(Math.abs(camera.world(240,180).y-at.y)<1e-6);
    camera.pan(113,-79);const p=camera.world(240,180);assert.ok(Math.abs(p.x-(at.x-113/camera.zoom))<1e-6);
    camera.focus([{x:8000,y:30000,width:600,height:90}],.7);const center=camera.world(195,250);assert.ok(Math.abs(center.x-8300)<1e-6);assert.ok(Math.abs(center.y-30045)<1e-6);
    camera.width=1;camera.height=1;camera.fit({width:500000,height:1000000});assert.ok(camera.zoom>0 && Number.isFinite(camera.x+camera.y));
});

test('a large custom-op MLIR overview preserves all control and SSA endpoints across independent functions',async()=>{
    const source=Array.from({length:160},(_,i)=>MLIR_CFG_LOOP.replace('sym_name = "loop"',`sym_name = "loop_${i}"`)).join('\n');
    const index=await parseMLIR(new TextEncoder().encode(source),{metadata:await readFile(new URL('../vendor/netron/mlir-metadata.json',import.meta.url),'utf8')});
    const pattern=captureMLIRPattern(index,[{graph:1,nodes:[0]}]),items=(await findMLIRPatterns(index,pattern)).items;
    assert.equal(items.length,160);const plan=await preparePatternOverview(index,items),dto=patternOverviewSnapshot(plan,{expanded:items.map((_,i)=>i),font:32,direction:'horizontal'});
    assert.equal(dto.virtual,true);assert.ok(dto.nodes.length>1500);assert.equal(dto.layout.edges.length,dto.links.length);
    const nodes=new Map(dto.layout.nodes.map(n=>[n.identifier,n]));assert.ok(dto.links.filter(e=>e.kind==='control').length>=640);
    for(const e of dto.links){const a=nodes.get(e.from),b=nodes.get(e.to);assert.ok(a && b);assert.equal(a.group.split('/')[0],b.group.split('/')[0]);}
    assert.ok(dto.layout.nodes.some(n=>n.type?.name==='company.step'));assert.ok(dto.layout.nodes.every(n=>!('attributes' in n) && !('inputs' in n)));
});
