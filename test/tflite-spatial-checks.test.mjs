import test from 'node:test';
import assert from 'node:assert/strict';
import {checkOperatorMetadata as check} from '../src/tflite-semantic-checks.js';
import {inferTfliteOutputs} from '../src/tflite-shape-inference.js';
const t=(shape,type=0)=>({shape,type,has_rank:true});
const conv={padding:1,stride_h:1,stride_w:1,dilation_h_factor:1,dilation_w_factor:1};
const pool={padding:1,stride_h:1,stride_w:1,filter_height:2,filter_width:2};
test('CONV_2D checks channels, SAME/VALID/dilation and permits grouped/hybrid filters',()=>{
    const input=t([1,5,5,4]),filter=t([6,3,3,2]);
    assert.doesNotThrow(()=>check('CONV_2D',[input,filter,t([1,6])],[t([1,3,3,6])],conv));
    assert.doesNotThrow(()=>check('CONV_2D',[input,{...filter,type:9},t([6])],[t([1,5,5,6])],{...conv,padding:0}));
    assert.doesNotThrow(()=>check('CONV_2D',[input,filter,t([6])],[t([1,1,1,6])],{...conv,dilation_h_factor:2,dilation_w_factor:2}));
    for(const [w,out,opts]of [[t([6,3,3,3]),t([1,3,3,6]),conv],[t([5,3,3,2]),t([1,3,3,5]),conv],[filter,t([1,5,5,6]),conv],[filter,t([1,3,3,6]),{...conv,padding:99}],[filter,t([1,3,3,6]),{...conv,stride_h:0}]])assert.throws(()=>check('CONV_2D',[input,w,t([w.shape[0]])],[out],opts),/CONV_2D/);
});
test('spatial dtype and bias checks catch errors without demanding hybrid weights match input dtype',()=>{
    assert.throws(()=>check('CONV_2D',[t([1,4,4,1]),t([2,2,2,1]),t([1])],[t([1,3,3,2])],conv),/bias/);
    assert.throws(()=>check('CONV_2D',[t([1,4,4,1]),t([2,2,2,1]),t([2])],[t([1,3,3,2],9)],conv),/dtype/);
    assert.throws(()=>check('CONV_2D',[t([1,4,4,1],9),t([2,2,2,1],9),t([2])],[t([1,3,3,2],9)],conv),/bias.*dtype/);
});
test('DEPTHWISE_CONV_2D derives multiplier from filter channels and checks NHWC/filter/bias',()=>{
    const input=t([1,4,4,2]),filter=t([1,2,2,6]);
    // TensorFlow derives the multiplier from the filter, not this legacy option.
    assert.doesNotThrow(()=>check('DEPTHWISE_CONV_2D',[input,filter,t([6])],[t([1,3,3,6])],{...conv,depth_multiplier:1}));
    for(const [w,b,out]of [[t([2,2,2,6]),t([6]),t([1,3,3,6])],[t([1,2,2,5]),t([5]),t([1,3,3,5])],[filter,t([1,6]),t([1,3,3,6])],[filter,t([6]),t([1,3,3,2])]])assert.throws(()=>check('DEPTHWISE_CONV_2D',[input,w,b],[out],conv),/DEPTHWISE_CONV_2D/);
});
test('pooling verifies NHWC, window, strides, padding and output shape',()=>{
    for(const name of ['AVERAGE_POOL_2D','MAX_POOL_2D','L2_POOL_2D']){
        assert.doesNotThrow(()=>check(name,[t([1,4,5,2])],[t([1,2,3,2])],{...pool,padding:0,stride_h:2,stride_w:2}));
        assert.doesNotThrow(()=>check(name,[t([1,4,5,2])],[t([1,3,4,2])],pool));
        for(const [input,out,opts]of [[t([4,5,2]),t([1,3,4,2]),pool],[t([1,4,5,2]),t([1,4,5,2]),pool],[t([1,4,5,2]),t([1,3,4,2]),{...pool,filter_width:0}]])assert.throws(()=>check(name,[input],[out],opts),new RegExp(name));
    }
});
test('dynamic shapes stay manual; static zero/oversized results do not overflow or invent dimensions',()=>{
    assert.doesNotThrow(()=>check('CONV_2D',[{...t([1,4,4,1]),shape_signature:[-1,4,4,1]},t([2,2,2,1])],[t([9,9,9,9])],conv));
    assert.throws(()=>check('CONV_2D',[t([1,0,4,1]),t([2,2,2,1])],[t([1,0,3,2])],conv),/CONV_2D/);
    assert.doesNotThrow(()=>check('CONV_2D',[t([0,4,4,1]),t([2,2,2,1])],[t([0,3,3,2])],conv));
    assert.throws(()=>check('CONV_2D',[t([1,4,4,1]),t([2,2147483647,2,1])],[t([1,3,3,2])],{...conv,dilation_h_factor:2147483647}),/CONV_2D/);
});
test('editor output inference shares spatial rules with export checks',()=>{
    const r=inferTfliteOutputs('CONV_2D',[t([1,5,5,2]),t([4,3,3,2]),t([4])],[t([1,5,5,2])],conv);
    assert.equal(r.status,'inferred');assert.deepEqual(r.shapes,[[1,3,3,4]]);
    const p=inferTfliteOutputs('MAX_POOL_2D',[t([1,4,4,2])],[t([1,4,4,2])],pool);assert.equal(p.status,'inferred');assert.deepEqual(p.shapes,[[1,3,3,2]]);
    const invalid=inferTfliteOutputs('CONV_2D',[t([1,5,5,2]),t([4,3,3,3])],[t([1,5,5,2])],conv);assert.equal(invalid.status,'manual');assert.match(invalid.reason,/channel/);
});
