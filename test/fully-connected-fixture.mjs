import {readFile} from 'node:fs/promises';
import {tflite as s} from '../vendor/netron/tflite-schema.js';
import {FlatbufferWriter} from '../src/flatbuffer-writer.js';
import {parseModel} from '../src/model-engine.js';
import {runtimeFixture} from './runtime-fixture.mjs';
const metadata=JSON.parse(await readFile(new URL('../vendor/netron/tflite-metadata.json',import.meta.url),'utf8'));

export async function fullyConnectedFixture({input={shape:[1,2],type:0},weights={shape:[3,2],type:0,values:[1,0,0,1,1,1]},output={shape:[1,3],type:0},bias={shape:[3],type:0,values:[0,0,0]},options={},version,omitBias=false,workspace=null}={}){
    const {model}=await runtimeFixture(),g=model.subgraphs[0];
    g.name='public-fully-connected';g.tensors=[];g.inputs=[];g.outputs=Int32Array.of(2);
    for(const [id,spec] of [input,weights,output,bias].entries()){
        if(!spec)continue;
        let buffer=0;
        if(spec.values!==undefined){
            const width={0:4,2:4,3:1,4:8,7:2,9:1}[spec.type],setter={0:'setFloat32',2:'setInt32',3:'setUint8',4:'setBigInt64',7:'setInt16',9:'setInt8'}[spec.type];
            if(!width||!setter)throw Error('Unsupported public FULLY_CONNECTED fixture encoding.');
            const data=new Uint8Array(spec.values.length*width),view=new DataView(data.buffer);
            spec.values.forEach((v,i)=>view[setter](i*width,spec.type===4?BigInt(v):v,true));buffer=model.buffers.length;model.buffers.push({data,offset:0n,size:0n});
        }else if(id!==2)g.inputs.push(id);
        g.tensors.push(Object.assign(new s.Tensor(),{name:['input','weights','result','bias'][id],shape:Int32Array.from(spec.shape),has_rank:true,type:spec.type,buffer,...(spec.shape_signature?{shape_signature:Int32Array.from(spec.shape_signature)}:{}),...(spec.has_rank===false?{has_rank:false}:{}),...(spec.quantization?{quantization:spec.quantization}:{})}));
    }
    const code=s.BuiltinOperator.FULLY_CONNECTED;
    // TensorFlow's pinned op_version.cc, FULLY_CONNECTED cases, in order.
    const selectedVersion=options.quant_spec?.length?15:weights.type===19?14:input.type===7&&weights.type===17&&output.type===7?13:input.type===0&&weights.type===9&&weights.quantization?.scale?.length>1?12:input.type===7&&weights.type===9&&options.quantized_bias_type?11:weights.sparsity?8:input.type===7&&weights.type===7&&output.type===7?7:omitBias?6:options.keep_num_dims?5:input.type===9&&weights.type===9&&output.type===9?4:input.type===9&&weights.type===17&&output.type===9?10:input.type===0&&weights.type===9&&output.type===0?(options.asymmetric_quantize_inputs?9:3):options.weights_format===1?2:1;
    Object.assign(model.operator_codes[0],{builtin_code:code,deprecated_builtin_code:code,version:version??selectedVersion});
    Object.assign(g.operators[0],{inputs:omitBias?Int32Array.of(0,1):Int32Array.of(0,1,bias?3:-1),outputs:Int32Array.of(2),builtin_options:Object.assign(new s.FullyConnectedOptions(),{fused_activation_function:0,weights_format:0,keep_num_dims:false,asymmetric_quantize_inputs:false,quantized_bias_type:0,...options})});
    if(workspace){const id=g.tensors.length;g.tensors.push(Object.assign(new s.Tensor(),{name:'workspace',shape:Int32Array.from(workspace.shape),has_rank:true,type:workspace.type,buffer:0}));g.operators[0].outputs=Int32Array.of(2,id);g.outputs=Int32Array.of(2);}
    const blob=new FlatbufferWriter().finish(model,new Blob()),bytes=new Uint8Array(await blob.arrayBuffer()),read=(o,n)=>bytes.subarray(o,o+n),index=await parseModel(read,bytes.length,metadata);
    return {model:index.raw,index,blob,bytes,read,file:new File([blob],'fully-connected.tflite')};
}
