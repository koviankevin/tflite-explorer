import {axisTransformFixture} from './axis-transform-fixture.mjs';
import {FlatbufferWriter} from '../src/flatbuffer-writer.js';

export async function runtimeSupportFixtures(){
    const rows=[];
    for(const [name,version,axes,status]of [['missing-version',999,[1,0],'not-verified'],['invalid-permutation',1,[2,0],'failed'],['supported-control',1,[1,0],'passed']]){
        const f=await axisTransformFixture({name:'TRANSPOSE',axes,output:[3,2],axisInput:true});
        f.model.operator_codes[0].version=version;
        const blob=await new FlatbufferWriter().finish(f.model,new Blob()),bytes=new Uint8Array(await blob.arrayBuffer());
        rows.push({...f,name,version,status,blob,bytes,values:[Float32Array.of(1,2,3,4,5,6),Int32Array.from(axes)],expected:status==='passed'?[1,4,2,5,3,6]:null});
    }
    return rows;
}
