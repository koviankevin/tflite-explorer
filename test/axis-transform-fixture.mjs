import {readFile} from 'node:fs/promises';
import {runtimeFixture} from './runtime-fixture.mjs';
import {tflite as schema} from '../vendor/netron/tflite-schema.js';
import {FlatbufferWriter} from '../src/flatbuffer-writer.js';
import {parseModel} from '../src/model-engine.js';
const metadata=JSON.parse(await readFile(new URL('../vendor/netron/tflite-metadata.json',import.meta.url),'utf8'));
export async function axisTransformFixture({name='TRANSPOSE',input=[2,3],output=[3,2],axisShape=[2],axisType=2,axes=[1,0],dynamic=false,axisInput=false}={}){
    const {model}=await runtimeFixture({inputShapes:[input,axisShape],outputShape:output}),graph=model.subgraphs[0],code=schema.BuiltinOperator[name];
    Object.assign(model.operator_codes[0],{builtin_code:code,deprecated_builtin_code:code});graph.operators[0].builtin_options=null;
    const width=axisType===4?8:4,data=new Uint8Array(axes.length*width),view=new DataView(data.buffer);
    axes.forEach((value,i)=>axisType===4?view.setBigInt64(i*width,BigInt(value),true):axisType===0?view.setFloat32(i*width,value,true):view.setInt32(i*width,value,true));
    model.buffers.push({data,offset:0n,size:0n});Object.assign(graph.tensors[1],{type:axisType,buffer:axisInput?0:1});graph.inputs=axisInput?Int32Array.of(0,1):Int32Array.of(0);
    if(dynamic)graph.tensors[0].shape_signature=Int32Array.from(input,(_,i)=>i===0?-1:input[i]);
    const blob=new FlatbufferWriter().finish(model,new Blob()),bytes=new Uint8Array(await blob.arrayBuffer()),read=(offset,length)=>bytes.subarray(offset,offset+length),index=await parseModel(read,bytes.length,metadata);
    return {blob,bytes,file:new File([blob],name.toLowerCase()+'.tflite'),index,model:index.raw,read};
}
