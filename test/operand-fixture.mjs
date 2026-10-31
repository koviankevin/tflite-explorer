import {readFile} from 'node:fs/promises';
import {tflite as s} from '../vendor/netron/tflite-schema.js';
import {FlatbufferWriter} from '../src/flatbuffer-writer.js';
import {parseModel} from '../src/model-engine.js';
import {runtimeFixture} from './runtime-fixture.mjs';
const metadata=JSON.parse(await readFile(new URL('../vendor/netron/tflite-metadata.json',import.meta.url),'utf8'));
export async function operandFixture(name,inputs,outputs,settings={}){
    const {model}=await runtimeFixture(),g=model.subgraphs[0];
    g.tensors=[];g.inputs=[];g.outputs=[];
    const append=(t,input)=>{
        const id=g.tensors.length;let buffer=0;
        if(t.values!==undefined){
            const widths={0:4,2:4,4:8,7:2,9:1,6:1},width=widths[t.type],data=new Uint8Array(t.values.length*width),view=new DataView(data.buffer);
            const setters={0:'setFloat32',2:'setInt32',4:'setBigInt64',7:'setInt16',9:'setInt8',6:'setUint8'};
            t.values.forEach((v,i)=>view[setters[t.type]](i*width,t.type===4?BigInt(v):Number(v),true));
            buffer=model.buffers.length;model.buffers.push({data,offset:0n,size:0n});
        }else if(input)g.inputs.push(id);
        g.tensors.push(Object.assign(new s.Tensor(),{name:`tensor_${id}`,shape:Int32Array.from(t.shape),has_rank:true,type:t.type,buffer}));
        return id;
    };
    const inputIds=inputs.map(t=>append(t,true)),outputIds=outputs.map(t=>append(t,false));g.outputs=outputIds;
    const code=s.BuiltinOperator[name];model.operator_codes[0].builtin_code=code;model.operator_codes[0].deprecated_builtin_code=Math.min(code,127);
    const optionType={SPLIT:'SplitOptions',SPLIT_V:'SplitVOptions',STRIDED_SLICE:'StridedSliceOptions',MEAN:'ReducerOptions',SUM:'ReducerOptions',REDUCE_PROD:'ReducerOptions',REDUCE_MIN:'ReducerOptions',REDUCE_MAX:'ReducerOptions',REDUCE_ANY:'ReducerOptions',REDUCE_ALL:'ReducerOptions'}[name];
    g.operators[0].inputs=inputIds;g.operators[0].outputs=outputIds;g.operators[0].builtin_options=optionType?Object.assign(new s[optionType](),settings):null;
    const blob=new FlatbufferWriter().finish(model,new Blob()),bytes=new Uint8Array(await blob.arrayBuffer());
    const index=await parseModel((o,n)=>bytes.subarray(o,o+n),bytes.length,metadata);
    return {model:index.raw,bytes,blob,index,file:new File([blob],name+'.tflite'),read:(o,n)=>bytes.subarray(o,o+n)};
}
