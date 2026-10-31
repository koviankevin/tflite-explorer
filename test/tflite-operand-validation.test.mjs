import {operandFixture} from './operand-fixture.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {tflite as s} from '../vendor/netron/tflite-schema.js';
import {validateTfliteConstants} from '../src/tflite-constant-checks.js';
import {checkOperatorMetadata} from '../src/tflite-semantic-checks.js';
const tensor=(shape,type=0,values)=>({shape,type,values});

const cases=[
    ['PAD',[tensor([2,3]),tensor([2,2],2,[1,0,2,1])],[tensor([3,6])],{}],
    ['PADV2',[tensor([2]),tensor([1,2],4,[1n,2n]),tensor([],0)],[tensor([5])],{}],
    ['SLICE',[tensor([4,5]),tensor([2],4,[1n,2n]),tensor([2],4,[-1n,2n])],[tensor([3,2])],{}],
    ['STRIDED_SLICE',[tensor([5]),tensor([1],2,[0]),tensor([1],2,[0]),tensor([1],2,[-1])],[tensor([5])],{begin_mask:1,end_mask:1}],
    ['SPLIT',[tensor([],2,[-1]),tensor([2,6])],[tensor([2,3]),tensor([2,3])],{num_splits:2}],
    ['SPLIT_V',[tensor([2,6]),tensor([3],4,[1n,-1n,2n]),tensor([],2,[1])],[tensor([2,1]),tensor([2,3]),tensor([2,2])],{num_splits:3}],
    ...['MEAN','SUM','REDUCE_PROD','REDUCE_MIN','REDUCE_MAX','REDUCE_ANY','REDUCE_ALL'].map(name=>[name,[tensor([2,3,4],/ANY|ALL/.test(name)?6:0),tensor([3],2,[-1,1,1])],[tensor([2,1,1],/ANY|ALL/.test(name)?6:0)],{keep_dims:true}])
];
for(const [name,inputs,outputs,options]of cases){
    test(`${name} checks real serialized operands, all outputs and preserves bytes`,async()=>{
        const c=await operandFixture(name,inputs,outputs,options),before=c.bytes.slice(),proof=validateTfliteConstants(c.model,0,c.read);
        assert.equal(proof.checked,1);assert.equal(proof.unchecked,0);assert.deepEqual(c.bytes,before);
        assert.equal(proof.operators[0].node,0);assert.equal(proof.operators[0].type,name);assert.equal(proof.operators[0].status,'passed');
        const skipped=validateTfliteConstants(c.model,0,()=>assert.fail('budget precedes reads'),{budget:0});
        assert.equal(skipped.unchecked,1);assert.match(skipped.operators[0].reason,/預算/);
    });
    test(`${name} rejects an incorrect serialized output shape with OP/tensor context`,async()=>{
        const bad=outputs.map(t=>({...t,shape:[99]})),c=await operandFixture(name,inputs,bad,options);
        assert.throws(()=>validateTfliteConstants(c.model,0,c.read),/Subgraph #0.*OP #0.*tensor.*shape/);
    });
}
test('invalid metadata is rejected before reading operands, even with dynamic values',()=>{
    for(const [name,inputs,outputs,options]of [
        ['PAD',[tensor([2,3]),tensor([2,3],2)],[tensor([2,3])],{}],
        ['PADV2',[tensor([2]),tensor([1,2],2),tensor([2])],[tensor([2])],{}],
        ['SLICE',[tensor([2]),tensor([1],2),tensor([1],4)],[tensor([2])],{}],
        ['STRIDED_SLICE',[tensor([2]),tensor([1],4),tensor([1],2),tensor([1],2)],[tensor([2])],{}],
        ['SPLIT',[tensor([],2),tensor([2])],[tensor([1])],{num_splits:2}],
        ['SPLIT_V',[tensor([2]),tensor([3],2),tensor([],2)],[tensor([1]),tensor([1])],{num_splits:2}],
        ['MEAN',[tensor([2]),tensor([1],4)],[tensor([])],{}],
        ['REDUCE_ANY',[tensor([2]),tensor([1],2)],[tensor([])],{}]
    ])assert.throws(()=>checkOperatorMetadata(name,inputs,outputs,options),new RegExp(name));
});
test('dynamic values, unsupported OPs and custom OPs remain explicitly unverified',async()=>{
    const c=await operandFixture('PAD',[tensor([2]),tensor([1,2],2)],[tensor([4])]);
    let proof=validateTfliteConstants(c.model,0,()=>assert.fail('runtime operand must not be read'));
    assert.equal(proof.unchecked,1);assert.equal(proof.operators[0].status,'not-run');assert.match(proof.operators[0].reason,/輸入|producer|動態/);
    c.model.operator_codes[0].builtin_code=s.BuiltinOperator.SIN;c.model.operator_codes[0].deprecated_builtin_code=s.BuiltinOperator.SIN;
    proof=validateTfliteConstants(c.model,0,c.read);assert.equal(proof.operators[0].status,'not-run');assert.match(proof.operators[0].reason,/規則/);
    c.model.operator_codes[0].custom_code='company.opaque';proof=validateTfliteConstants(c.model,0,c.read);
    assert.equal(proof.operators[0].type,'company.opaque');assert.match(proof.operators[0].reason,/custom/);
});

const invalid=[
    ['PAD',[tensor([2]),tensor([1,2],2,[-1,0])],[tensor([1])],{},/paddings/],
    ['PAD',[tensor([2147483647]),tensor([1,2],4,[1n,0n])],[tensor([2])],{},/int32/],
    ['SLICE',[tensor([4]),tensor([1],2,[-1]),tensor([1],2,[2])],[tensor([2])],{},/begin/],
    ['SLICE',[tensor([4]),tensor([1],4,[3n]),tensor([1],4,[9223372036854775807n])],[tensor([1])],{},/size/],
    ['SLICE',[tensor([4]),tensor([1],2,[0]),tensor([1],2,[-2])],[tensor([2])],{},/size/],
    ['STRIDED_SLICE',[tensor([4]),tensor([1],2,[0]),tensor([1],2,[4]),tensor([1],2,[0])],[tensor([4])],{},/stride/],
    ['STRIDED_SLICE',[tensor([4]),tensor([1],2,[0]),tensor([1],2,[4]),tensor([1],2,[-2147483648])],[tensor([4])],{},/stride/],
    ['SPLIT',[tensor([],2,[2]),tensor([2,6])],[tensor([2,3]),tensor([2,3])],{num_splits:2},/axis/],
    ['SPLIT',[tensor([],2,[1]),tensor([2,5])],[tensor([2,2]),tensor([2,3])],{num_splits:2},/整除/],
    ['SPLIT_V',[tensor([5]),tensor([2],4,[-1n,-1n]),tensor([],2,[0])],[tensor([2]),tensor([3])],{num_splits:2},/size_splits/],
    ['SPLIT_V',[tensor([5]),tensor([2],4,[2n,4n]),tensor([],2,[0])],[tensor([2]),tensor([3])],{num_splits:2},/size_splits/],
    ['MEAN',[tensor([2,3]),tensor([1],2,[-3])],[tensor([2])],{},/axis/]
];
for(const [i,[name,inputs,outputs,options,reason]]of invalid.entries())test(`${name} rejects malformed actual operand values (${i})`,async()=>{
    const c=await operandFixture(name,inputs,outputs,options);
    assert.throws(()=>validateTfliteConstants(c.model,0,c.read),error=>/Subgraph #0.*OP #0.*tensor/.test(error.message)&&reason.test(error.message));
});

for(const [title,input,begin,end,strides,options,output]of [
    ['ellipsis and new axis',[2,3,4],[0,0,0],[0,0,0],[1,1,-1],{ellipsis_mask:1,new_axis_mask:2,begin_mask:4,end_mask:4},[2,3,1,4]],
    ['shrink and negative index',[2,3],[-1,0],[0,3],[1,1],{shrink_axis_mask:1},[3]],
    ['implicit remaining axes',[4,3],[1],[4],[2],{},[2,3]],
    ['empty slice',[4],[3],[1],[1],{},[0]],
    ['clamped negative endpoints',[5],[-99],[99],[2],{},[3]],
    ['offset',[8],[1],[5],[2],{offset:true},[3]],
    ['scalar new axis',[],[0],[0],[1],{new_axis_mask:1},[1]]
])test(`STRIDED_SLICE ${title} uses all masks without modifying serialized values`,async()=>{
    const c=await operandFixture('STRIDED_SLICE',[tensor(input),tensor([begin.length],2,begin),tensor([end.length],2,end),tensor([strides.length],2,strides)],[tensor(output)],options);
    assert.equal(validateTfliteConstants(c.model,0,c.read).checked,1);
});
test('unverified offset/mask combinations are explicit and not a successful shape check',async()=>{
    const c=await operandFixture('STRIDED_SLICE',[tensor([2,3]),tensor([1],2,[0]),tensor([1],2,[2]),tensor([1],2,[1])],[tensor([2,3])],{offset:true,ellipsis_mask:1});
    const proof=validateTfliteConstants(c.model,0,c.read);assert.equal(proof.checked,0);assert.match(proof.operators[0].reason,/offset.*尚未驗證/);
});
test('reduction accepts empty axes, scalar input and duplicate negative aliases',async()=>{
    for(const [input,axes,output]of [[[2,3],[],[2,3]],[[],[99],[]],[[2,3],[-1,1],[2]]]){
        const c=await operandFixture('SUM',[tensor(input),tensor([axes.length],2,axes)],[tensor(output)],{keep_dims:false});
        assert.equal(validateTfliteConstants(c.model,0,c.read).checked,1);
    }
});
test('SPLIT validates every output rather than only output zero',async()=>{
    const c=await operandFixture('SPLIT',[tensor([],2,[0]),tensor([4])],[tensor([2]),tensor([3])],{num_splits:2});
    assert.throws(()=>validateTfliteConstants(c.model,0,c.read),/output 1 shape/);
});
test('shared constants use one bounded read while dynamic output reasons remain accurate',async()=>{
    const c=await operandFixture('PAD',[tensor([2]),tensor([1,2],2,[1,1])],[tensor([4])]),g=c.model.subgraphs[0];
    g.operators.push({...g.operators[0]});let readBytes=0;
    const proof=validateTfliteConstants(c.model,0,(o,n)=>{readBytes+=n;return c.read(o,n);});
    assert.equal(proof.checked,2);assert.equal(proof.bytesRead,8);assert.equal(readBytes,8);
    g.tensors[2].has_rank=false;
    const dynamic=validateTfliteConstants(c.model,0,()=>assert.fail('unknown output shape must not read constants'));
    assert.equal(dynamic.unchecked,2);assert.ok(dynamic.operators.every(c=>/動態或未知 shape/.test(c.reason)));
});

test('PAD integer encodings must not make unrelated operand dtypes look verified',async()=>{
    for(const [name,inputs,outputs]of [
        ['EXPAND_DIMS',[tensor([2,3]),tensor([1],6,[0])],[tensor([1,2,3])]],
        ['EXPAND_DIMS',[tensor([2,3]),tensor([1],7,[1])],[tensor([2,1,3])]],
        ['RESHAPE',[tensor([2,3]),tensor([2],9,[2,3])],[tensor([2,3])]],
        ['GATHER',[tensor([2]),tensor([2],6,[0,1])],[tensor([2])]]
    ]){
        const c=await operandFixture(name,inputs,outputs);
        const proof=validateTfliteConstants(c.model,0,c.read);
        assert.equal(proof.checked,0,`${name}: unsupported dtype must not pass because PAD can read it`);
        assert.equal(proof.operators[0].status,'not-run');
    }
});

test('dtype admission precedes a shared PAD cache hit; legitimate GATHER int16 remains checked',async()=>{
    const c=await operandFixture('PAD',[tensor([2]),tensor([1,2],6,[0,1])],[tensor([3])]),g=c.model.subgraphs[0],code=s.BuiltinOperator.GATHER;
    c.model.operator_codes.push({builtin_code:code,deprecated_builtin_code:code,version:1});
    g.tensors.push({...g.tensors[2],shape:Int32Array.of(1,2)});g.operators.push({...g.operators[0],opcode_index:1,inputs:[0,1],outputs:[3]});
    const p=validateTfliteConstants(c.model,0,c.read);assert.equal(p.checked,1);assert.equal(p.unchecked,1);assert.equal(p.operators[1].status,'not-run');assert.match(p.operators[1].reason,/dtype/);
    const valid=await operandFixture('GATHER',[tensor([2]),tensor([2],7,[0,1])],[tensor([2])]);
    assert.equal(validateTfliteConstants(valid.model,0,valid.read).checked,1);
    const unknownBool=await operandFixture('PAD',[tensor([2]),tensor([1,2],6,[0,2])],[tensor([4])]);
    const unknown=validateTfliteConstants(unknownBool.model,0,unknownBool.read);
    assert.equal(unknown.checked,0);assert.equal(unknown.unchecked,1);assert.match(unknown.operators[0].reason,/bool.*編碼/);assert.equal(unknown.bytesRead,2);
});
