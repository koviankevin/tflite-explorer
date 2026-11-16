import {axisTransformFixture} from './axis-transform-fixture.mjs';
import {runtimeFixture} from './runtime-fixture.mjs';
import {FlatbufferWriter} from '../src/flatbuffer-writer.js';
import {tflite as schema} from '../vendor/netron/tflite-schema.js';
export async function valueShapeFixtures(){
    const cases=[];
    for(const name of ['TRANSPOSE','EXPAND_DIMS','RESHAPE'])for(const axisInput of [true,false]){
        const axes=name==='TRANSPOSE'?[1,0]:name==='EXPAND_DIMS'?[1]:[3,2],axisShape=name==='EXPAND_DIMS'?[]:[2],output=name==='EXPAND_DIMS'?[2,1,3]:[3,2];
        const f=await axisTransformFixture({name,axes,axisShape,output,axisInput}),values=[Float32Array.of(1,2,3,4,5,6)];if(axisInput)values.push(Int32Array.from(axes));
        cases.push({...f,name:name+(axisInput?'-input':'-constant'),axisInput,values,expected:name==='TRANSPOSE'?[1,4,2,5,3,6]:[1,2,3,4,5,6]});
    }
    for(const name of ['GATHER','ADD']){
        const f=await runtimeFixture({inputShapes:[name==='GATHER'?[3]:[2],[2]],outputShape:[2]}),m=f.model,g=m.subgraphs[0];
        m.operator_codes[0].builtin_code=m.operator_codes[0].deprecated_builtin_code=schema.BuiltinOperator[name];
        if(name==='GATHER'){g.tensors[1].type=2;g.operators[0].builtin_options=Object.assign(new schema.GatherOptions(),{axis:0,batch_dims:0});}else for(const t of g.tensors)t.type=2;
        const blob=await new FlatbufferWriter().finish(m,new Blob()),bytes=new Uint8Array(await blob.arrayBuffer());
        cases.push({name:name+'-integer-input-control',model:m,blob,bytes,axisInput:false,values:name==='GATHER'?[Float32Array.of(1,2,3),Int32Array.of(2,0)]:[Int32Array.of(1,2),Int32Array.of(10,20)],expected:name==='GATHER'?[3,1]:[11,22]});
    }
    return cases;
}
