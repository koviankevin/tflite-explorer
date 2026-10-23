import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {parseMLIR} from '../src/mlir-engine.js';
import {captureMLIRPattern,findMLIRPatterns,mlirMatchSnapshot} from '../src/mlir-pattern.js';
import {layout} from '../vendor/netron/dagre.js';
import {MLIR_CFG_LOOP} from './mlir-fixture.mjs';
import {foldPatternSnapshot} from '../src/pattern-fold.js';

// The same parent/edge contract sent by grapher.Graph.layout to the browser
// Worker. Fixed nonzero label measurements isolate topology from DOM fonts.
function layoutProjection(graph,{font=14,direction='TB'}={}) {
    const nodes=[],edges=[],owners=new Map(),groups=new Set(),pairs=new Set();
    for(const [i,arg] of graph.inputs.entries()) {
        const v=`input:${i}`;nodes.push({v,width:font*8,height:font*2});
        for(const value of arg.value)owners.set(value.name,v);
    }
    for(const node of graph.nodes) {
        const parent=graph.groups && node.group?`group:${node.group}`:undefined;
        if(parent)groups.add(parent);
        nodes.push({v:node.identifier,width:font*8,height:font*2,parent});
        for(const a of node.outputs)for(const value of a.value)owners.set(value.name,node.identifier);
    }
    nodes.push(...[...groups].map(v=>({v,width:0,height:0})));
    for(const node of graph.nodes)for(const value of [...node.inputs.flatMap(a=>a.value),...(node.controlDependencies || [])]) {
        const v=owners.get(value.name),w=node.identifier,key=`${v}>${w}`;
        if(v===undefined || pairs.has(key))continue;pairs.add(key);
        edges.push({v,w,minlen:1,weight:1,width:font*8,height:font,labeloffset:10,labelpos:'r'});
    }
    layout(nodes,edges,{nodesep:20,ranksep:20,rankdir:direction},{});
    return {nodes,edges};
}

test('a captured custom op in a loop lays out with its external condition and loop-carried SSA',async()=>{
    const index=await parseMLIR(new TextEncoder().encode(MLIR_CFG_LOOP),{metadata:await readFile(new URL('../vendor/netron/mlir-metadata.json',import.meta.url),'utf8')});
    const pattern=captureMLIRPattern(index,[{graph:1,nodes:[0]}]),result=await findMLIRPatterns(index,pattern);
    assert.equal(result.items.length,1);
    const dto=mlirMatchSnapshot(index,result.items[0]);
    assert.ok(dto.graph.inputs.length,'loop condition is an external SSA boundary');
    assert.ok(dto.links.some(e=>e.from==='route:1:0' && e.to==='b1'),'retain actual self-loop control');
    for(const font of [14,32])for(const direction of ['TB','LR']) {
        const placed=layoutProjection(dto.graph,{font,direction});
        assert.ok(placed.nodes.every(n=>Number.isFinite(n.x) && Number.isFinite(n.y)));
        assert.ok(placed.edges.every(e=>e.points?.length>=2));
    }
});

test('all connected loop operator selections retain finite compound layouts',async()=>{
    const index=await parseMLIR(new TextEncoder().encode(MLIR_CFG_LOOP),{metadata:await readFile(new URL('../vendor/netron/mlir-metadata.json',import.meta.url),'utf8')});
    const locations=index.graphs.flatMap((g,graph)=>g.graph.nodes.map((_,node)=>({graph,node})));let checked=0;
    for(let mask=1;mask<(1<<locations.length);mask++) {
        const selections=[];
        for(const [i,loc] of locations.entries())if(mask&(1<<i)){let b=selections.find(b=>b.graph===loc.graph);if(!b){b={graph:loc.graph,nodes:[]};selections.push(b);}b.nodes.push(loc.node);}
        let pattern;
        try{pattern=captureMLIRPattern(index,selections);}catch(e){if(/連成同一組/.test(e.message))continue;throw e;}
        const result=await findMLIRPatterns(index,pattern);assert.ok(result.items.length);
        for(const item of result.items)for(const font of [14,32])for(const direction of ['TB','LR']) {
            let placed;
            assert.doesNotThrow(()=>{placed=layoutProjection(mlirMatchSnapshot(index,item).graph,{font,direction});},JSON.stringify({selections,font,direction}));
            assert.ok(placed.nodes.every(n=>Number.isFinite(n.x)&&Number.isFinite(n.y)));checked++;
        }
    }
    assert.ok(checked>=20);
});

test('folded loop with incoming and outgoing control/SSA lays out at both font extremes and directions',async()=>{
    const cyclic=MLIR_CFG_LOOP.replace('  "cf.cond_br"(%condition, %next, %next)[^loop, ^exit]',`  "cf.br"(%next)[^latch] : (i32) -> ()
^latch(%carried: i32):
  "cf.cond_br"(%condition, %carried, %carried)[^loop, ^exit]`);
    for(const source of [MLIR_CFG_LOOP,cyclic]) {
        const index=await parseMLIR(new TextEncoder().encode(source),{metadata:await readFile(new URL('../vendor/netron/mlir-metadata.json',import.meta.url),'utf8')});
        const pattern=captureMLIRPattern(index,[{graph:1,nodes:[0]}]),item=(await findMLIRPatterns(index,pattern)).items[0];
        const dto=foldPatternSnapshot(mlirMatchSnapshot(index,item,{boundaryContext:true}));
        for(const font of [14,32])for(const direction of ['TB','LR']) {
            const placed=layoutProjection(dto.graph,{font,direction});
            assert.ok(placed.nodes.every(n=>Number.isFinite(n.x) && Number.isFinite(n.y)));
            assert.ok(placed.edges.every(e=>e.points?.length>=2));
        }
    }
});

