import {fixture} from './fixture.mjs';
import {BinaryReader} from '../vendor/netron/flatbuffers.js';
import {tflite as schema} from '../vendor/netron/tflite-schema.js';
import {FlatbufferWriter} from '../src/flatbuffer-writer.js';

// Keep the search demo's two subgraphs and 26 operators, but supply the actual
// shape/permutation/options required for CPU execution. Structural stress
// fixtures deliberately keep their original bytes and generation behavior.
export async function executableDemoFixture(){
    const original=fixture({graphCount:2,repeats:4}),bytes=new Uint8Array(original.totalBytes);bytes.set(original.data);
    const model=schema.Model.create(BinaryReader.open(bytes));
    model.description='Public executable Reshape / Transpose search demo; synthetic data, not a trained model.';
    const permBuffer=model.buffers.length;model.buffers.push({data:Uint8Array.of(0,0,0,0,1,0,0,0),offset:0n,size:0n});
    for(const graph of model.subgraphs){
        const permutation=graph.tensors.length;graph.tensors.push({name:'transpose_permutation',type:2,shape:Int32Array.of(2),buffer:permBuffer,has_rank:true});
        for(const tensor of graph.tensors)tensor.has_rank=true;
        for(const op of graph.operators){const code=model.operator_codes[op.opcode_index].builtin_code;
            if(code===schema.BuiltinOperator.RESHAPE)op.builtin_options=Object.assign(new schema.ReshapeOptions(),{new_shape:Int32Array.of(1,2)});
            if(code===schema.BuiltinOperator.TRANSPOSE)op.inputs=Int32Array.of(op.inputs[0],permutation);
            if(code===schema.BuiltinOperator.ADD)op.builtin_options=Object.assign(new schema.AddOptions(),{fused_activation_function:0,pot_scale_int16:true});
        }
    }
    const output=new Uint8Array(await new FlatbufferWriter().finish(model,new Blob([bytes])).arrayBuffer());
    return {data:output,totalBytes:output.length,model};
}
