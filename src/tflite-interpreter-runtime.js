import {RUNTIME_INTERPRETER_ENGINE,RUNTIME_LIMITS} from './tflite-runtime-policy.js';
import {inputSize} from './tflite-runtime-inputs.js';
// Only the public compiled module is shared. This adapter and all native memory
// belong to one short-lived execution Worker. It never rewrites the model.
export function interpreterRuntime(module){
    class Tensor{
        constructor(data,shape,dtype){this.shape=Array.from(shape);this.dtype=dtype;this.values=data;}
        toTypedArray(){if(!this.values)throw Error('Tensor already released.');return this.values;}
        delete(){this.values=null;}
    }
    const vector=(runner,side,visit)=>{
        const values=side==='inputs'?runner.GetInputs():runner.GetOutputs();
        try{if(values.size()>128)throw Error('Interpreter interface exceeds 128 tensors.');return Array.from({length:values.size()},(_,i)=>visit(values.get(i),i));}
        finally{values.delete();}
    };
    const detail=info=>{
        const shape=info.shape===''?[]:info.shape.split(',').map(Number),dtype=info.dataType;
        if(shape.length>128||shape.some(n=>!Number.isSafeInteger(n)||n<0))throw Error('Interpreter returned an invalid shape.');
        const result={name:info.name,dtype,shape};inputSize(result);return result;
    };
    return {engine:RUNTIME_INTERPRETER_ENGINE,backend:'interpreter',Tensor,Environment:{async create(){return {delete(){}};}},async loadAndCompile(bytes){
        let pointer=0,status=null,runner=null,deleted=false;
        const dispose=()=>{if(deleted)return;deleted=true;try{runner?.delete();}finally{try{status?.delete?.();}finally{if(pointer)module._free(pointer);pointer=0;runner=status=null;}}};
        try{
            pointer=module._malloc(bytes.byteLength);if(!pointer)throw Error('Interpreter model allocation failed.');
            module.HEAPU8.set(bytes,pointer);
            status=module.TFLiteWebModelRunner.CreateFromBufferAndOptions(pointer,bytes.byteLength,{numThreads:1,enableProfiling:false,maxProfilingBufferEntries:16});
            if(!status.ok())throw Error(status.errorMessage());runner=status.value();
            return {getInputDetails:()=>vector(runner,'inputs',detail),getOutputDetails:()=>vector(runner,'outputs',detail),async run(inputs){
                vector(runner,'inputs',(info,i)=>{
                    const d=detail(info),source=inputs[i]?.toTypedArray(),target=info.data();
                    if(!source||!target||source.constructor!==target.constructor||source.byteLength!==target.byteLength||inputs[i].dtype!==d.dtype||JSON.stringify(inputs[i].shape)!==JSON.stringify(d.shape))throw Error('Interpreter input shape, dtype or bytes mismatch.');
                    target.set(source);
                });
                if(!runner.Infer())throw Error('TFLite Interpreter invocation failed.');
                // Refresh native pointers after Invoke: value-dependent shapes
                // may allocate a different output than the pre-invoke buffer.
                let bytes=0;
                return vector(runner,'outputs',info=>{
                    const d=detail(info);bytes+=inputSize(d);if(bytes>RUNTIME_LIMITS.ioBytes)throw Error('Interpreter output exceeds 16 MiB.');
                    const values=info.data();if(!ArrayBuffer.isView(values)||values.byteLength!==inputSize(d))throw Error('Interpreter output bytes mismatch.');
                    return new Tensor(values.slice(),d.shape,d.dtype);
                });
            },delete:dispose};
        }catch(error){dispose();throw error;}
    }};
}
