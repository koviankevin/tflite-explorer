import {readFile} from 'node:fs/promises';
import {tflite as s} from '../vendor/netron/tflite-schema.js';
import {FlatbufferWriter} from '../src/flatbuffer-writer.js';
import {parseModel} from '../src/model-engine.js';
import {runtimeFixture} from './runtime-fixture.mjs';
const metadata=JSON.parse(await readFile(new URL('../vendor/netron/tflite-metadata.json',import.meta.url),'utf8'));

export async function gatherFixture({params={shape:[2,3],type:0},indices={shape:[2],type:2,values:[0,2]},output={shape:[2,2],type:0},options={},version,second=false,reverse=false}={}){
    const {model}=await runtimeFixture(),g=model.subgraphs[0];
    g.name='public-gather';g.tensors=[];g.inputs=[];g.outputs=Int32Array.of(2);
    for(const [id,spec] of [params,indices,output].entries()){
        let buffer=0;
        if(spec.data!==undefined){
            buffer=model.buffers.length;model.buffers.push({data:spec.data,offset:0n,size:0n});
        }else if(spec.values!==undefined){
            const width={0:4,2:4,3:1,4:8,6:1,7:2,9:1}[spec.type],setter={0:'setFloat32',2:'setInt32',3:'setUint8',4:'setBigInt64',6:'setUint8',7:'setInt16',9:'setInt8'}[spec.type];
            if(!width||!setter)throw Error('Unsupported public GATHER fixture dtype.');
            const data=new Uint8Array(spec.values.length*width),view=new DataView(data.buffer);
            spec.values.forEach((v,i)=>view[setter](i*width,spec.type===4?BigInt(v):v,true));buffer=model.buffers.length;model.buffers.push({data,offset:0n,size:0n});
        }else if(id<2)g.inputs.push(id);
        g.tensors.push(Object.assign(new s.Tensor(),{name:['params','indices','result'][id],shape:Int32Array.from(spec.shape),has_rank:true,type:spec.type,buffer,...(spec.shape_signature?{shape_signature:Int32Array.from(spec.shape_signature)}:{}),...(spec.has_rank===false?{has_rank:false}:{}),...(spec.quantization?{quantization:spec.quantization}:{})}));
    }
    const code=s.BuiltinOperator.GATHER;
    const selectedVersion=[21,22].includes(params.type)?8:params.type===17?7:indices.type===7?6:options.batch_dims?5:params.type===7?4:params.type===6?3:params.type===9?2:1;
    Object.assign(model.operator_codes[0],{builtin_code:code,deprecated_builtin_code:code,version:version??selectedVersion});
    Object.assign(g.operators[0],{inputs:Int32Array.of(0,1),outputs:Int32Array.of(2),builtin_options:Object.assign(new s.GatherOptions(),{axis:1,batch_dims:0,...options})});
    if(second){g.tensors.push({...g.tensors[2],name:'second-result',buffer:0});g.operators.push({...g.operators[0],inputs:Int32Array.of(2,1),outputs:Int32Array.of(3)});g.outputs=Int32Array.of(3);}
    if(reverse)g.operators.reverse();
    const blob=new FlatbufferWriter().finish(model,new Blob()),bytes=new Uint8Array(await blob.arrayBuffer()),read=(o,n)=>bytes.subarray(o,o+n),index=await parseModel(read,bytes.length,metadata);
    return {model:index.raw,index,blob,bytes,read,file:new File([blob],'gather.tflite')};
}
