import {tflite as s} from '../vendor/netron/tflite-schema.js';
import {FlatbufferWriter} from '../src/flatbuffer-writer.js';
export const RUNTIME_MEMORY_ELEMENTS=1024**2;
export function runtimeMemoryValues(input){
    if(!Number.isInteger(input)||input<0||input>255)throw Error('Use a bounded explicit integer input.');
    const values=new Float32Array(RUNTIME_MEMORY_ELEMENTS);for(let i=0;i<values.length;i++)values[i]=input+(i%17-8);return values;
}
export async function runtimeMemoryFixture(){
    const shape=[1,1024,1024],weights=runtimeMemoryValues(0),tensor=(name,buffer)=>Object.assign(new s.Tensor(),{name,shape:Int32Array.from(shape),has_rank:true,type:0,buffer});
    const model=Object.assign(new s.Model(),{version:3,description:'Public synthetic 4MiB constant ADD for manual runtime IO lifecycle',operator_codes:[Object.assign(new s.OperatorCode(),{builtin_code:s.BuiltinOperator.ADD,deprecated_builtin_code:s.BuiltinOperator.ADD,version:1})],subgraphs:[Object.assign(new s.SubGraph(),{name:'main',tensors:[tensor('input',0),tensor('weight',1),tensor('output',0)],inputs:Int32Array.of(0),outputs:Int32Array.of(2),operators:[Object.assign(new s.Operator(),{opcode_index:0,inputs:Int32Array.of(0,1),outputs:Int32Array.of(2),builtin_options:Object.assign(new s.AddOptions(),{fused_activation_function:0})})]})],buffers:[{data:new Uint8Array(),offset:0n,size:0n},{data:new Uint8Array(weights.buffer),offset:0n,size:0n}],signature_defs:[],metadata:[],metadata_buffer:[]});
    const blob=new FlatbufferWriter().finish(model,new Blob()),bytes=new Uint8Array(await blob.arrayBuffer());return {model,blob,bytes};
}
