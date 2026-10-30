import {tflite as s} from '../vendor/netron/tflite-schema.js';
import {FlatbufferWriter} from '../src/flatbuffer-writer.js';
export function spatialFixture(name,{input=[1,3,3,1],filter=[1,2,2,1],output=[1,2,2,1],options={}}={}){
    const convolution=['CONV_2D','DEPTHWISE_CONV_2D'].includes(name),depthwise=name==='DEPTHWISE_CONV_2D';
    const tensor=(name,shape,buffer=0)=>Object.assign(new s.Tensor(),{name,shape:Int32Array.from(shape),has_rank:true,type:0,buffer});
    const bytes=values=>new Uint8Array(Float32Array.from(values).buffer),channels=depthwise?filter[3]:filter[0];
    const tensors=convolution?[tensor('input',input),tensor('filter',filter,1),tensor('bias',[channels],2),tensor('output',output)]:[tensor('input',input),tensor('output',output)];
    const opOptions=Object.assign(new s[convolution?depthwise?'DepthwiseConv2DOptions':'Conv2DOptions':'Pool2DOptions'](),{padding:1,stride_h:1,stride_w:1,fused_activation_function:0,...(convolution?{dilation_h_factor:1,dilation_w_factor:1,...(depthwise?{depth_multiplier:channels/input[3]}:{})}:{filter_height:2,filter_width:2}),...options});
    const code=s.BuiltinOperator[name],op=Object.assign(new s.Operator(),{opcode_index:0,inputs:Int32Array.from(convolution?[0,1,2]:[0]),outputs:Int32Array.of(tensors.length-1),builtin_options:opOptions});
    const model=Object.assign(new s.Model(),{version:3,description:'Public synthetic spatial validation fixture',operator_codes:[Object.assign(new s.OperatorCode(),{builtin_code:code,deprecated_builtin_code:Math.min(code,127),version:1})],subgraphs:[Object.assign(new s.SubGraph(),{name:'main',tensors,inputs:Int32Array.of(0),outputs:Int32Array.of(tensors.length-1),operators:[op]})],buffers:[{data:new Uint8Array(),offset:0n,size:0n},...(convolution?[{data:bytes(Array(filter.reduce((a,b)=>a*b,1)).fill(1)),offset:0n,size:0n},{data:bytes(Array(channels).fill(0)),offset:0n,size:0n}]:[])],signature_defs:[],metadata:[],metadata_buffer:[]});
    const blob=new FlatbufferWriter().finish(model,new Blob());return {model,blob,file:new File([blob],name+'.tflite')};
}
