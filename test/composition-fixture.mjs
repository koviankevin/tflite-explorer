import {runtimeFixture} from './runtime-fixture.mjs';
import {FlatbufferWriter} from '../src/flatbuffer-writer.js';
import {tflite as s} from '../vendor/netron/tflite-schema.js';
export async function compositionFixture({custom=false}={}){
    const {model}=await runtimeFixture(),g=model.subgraphs[0];model.description='Public synthetic A/B composition fixture';
    model.buffers.push({data:new Uint8Array(Float32Array.of(3,4).buffer)},{data:Uint8Array.of(9,8,7,6)});g.tensors[1].buffer=1;g.inputs=Int32Array.of(0);
    for(const name of ['branch_b','old_final'])g.tensors.push({...g.tensors[2],name});
    model.operator_codes.push({builtin_code:custom?s.BuiltinOperator.CUSTOM:s.BuiltinOperator.MUL,deprecated_builtin_code:custom?s.BuiltinOperator.CUSTOM:s.BuiltinOperator.MUL,version:1,...(custom?{custom_code:'company.copy_me'}:{})});
    g.operators.push({opcode_index:1,inputs:Int32Array.of(0,1),outputs:Int32Array.of(3),...(custom?{custom_options:Uint8Array.of(0,1,1,2,3,5,8),custom_options_format:0}:{builtin_options:Object.assign(new s.MulOptions(),{fused_activation_function:0})})},{opcode_index:0,inputs:Int32Array.of(2,3),outputs:Int32Array.of(4),builtin_options:Object.assign(new s.AddOptions(),{fused_activation_function:0})});g.outputs=Int32Array.of(4);
    g.tensors.push({...g.tensors[2],name:'unrelated_result'});g.operators.push({opcode_index:0,inputs:Int32Array.of(0,1),outputs:Int32Array.of(5),builtin_options:Object.assign(new s.AddOptions(),{fused_activation_function:0})});
    const blob=new FlatbufferWriter().finish(model,new Blob()),bytes=new Uint8Array(await blob.arrayBuffer()),file=new File([blob],'composition-source.tflite');return {model,blob,bytes,file};
}
