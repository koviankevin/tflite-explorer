import {readFile} from 'node:fs/promises';
import {tflite as s} from '../vendor/netron/tflite-schema.js';
import {FlatbufferWriter} from '../src/flatbuffer-writer.js';
import {parseModel} from '../src/model-engine.js';
import {runtimeFixture} from './runtime-fixture.mjs';
const metadata=JSON.parse(await readFile(new URL('../vendor/netron/tflite-metadata.json',import.meta.url),'utf8'));
export const affineQuantization=(scale=[.5],dimension=0)=>Object.assign(new s.QuantizationParameters(),{scale:Float32Array.from(scale),zero_point:BigInt64Array.from(scale,()=>0n),quantized_dimension:dimension});
export async function quantizationFixture({rank=true,scale=[.5],dimension=0,layers=1,customDetails=false}={}){
    const {model}=await runtimeFixture({inputShapes:[[2],[2]],outputShape:[2]}),g=model.subgraphs[0];
    for(let n=1;n<layers;n++){const id=g.tensors.length;g.tensors.push(Object.assign(new s.Tensor(),{name:'result_'+n,shape:Int32Array.of(2),has_rank:true,type:9,buffer:0}));g.operators.push(Object.assign(new s.Operator(),{opcode_index:0,inputs:Int32Array.of(id-1,1),outputs:Int32Array.of(id),builtin_options:Object.assign(new s.AddOptions(),{fused_activation_function:0})}));}
    g.outputs=Int32Array.of(g.tensors.length-1);
    for(const t of g.tensors){t.type=s.TensorType.INT8;t.quantization=affineQuantization();}
    Object.assign(g.tensors[0],{has_rank:rank,quantization:affineQuantization(scale,dimension)});
    if(customDetails)g.tensors[0].quantization.details=Object.assign(new s.CustomQuantization(),{custom:Uint8Array.of(9,8)});
    const blob=new FlatbufferWriter().finish(model,new Blob()),bytes=new Uint8Array(await blob.arrayBuffer()),index=await parseModel((o,n)=>bytes.subarray(o,o+n),bytes.length,metadata),file=new File([blob],'quantized-public-fixture.tflite');
    return {model,index,file,blob,bytes};
}

