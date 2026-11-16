import test from 'node:test';
import assert from 'node:assert/strict';
import {indexModel,search,findPatterns,selectNodes} from '../src/model-engine.js';
import {findSubgraphPatterns,prepareGraphPattern} from '../src/subgraph-pattern.js';

const value=(identifier,name)=>({identifier,name,type:{dataType:'float32',shape:{dimensions:[1,2]}}});
const argument=value=>({name:'port',value});
const node=(identifier,type,inputs,outputs)=>({identifier,name:'',type:{name:type},inputs,outputs});

test('full pattern scans read topology without retaining one Set per visited layer',async()=>{
    const count=96,values=Array.from({length:count+1},(_,i)=>value(String(i),'signal-'+i));
    const modules=[{inputs:[argument([values[0]])],outputs:[argument([values.at(-1)])],nodes:Array.from({length:count},(_,i)=>node(String(i),['Reshape','Transpose','Reshape'][i%3],[argument([values[i]])],[argument([values[i+1]])]))}];
    for(const graphSearch of [false,true]){
        const index=indexModel({modules}),NativeSet=globalThis.Set;let constructions=0;
        globalThis.Set=new Proxy(NativeSet,{construct(target,args){constructions++;return Reflect.construct(target,args,target);}});
        try{
            const result=graphSearch?await findSubgraphPatterns(index,{...prepareGraphPattern([{alias:'a',type:'Reshape'},{alias:'b',type:'Transpose'},{alias:'c',type:'Reshape'}],[{from:'a',to:'b'},{from:'b',to:'c'}]),induced:true}):await findPatterns(index,['Reshape','Transpose','Reshape']);
            assert.deepEqual(result.items.map(item=>item.path),Array.from({length:count/3},(_,i)=>[i*3,i*3+1,i*3+2]));
        }finally{globalThis.Set=NativeSet;}
        assert.ok(constructions<12,`${graphSearch?'Graph':'Linear'} search constructed ${constructions} Sets for ${count} operators.`);
    }
});

test('indexing and first local view avoid two extra whole-model Set vectors',()=>{
    const count=64,values=Array.from({length:count+1},(_,i)=>value(String(i),'signal-'+i)),nodes=Array.from({length:count},(_,i)=>node(String(i),'Reshape',[argument([values[i]])],[argument([values[i+1]])]));
    const NativeSet=globalThis.Set;let constructions=0,index;
    globalThis.Set=new Proxy(NativeSet,{construct(target,args){constructions++;return Reflect.construct(target,args,target);}});
    try{index=indexModel({modules:[{inputs:[argument([values[0]])],outputs:[argument([values.at(-1)])],nodes}]});assert.deepEqual([...selectNodes(index.graphs[0],[0])],[0,1]);}finally{globalThis.Set=NativeSet;}
    assert.ok(constructions<count*2,`Index and first local view created ${constructions} Sets for ${count} operators.`);
    const g=index.graphs[0];assert.deepEqual(g.next.map(s=>[...s]),nodes.map((_,i)=>i+1<count?[i+1]:[]));assert.deepEqual(g.previous.map(s=>[...s]),nodes.map((_,i)=>i?[i-1]:[]));
    assert.deepEqual(structuredClone(g.next),g.next);assert.ok(g.next.every(s=>s instanceof NativeSet));
});

test('topology captures the original graph and exposes independent mutable cloneable Set arrays',()=>{
    const a=value('0','a'),b=value('1','b'),c=value('2','c'),nodes=[node('0','Add',[argument([a])],[argument([b])]),node('1','Add',[argument([b])],[argument([c])])];
    const entry=indexModel({modules:[{inputs:[argument([a])],outputs:[argument([c])],nodes}]}).graphs[0];
    nodes[0].outputs=[];nodes.push(node('2','Other',[],[]));
    assert.deepEqual(entry.previous.map(s=>[...s]),[[],[0]]);assert.deepEqual(entry.next.map(s=>[...s]),[[1],[]]);
    entry.next[0].add(0);assert.deepEqual([...entry.previous[0]],[]);entry.previous[0].add(99);assert.deepEqual([...entry.next[0]],[1,0]);
    const replacement=[new Set([77])];entry.next=replacement;assert.equal(entry.next,replacement);entry.previous=undefined;assert.equal(entry.previous,undefined);
});

test('indexing preserves branch and loop edges, repeated uses and all producers even when an identifier is redefined',async()=>{
    const input=value('0','入口\n原始'),alias=value('0','入口替代\n資訊'),middle=value('1','middle'),loop=value('3','loop'),output=value('2',''),extra=value('9','extra\n資訊');
    const graph={inputs:[argument([input])],outputs:[argument([output])],nodes:[
        node('0','Reshape',[argument([null,undefined,42,'ignored',{},alias]),argument({identifier:'ignored'}),argument(new Int32Array([0]))],[argument([middle])]),
        node('1','Transpose',[argument([middle])],[argument([loop])]),
        node('2','company.merge',[argument([middle,loop,loop])],[argument([output])]),
        node('3','company.loop',[argument([output])],[argument([middle])])
    ]};
    const model={modules:[graph]},index=indexModel(model,(tensors,g)=>{
        assert.equal(g,0);assert.deepEqual([...tensors.keys()],['0','2','1','3']);
        assert.equal(tensors.get('0'),alias);middle.name='updated\n名稱';graph.nodes[0].name='來源選取';tensors.set('9',extra);
    }),entry=index.graphs[0];
    assert.equal(index.model,model);assert.equal(entry.graph,graph);assert.deepEqual([...entry.tensors.keys()],['0','2','1','3','9']);
    assert.deepEqual([...entry.producers],[['1',3],['3',1],['2',2]]);
    assert.deepEqual([...entry.consumers].map(([id,uses])=>[id,[...uses]]),[['0',[0]],['1',[1,2]],['3',[2]],['2',[3]]]);
    assert.deepEqual(entry.next.map(s=>[...s]),[[1,2],[2],[3],[1,2]]);
    assert.deepEqual(entry.previous.map(s=>[...s]),[[],[0,3],[0,1,3],[2]]);
    assert.equal(search(index,'layers','#0')[0].text,'來源選取 入口替代 updated reshape reshape 0');
    assert.equal(search(index,'tensors','#1')[0].label,'updated');
    assert.equal(search(index,'tensors','#1')[0].operator,'Transpose company.merge company.loop');
    assert.equal(search(index,'tensors','#2')[0].label,'Tensor #2');
    assert.equal(search(index,'tensors','#2')[0].operator,'company.loop company.merge');
    assert.equal(search(index,'tensors','#9')[0].text,'extra\n資訊  ');
    assert.deepEqual((await findPatterns(index,['Reshape','Transpose','company.merge','company.loop'])).items.map(p=>p.path),[[0,1,2,3]]);
    assert.deepEqual((await findPatterns(index,['company.loop','Transpose','company.merge'])).items.map(p=>p.path),[[3,1,2]]);
});

test('subgraph namespaces, scalar shapes and first-line display preserve exact lookup and source values',()=>{
    const a=value('0','first\r\nrest'),b=value('0','第二\n行');a.type.shape.dimensions=[];
    const graphs=[a,b].map((v,g)=>({inputs:[argument([v])],outputs:[argument([v])],nodes:[node('0',g?'custom.Op':'Add',[argument([v])],[argument([v])])]}));
    const index=indexModel({modules:graphs});assert.deepEqual(search(index,'tensors','#0').map(r=>[r.graph,r.label,r.shape]),[[0,'first\r',[]],[1,'第二',[1,2]]]);
    assert.deepEqual(search(index,'layers','#0','1').map(r=>r.operator),['custom.Op']);assert.equal(index.graphs[0].tensors.get('0'),a);assert.equal(index.graphs[1].tensors.get('0'),b);assert.equal(a.name,'first\r\nrest');
});

test('tensor search records are built on first tensor search and reused',()=>{
    let reads=0;
    const tensor={identifier:'0',name:'signal',get type(){reads++;return {dataType:'float32',shape:{dimensions:[1]}};}};
    const op=node('0','Reshape',[argument([tensor])],[]);
    const index=indexModel({modules:[{inputs:[argument([tensor])],outputs:[],nodes:[op]}]});
    assert.equal(search(index,'layers','#0').length,1);
    assert.equal(reads,0);
    const [result]=search(index,'tensors','signal');
    assert.equal(result.dtype,'float32');
    assert.deepEqual(result.shape,[1]);
    assert.equal(search(index,'tensors','#0')[0],result);
    assert.equal(reads,2);
});
