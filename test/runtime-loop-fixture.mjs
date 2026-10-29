import {tflite as s} from '../vendor/netron/tflite-schema.js';
import {FlatbufferWriter} from '../src/flatbuffer-writer.js';

// The true variant intentionally never returns from WHILE. Execute it only
// inside an owned runtime Worker with an external cancellation/deadline guard.
export async function runtimeLoopFixture(predicate=false){
    if(typeof predicate!=='boolean')throw Error('Loop predicate must be an explicit boolean.');
    const tensor=(name,type=0,shape=[1],buffer=0)=>({name,type,shape:Int32Array.from(shape),buffer,has_rank:true,is_variable:false});
    const graph=(name,tensors,inputs,outputs,operators)=>({name,tensors,inputs:Int32Array.from(inputs),outputs:Int32Array.from(outputs),operators});
    const op=(opcode,inputs,outputs,options)=>({opcode_index:opcode,inputs:Int32Array.from(inputs),outputs:Int32Array.from(outputs),builtin_options:options});
    const model={version:3,description:'Public CPU watchdog fixture; WHILE uses a constant BOOL predicate.',operator_codes:[s.BuiltinOperator.WHILE,s.BuiltinOperator.ADD].map(code=>({builtin_code:code,deprecated_builtin_code:Math.min(code,127),version:1})),subgraphs:[
        graph('main',[tensor('input'),tensor('result')],[0],[1],[op(0,[0],[1],Object.assign(new s.WhileOptions(),{cond_subgraph_index:1,body_subgraph_index:2}))]),
        graph('condition',[tensor('state'),tensor('predicate',6,[],1)],[0],[1],[]),
        graph('body',[tensor('state'),tensor('one',0,[1],2),tensor('next')],[0],[2],[op(1,[0,1],[2],Object.assign(new s.AddOptions(),{fused_activation_function:0}))])
    ],buffers:[new Uint8Array(),Uint8Array.of(predicate?1:0),new Uint8Array(Float32Array.of(1).buffer)].map(data=>({data,offset:0n,size:0n})),signature_defs:[],metadata:[],metadata_buffer:new Int32Array()};
    const blob=new FlatbufferWriter().finish(model,new Blob()),bytes=new Uint8Array(await blob.arrayBuffer());return {model,blob,bytes};
}
