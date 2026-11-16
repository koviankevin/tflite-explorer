import {tflite as s} from '../vendor/netron/tflite-schema.js';
import {FlatbufferWriter} from '../src/flatbuffer-writer.js';
export async function deleteInferenceFixture({kind='branch',tail=0}={}){
    const model={version:3,description:'Public synthetic deletion/shape inference fixture',operator_codes:[],subgraphs:[],buffers:[{data:new Uint8Array()}],signature_defs:[],metadata:[],metadata_buffer:new Int32Array()};
    const g={name:'deletion-shapes',tensors:[],operators:[],inputs:Int32Array.of(0),outputs:new Int32Array()};model.subgraphs=[g];
    const tensor=(name,shape,type=0,data)=>{let buffer=0;if(data){buffer=model.buffers.length;model.buffers.push({data:new Uint8Array(data.buffer,data.byteOffset,data.byteLength)});}const id=g.tensors.length;g.tensors.push({name,shape:Int32Array.from(shape),type,buffer,has_rank:true});return id;};
    const op=(name,inputs,outputs,options)=>{let code=model.operator_codes.findIndex(c=>c.builtin_code===(name.includes('.')?s.BuiltinOperator.CUSTOM:s.BuiltinOperator[name])&&c.custom_code===(name.includes('.')?name:undefined));if(code<0){code=model.operator_codes.length;const builtin=name.includes('.')?s.BuiltinOperator.CUSTOM:s.BuiltinOperator[name];model.operator_codes.push({builtin_code:builtin,deprecated_builtin_code:Math.min(builtin,127),version:1,...(name.includes('.')?{custom_code:name}:{})});}g.operators.push({opcode_index:code,inputs:Int32Array.from(inputs),outputs:Int32Array.from(outputs),...(options?{builtin_options:options}:{}),...(name.includes('.')?{custom_options:Uint8Array.of(2,3,5,7),custom_options_format:0}:{})});};
    const input=tensor('input',kind==='split'?[2,4]:kind==='reshape'?[1,6]:[2,3]),perm=tensor('permutation',[2],2,Int32Array.of(1,0)),transposed=tensor('cut_output',kind==='split'?[4,2]:[3,2]);
    let current=transposed;
    if(kind==='reshape'){
        g.tensors[transposed].shape=Int32Array.of(2,3);op('RESHAPE',[input],[transposed],Object.assign(new s.ReshapeOptions(),{new_shape:Int32Array.of(2,3)}));
        const out=tensor('transpose_out',[3,2]);op('TRANSPOSE',[transposed,perm],[out]);const shape=tensor('reshape_shape',[2],2,Int32Array.of(-1,2)),end=tensor('reshaped',[3,2]);op('RESHAPE',[out,shape],[end]);current=end;
    }else{
        op('TRANSPOSE',[input,perm],[transposed]);
        if(kind==='fc'){
            const weights=tensor('weights',[4,2],0,Float32Array.from({length:8},(_,i)=>i/10)),out=tensor('fc_out',[3,4]);op('FULLY_CONNECTED',[transposed,weights],[out],Object.assign(new s.FullyConnectedOptions(),{keep_num_dims:true,weights_format:0,fused_activation_function:0}));current=out;
        }else if(kind==='custom'){
            const out=tensor('custom_out',[3,2]);op('company.opaque',[transposed],[out]);current=out;
        }else if(kind==='split'){
            const axis=tensor('axis',[],2,Int32Array.of(0)),left=tensor('left',[2,2]),right=tensor('right',[2,2]),out=tensor('joined',[2,2]);op('SPLIT',[axis,transposed],[left,right],Object.assign(new s.SplitOptions(),{num_splits:2}));op('ADD',[left,right],[out],Object.assign(new s.AddOptions(),{fused_activation_function:0}));current=out;
        }else{
            const relu=tensor('relu',[3,2]),left=tensor('left',[3,2]),right=tensor('right',[3,2]),out=tensor('joined',[3,2]);op('RELU',[transposed],[relu]);op('NEG',[relu],[left]);op('SQUARE',[relu],[right]);op('ADD',[left,right],[out],Object.assign(new s.AddOptions(),{fused_activation_function:0}));current=out;
        }
    }
    for(let i=0;i<tail;i++){const out=tensor('tail_'+i,Array.from(g.tensors[current].shape));op('RELU',[current],[out]);current=out;}
    g.outputs=Int32Array.of(current);const blob=new FlatbufferWriter().finish(model,new Blob()),bytes=new Uint8Array(await blob.arrayBuffer()),file=new File([blob],'delete-'+kind+'.tflite');return {model,blob,bytes,file};
}
