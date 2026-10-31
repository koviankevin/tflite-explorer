import {readFile} from 'node:fs/promises';
import assert from 'node:assert/strict';
import {tflite as s} from '../vendor/netron/tflite-schema.js';
import {FlatbufferWriter} from '../src/flatbuffer-writer.js';
import {parseModel} from '../src/model-engine.js';
import {runtimeFixture} from './runtime-fixture.mjs';
const metadata=JSON.parse(await readFile(new URL('../vendor/netron/tflite-metadata.json',import.meta.url),'utf8'));
export const parseLegacyShapeFixture=bytes=>parseModel((o,n)=>bytes.subarray(o,o+n),bytes.length,metadata);
export async function legacyShapeFixture(name,shapes,{rank=false,output=shapes[0],values}={}){
    const {model}=await runtimeFixture({inputShapes:shapes,outputShape:output});
    Object.assign(model.operator_codes[0],{builtin_code:s.BuiltinOperator[name],deprecated_builtin_code:s.BuiltinOperator[name]});
    const g=model.subgraphs[0];
    for(const t of g.tensors)t.has_rank=rank;
    if(name==='FULLY_CONNECTED'){
        g.tensors.push(Object.assign(new s.Tensor(),{name:'bias',shape:Int32Array.of(shapes[1][0]),has_rank:rank,type:0,buffer:0}));
        g.operators[0].inputs=Int32Array.of(0,1,3);g.inputs=Int32Array.of(0,1,3);
    }
    g.operators[0].builtin_options=name==='FULLY_CONNECTED'?Object.assign(new s.FullyConnectedOptions(),{weights_format:0,keep_num_dims:false,fused_activation_function:0}):name==='RESHAPE'?new s.ReshapeOptions():new s.TransposeOptions();
    if(values){
        g.tensors[1].type=s.TensorType.INT32;g.tensors[1].buffer=1;
        model.buffers.push({data:new Uint8Array(Int32Array.from(values).buffer),offset:0n,size:0n});g.inputs=Int32Array.of(0);
    }
    const blob=new FlatbufferWriter().finish(model,new Blob()),bytes=new Uint8Array(await blob.arrayBuffer()),index=await parseLegacyShapeFixture(bytes),file=new File([blob],'legacy-shape.tflite');
    file.arrayBuffer=()=>assert.fail('never read the entire original File');
    return {index,file,bytes,blob};
}
