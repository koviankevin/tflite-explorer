import {tflite as s} from '../vendor/netron/tflite-schema.js';
import {FlatbufferWriter} from '../src/flatbuffer-writer.js';
export async function runtimeFixture({inputShapes=[[1,2],[1,2]],outputShape=[1,2],custom=false,signatureTarget=null}={}){
    const tensor=(name,shape)=>Object.assign(new s.Tensor(),{name,shape:Int32Array.from(shape),has_rank:true,type:0,buffer:0});
    const code=custom?s.BuiltinOperator.CUSTOM:s.BuiltinOperator.ADD;
    const model=Object.assign(new s.Model(),{version:3,description:'Public synthetic interpreter validation fixture',operator_codes:[Object.assign(new s.OperatorCode(),{builtin_code:code,deprecated_builtin_code:code,version:1,...(custom?{custom_code:'company.test'}:{})})],subgraphs:[Object.assign(new s.SubGraph(),{name:'main',tensors:[tensor('a',inputShapes[0]),tensor('b',inputShapes[1]),tensor('c',outputShape)],inputs:Int32Array.of(0,1),outputs:Int32Array.of(2),operators:[Object.assign(new s.Operator(),{opcode_index:0,inputs:Int32Array.of(0,1),outputs:Int32Array.of(2),builtin_options:custom?null:Object.assign(new s.AddOptions(),{fused_activation_function:0})})]})],buffers:[{data:new Uint8Array(),offset:0n,size:0n}],signature_defs:[],metadata:[],metadata_buffer:[]});
    if(signatureTarget!==null){if(signatureTarget===1){const second=structuredClone(model.subgraphs[0]);second.name='secondary';second.operators[0].builtin_options=Object.assign(new s.AddOptions(),{fused_activation_function:0});model.subgraphs.push(second);}model.signature_defs=[{signature_key:'serving_default',subgraph_index:signatureTarget,inputs:[{name:'a',tensor_index:0},{name:'b',tensor_index:1}],outputs:[{name:'c',tensor_index:2}]}];}
    const blob=new FlatbufferWriter().finish(model,new Blob()),bytes=new Uint8Array(await blob.arrayBuffer());
    return {model,blob,bytes,file:new File([blob],'runtime-fixture.tflite')};
}
