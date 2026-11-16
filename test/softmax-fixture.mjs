import {readFile} from 'node:fs/promises';
import {runtimeFixture} from './runtime-fixture.mjs';
import {FlatbufferWriter} from '../src/flatbuffer-writer.js';
import {parseModel} from '../src/model-engine.js';
import {tflite as s} from '../vendor/netron/tflite-schema.js';
const metadata=JSON.parse(await readFile(new URL('../vendor/netron/tflite-metadata.json',import.meta.url),'utf8'));
export async function softmaxFixture({name='SOFTMAX',input=[2,3],output=input,inputType=0,outputType=inputType,beta=1,inputSignature,outputSignature,inputQuantization,outputQuantization}={}){
    const {model}=await runtimeFixture(),g=model.subgraphs[0],a=g.tensors[0],out=g.tensors[2],code=s.BuiltinOperator[name];
    model.description='Public synthetic Softmax validation fixture';
    Object.assign(model.operator_codes[0],{builtin_code:code,deprecated_builtin_code:Math.min(code,127)});
    Object.assign(a,{name:'logits',shape:Int32Array.from(input),type:inputType});Object.assign(out,{name:'probabilities',shape:Int32Array.from(output),type:outputType});
    if(inputSignature)a.shape_signature=Int32Array.from(inputSignature);if(outputSignature)out.shape_signature=Int32Array.from(outputSignature);
    if(inputQuantization)a.quantization=Object.assign(new s.QuantizationParameters(),inputQuantization);if(outputQuantization)out.quantization=Object.assign(new s.QuantizationParameters(),outputQuantization);
    g.tensors=[a,out];g.inputs=Int32Array.of(0);g.outputs=Int32Array.of(1);
    Object.assign(g.operators[0],{inputs:Int32Array.of(0),outputs:Int32Array.of(1),builtin_options:name==='SOFTMAX'?Object.assign(new s.SoftmaxOptions(),{beta}):null});
    const blob=new FlatbufferWriter().finish(model,new Blob()),bytes=new Uint8Array(await blob.arrayBuffer()),read=(o,n)=>bytes.subarray(o,o+n),index=await parseModel(read,bytes.length,metadata);
    return {model:index.raw,blob,bytes,file:new File([blob],name+'.tflite'),index,read};
}

// Independent numerical expectation: stable last-axis softmax over two rows,
// followed only by the declared quantization. No runtime-produced golden data.
export async function softmaxCases(){
    const cases=[];
    const add=async(name,options,values)=>{
        const f=await softmaxFixture(options),expected=[];
        const logits=Array.from(values,v=>(v-(options.inputQuantization?.zero_point?.[0]??0))*(options.inputQuantization?.scale?.[0]??1));
        for(let i=0;i<logits.length;i+=3){const row=logits.slice(i,i+3).map(v=>v*(options.beta??1)),m=Math.max(...row),sum=row.reduce((a,x)=>a+Math.exp(x-m),0);expected.push(...row.map(x=>options.name==='LOG_SOFTMAX'?x-m-Math.log(sum):Math.exp(x-m)/sum));}
        cases.push({...f,name,options,values,expected,tolerance:options.inputType===undefined?1e-6:options.name==='LOG_SOFTMAX'?0.07:0.008});
    };
    for(const name of ['SOFTMAX','LOG_SOFTMAX'])await add(name+'-float',{name},Float32Array.of(1,2,3,-2,-1,0));
    for(const beta of [0,-1])await add('SOFTMAX-beta-'+beta,{name:'SOFTMAX',beta},Float32Array.of(1,2,3,-2,-1,0));
    for(const type of [3,9]){
        const inputQuantization={scale:[0.125],zero_point:[type===3?128:0]},values=type===3?Uint8Array.of(128,136,144,112,120,128):Int8Array.of(0,8,16,-16,-8,0);
        for(const outputType of [type,7])await add('SOFTMAX-'+type+'-to-'+outputType,{name:'SOFTMAX',inputType:type,outputType,inputQuantization,outputQuantization:{scale:[outputType===7?1/65536:1/256],zero_point:[outputType===7?-32768:type===3?0:-128]}},values);
        await add('LOG_SOFTMAX-'+type,{name:'LOG_SOFTMAX',inputType:type,inputQuantization,outputQuantization:{scale:[16/256],zero_point:[type===3?255:127]}},values);
    }
    await add('SOFTMAX-int16',{name:'SOFTMAX',inputType:7,inputQuantization:{scale:[1/256],zero_point:[0]},outputQuantization:{scale:[1/32768],zero_point:[0]}},Int16Array.of(0,256,512,-512,-256,0));
    return cases;
}
