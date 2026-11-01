import {readFile} from 'node:fs/promises';
import {tflite as s} from '../vendor/netron/tflite-schema.js';
import {FlatbufferWriter} from '../src/flatbuffer-writer.js';
import {parseModel} from '../src/model-engine.js';
import {runtimeFixture} from './runtime-fixture.mjs';
const metadata=JSON.parse(await readFile(new URL('../vendor/netron/tflite-metadata.json',import.meta.url),'utf8'));

export async function batchMatmulFixture({lhs={shape:[2,2],type:0},rhs={shape:[2,2],type:0,values:[1,0,0,1]},output={shape:[2,2],type:0},options={},version}={}){
    const {model}=await runtimeFixture(),g=model.subgraphs[0];
    g.name='public-batch-matmul';g.tensors=[];g.inputs=[];g.outputs=Int32Array.of(2);
    for(const [id,spec] of [lhs,rhs,output].entries()){
        let buffer=0;
        if(spec.values!==undefined){
            const width={0:4,1:2,2:4,6:1,7:2,9:1}[spec.type],setter={0:'setFloat32',1:'setUint16',2:'setInt32',6:'setUint8',7:'setInt16',9:'setInt8'}[spec.type];
            if(!width||!setter)throw Error('Unsupported public fixture dtype.');
            const bytes=new Uint8Array(spec.values.length*width),view=new DataView(bytes.buffer);
            spec.values.forEach((v,i)=>view[setter](i*width,v,true));buffer=model.buffers.length;model.buffers.push({data:bytes,offset:0n,size:0n});
        }else if(id<2)g.inputs.push(id);
        g.tensors.push(Object.assign(new s.Tensor(),{name:['lhs','rhs','result'][id],shape:Int32Array.from(spec.shape),has_rank:true,type:spec.type,buffer,...(spec.shape_signature?{shape_signature:Int32Array.from(spec.shape_signature)}:{}),...(spec.has_rank===false?{has_rank:false}:{}),...(spec.quantization?{quantization:spec.quantization}:{})}));
    }
    const code=s.BuiltinOperator.BATCH_MATMUL;
    Object.assign(model.operator_codes[0],{builtin_code:code,deprecated_builtin_code:code,version:version??(lhs.type===7?3:lhs.type===9?2:lhs.type===0&&rhs.type===9&&options.asymmetric_quantize_inputs?4:1)});
    Object.assign(g.operators[0],{inputs:Int32Array.of(0,1),outputs:Int32Array.of(2),builtin_options:Object.assign(new s.BatchMatMulOptions(),{adj_x:false,adj_y:false,asymmetric_quantize_inputs:false,...options})});
    const blob=new FlatbufferWriter().finish(model,new Blob()),bytes=new Uint8Array(await blob.arrayBuffer()),read=(o,n)=>bytes.subarray(o,o+n),index=await parseModel(read,bytes.length,metadata);
    return {model:index.raw,index,blob,bytes,read,file:new File([blob],'batch-matmul.tflite')};
}
