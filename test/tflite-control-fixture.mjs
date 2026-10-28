import {tflite as s} from '../vendor/netron/tflite-schema.js';
import {FlatbufferWriter} from '../src/flatbuffer-writer.js';
export async function controlFixture(){
 const options=Uint8Array.of(255,0,6,0,2,128,1,42),weight=new Uint8Array(Float32Array.of(2,3).buffer);
 const tensor=(name,type=0,shape=[2],buffer=0)=>({name,type,shape:Int32Array.from(shape),buffer,is_variable:false,has_rank:true});
 const op=(opcode,inputs,outputs,extra={})=>({opcode_index:opcode,inputs:Int32Array.from(inputs),outputs:Int32Array.from(outputs),intermediates:new Int32Array(),...extra});
 const add=(a,b,out)=>op(0,[a,b],[out],{builtin_options:Object.assign(new s.AddOptions(),{fused_activation_function:0,pot_scale_int16:true})});
 const custom=(inputs,outputs,code=3)=>op(code,inputs,outputs,{custom_options:options,custom_options_format:0});
 const graph=(name,tensors,inputs,outputs,operators)=>({name,tensors,inputs:Int32Array.from(inputs),outputs:Int32Array.from(outputs),operators});
 const branch=name=>graph(name,[tensor('input'),tensor('weight',0,[2],1),tensor('added'),tensor('custom'),tensor('output')],[0],[4],[add(0,1,2),custom([2,1],[3]),add(3,1,4)]);
 const main=graph('main_branch_and_loop',[tensor('condition',6,[]),tensor('input'),tensor('weight',0,[2],1),tensor('branch_result'),tensor('loop_result'),tensor('added'),tensor('split_left'),tensor('split_right'),tensor('output')],[0,1],[8],[
  op(1,[0,1],[3],{builtin_options:Object.assign(new s.IfOptions(),{then_subgraph_index:1,else_subgraph_index:2})}),
  op(2,[3],[4],{builtin_options:Object.assign(new s.WhileOptions(),{cond_subgraph_index:3,body_subgraph_index:4})}),
  add(4,2,5),custom([5,2],[6,7],4),add(6,7,8)
 ]);
 const cond=graph('while_condition',[tensor('state'),tensor('predicate',6,[])],[0],[1],[custom([0],[1],5)]);
 const codes=[[0],[s.BuiltinOperator.IF],[s.BuiltinOperator.WHILE],[32,'CompanyTransformWithLongCustomOperatorNameFor32px'],[32,'CompanySplitWithLongCustomOperatorNameFor32px'],[32,'CompanyLoopCondition']].map(([builtin_code,custom_code])=>({builtin_code,deprecated_builtin_code:Math.min(builtin_code,127),version:1,...(custom_code?{custom_code}:{})}));
 const model={version:3,operator_codes:codes,subgraphs:[main,branch('if_then'),branch('if_else'),cond,branch('while_body')],buffers:[new Uint8Array(),weight].map(data=>({data,offset:0n,size:0n})),metadata:[],metadata_buffer:new Int32Array(),signature_defs:[],description:'Synthetic IF/WHILE/custom fixture; custom runtime is not supplied.'};
 const blob=new FlatbufferWriter().finish(model,new Blob());return {model,options,weight,bytes:new Uint8Array(await blob.arrayBuffer())};
}
