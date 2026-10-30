import {customFixture} from './custom-fixture.mjs';
import {FlatbufferWriter} from '../src/flatbuffer-writer.js';
export const syntheticReferenceContract={interfaceVersion:1,customCode:'PublicSyntheticPrivateReferences',versionMin:1,versionMax:1,coverage:'local-ports-options-only',options:{format:'fixed-u32-le',byteLength:12,prefix:[80,82,69,70],references:[{offset:4,kind:'tensor'},{offset:8,kind:'buffer',optional:true}]}};
export async function referenceContractFixture(){
    const options=Uint8Array.of(80,82,69,70,0,0,0,0,255,255,255,255),f=await customFixture({optionBytes:options}),model=f.model;
    Object.assign(model.operator_codes[1],{custom_code:syntheticReferenceContract.customCode,version:1});model.metadata=[];model.metadata_buffer=[];
    model.buffers.push({data:new Uint8Array(1024**2),offset:0n,size:0n});model.subgraphs[0].tensors.push({name:'unrelated',shape:Int32Array.of(1024**2/4),type:0,has_rank:true,buffer:4});
    const blob=new FlatbufferWriter().finish(model,new Blob());return {model,blob,file:new File([blob],'public-synthetic-references.tflite'),options};
}
