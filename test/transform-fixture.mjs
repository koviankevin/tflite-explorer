import {readFile} from 'node:fs/promises';
import {runtimeFixture} from './runtime-fixture.mjs';
import {FlatbufferWriter} from '../src/flatbuffer-writer.js';
import {tflite as s} from '../vendor/netron/tflite-schema.js';
import {parseModel} from '../src/model-engine.js';
const metadata=JSON.parse(await readFile(new URL('../vendor/netron/tflite-metadata.json',import.meta.url),'utf8'));
export async function transformFixture(name,{inputs,output,options={},version=1,custom=false}={}){
 const squeeze=name==='SQUEEZE';
 inputs??=squeeze?[{shape:[1,2,1],type:0}]:[{shape:[1,2],type:0},{shape:[1,2],type:0,values:[3,4]}];
 output??={shape:squeeze?[2]:[1,4],type:0};
 const {model}=await runtimeFixture(),g=model.subgraphs[0],code=s.BuiltinOperator[name];g.tensors=[];g.inputs=[];g.outputs=Int32Array.of(inputs.length);g.name='public-'+name.toLowerCase();
 for(const [id,spec]of [...inputs,output].entries()){
  let buffer=0;
  if(spec.values!==undefined){
   const width={0:4,2:4,3:1,4:8,7:2,9:1}[spec.type],setter={0:'setFloat32',2:'setInt32',3:'setUint8',4:'setBigInt64',7:'setInt16',9:'setInt8'}[spec.type];if(!width)throw Error('Unsupported public transform fixture encoding.');
   const data=new Uint8Array(spec.values.length*width),view=new DataView(data.buffer);spec.values.forEach((n,i)=>view[setter](i*width,spec.type===4?BigInt(n):n,true));buffer=model.buffers.length;model.buffers.push({data,offset:0n,size:0n});
  }else if(id<inputs.length)g.inputs.push(id);
  g.tensors.push(Object.assign(new s.Tensor(),{name:id<inputs.length?'input-'+id:'result',type:spec.type,shape:Int32Array.from(spec.shape),has_rank:spec.has_rank!==false,buffer,...(spec.shape_signature?{shape_signature:Int32Array.from(spec.shape_signature)}:{}),...(spec.quantization?{quantization:spec.quantization}:{})}));
 }
 Object.assign(model.operator_codes[0],{builtin_code:custom?32:code,deprecated_builtin_code:custom?32:Math.min(code,127),version,custom_code:custom?name:null});
 Object.assign(g.operators[0],{inputs:Int32Array.from(inputs.map((_,i)=>i)),outputs:Int32Array.of(inputs.length),builtin_options:Object.assign(new s[squeeze?'SqueezeOptions':'ConcatenationOptions'](),squeeze?{squeeze_dims:new Int32Array()}:{axis:1,fused_activation_function:0},options)});
 if(custom)Object.assign(g.operators[0],{builtin_options:null,custom_options:Uint8Array.of(0,1,2,3,5,8),custom_options_format:0});
 const blob=new FlatbufferWriter().finish(model,new Blob()),bytes=new Uint8Array(await blob.arrayBuffer()),read=(o,n)=>bytes.subarray(o,o+n),index=await parseModel(read,bytes.length,metadata);
 return {model:index.raw,index,blob,file:new File([blob],name.toLowerCase()+'.tflite'),bytes,read};
}
