import test from 'node:test';
import assert from 'node:assert/strict';
import {indexModel,search,findPatterns} from '../src/model-engine.js';

const value=(identifier,name)=>({identifier,name,type:{dataType:'float32',shape:{dimensions:[1,2]}}});
const argument=value=>({name:'port',value});
const node=(identifier,type,inputs,outputs)=>({identifier,name:'',type:{name:type},inputs,outputs});

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
