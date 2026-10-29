import {FlatbufferWriter} from '../src/flatbuffer-writer.js';
export async function optionalCustomFixture(){
 const model={version:3,operator_codes:[{deprecated_builtin_code:32,builtin_code:32,custom_code:'OptionalOnlyFixture',version:1}],
  subgraphs:[{name:'optional-only',tensors:[],inputs:new Int32Array(),outputs:new Int32Array(),operators:[{opcode_index:0,inputs:Int32Array.of(-1),outputs:new Int32Array(),intermediates:new Int32Array(),custom_options:Uint8Array.of(1,2,3),custom_options_format:0,mutating_variable_inputs:[false],large_custom_options_offset:0n,large_custom_options_size:0n}]}],buffers:[{data:new Uint8Array(),offset:0n,size:0n}],metadata:[],metadata_buffer:new Int32Array(),description:'Public synthetic opaque custom operation with only an optional input; no executable kernel.'};
 const blob=new FlatbufferWriter().finish(model,new Blob());return new Uint8Array(await blob.arrayBuffer());
}
