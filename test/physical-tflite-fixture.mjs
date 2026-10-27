import {open,stat} from 'node:fs/promises';
import {createReadStream} from 'node:fs';
import {createHash} from 'node:crypto';
import {FlatbufferWriter} from '../src/flatbuffer-writer.js';
import {tflite as s} from '../vendor/netron/tflite-schema.js';
export const PHYSICAL_WEIGHT_BYTES=1342177280;
export const PHYSICAL_SOURCE_BYTES=1349965216;
export const PHYSICAL_SOURCE_SHA256='7ea3c8b317c42a3464b74ef8d9a80b27b42f912c1592b5c60daab670ffc66586';
export const PHYSICAL_WEIGHT_SHA256='a16ef6b52ac75f75437a7ac7031e68aafe3c4d7475426c7714d5cc77e433a525';
export const PHYSICAL_OPTIONS=Uint8Array.of(255,0,6,0,2,128,1,42);
export async function physicalFixtureHeader({repeats=7000,weightBytes=PHYSICAL_WEIGHT_BYTES}={}) {
    if(!Number.isInteger(repeats)||repeats<1||repeats>7000||!Number.isSafeInteger(weightBytes)||weightBytes<4||weightBytes%4)throw Error('Invalid physical fixture scale.');
    const tensors=[],operators=[];
    const tensor=(name,{shape=[1,2],type=0,buffer=0}={})=>{const id=tensors.length;tensors.push({name,shape:Int32Array.from(shape),type,buffer,is_variable:false,has_rank:true});return id;};
    const input=tensor('input'),big=tensor('connected_1_25GiB_weight',{shape:[weightBytes],type:3,buffer:1});
    const shape=tensor('reshape_shape',{shape:[2],type:2,buffer:2}),perm=tensor('transpose_perm',{shape:[2],type:2,buffer:3}),small=tensor('small_float_weight',{buffer:4});
    const op=(code,inputs,outputs,extra={})=>operators.push({opcode_index:code,inputs:Int32Array.from(inputs),outputs:Int32Array.from(outputs),intermediates:new Int32Array(),...extra});
    const custom={custom_options:PHYSICAL_OPTIONS,custom_options_format:0,large_custom_options_offset:0n,large_custom_options_size:0n};
    let current=tensor('projected_input');op(0,[input,big],[current],custom);
    for(let i=0;i<repeats;i++) {
        let next=tensor(`stage_${i}/reshape_0`);op(1,[current,shape],[next],{builtin_options:Object.assign(new s.ReshapeOptions(),{new_shape:Int32Array.of(1,2)})});current=next;
        next=tensor(`stage_${i}/transpose`);op(2,[current,perm],[next]);current=next;
        next=tensor(`stage_${i}/reshape_1`);op(1,[current,shape],[next],{builtin_options:Object.assign(new s.ReshapeOptions(),{new_shape:Int32Array.of(1,2)})});current=next;
    }
    const shared=tensor('branch/shared');op(3,[current,small],[shared],{builtin_options:Object.assign(new s.MulOptions(),{fused_activation_function:0})});
    const left=tensor('branch/left');op(4,[shared,small],[left],{builtin_options:Object.assign(new s.AddOptions(),{fused_activation_function:0,pot_scale_int16:true})});
    const right=tensor('branch/right'),extra=tensor('branch/second_output');op(5,[shared,small],[right,extra],custom);
    const output=tensor('branch/join');op(4,[left,right],[output],{builtin_options:Object.assign(new s.AddOptions(),{fused_activation_function:0,pot_scale_int16:true})});
    const code=(builtin,custom_code)=>({deprecated_builtin_code:builtin,builtin_code:builtin,version:1,...(custom_code?{custom_code}:{})});
    const bigBuffer={data:null,offset:1n,size:BigInt(weightBytes)};
    const buffers=[{data:new Uint8Array(),offset:0n,size:0n},bigBuffer,...[new Uint8Array(Int32Array.of(1,2).buffer),new Uint8Array(Int32Array.of(0,1).buffer),new Uint8Array(Float32Array.of(2,3).buffer)].map(data=>({data,offset:0n,size:0n}))];
    const model={version:3,operator_codes:[code(32,'HugeWeightProject'),code(22),code(39),code(18),code(0),code(32,'CompanySplitLongNameForLargeModel')],subgraphs:[{name:'physical-large-weight-and-branches',tensors,inputs:Int32Array.of(input),outputs:Int32Array.of(output,extra),operators}],buffers,description:'Synthetic physical stress fixture. All 1.25 GiB weights are written and connected to HugeWeightProject; custom runtime not supplied.',metadata:[],metadata_buffer:new Int32Array(),signature_defs:[],external_buffers:[],external_buffer_groups:[]};
    let blob=new FlatbufferWriter().finish(model,new Blob());const payloadOffset=Math.ceil(blob.size/16)*16;bigBuffer.offset=BigInt(payloadOffset);blob=new FlatbufferWriter().finish(model,new Blob());
    return {header:new Uint8Array(await blob.arrayBuffer()),payloadOffset,weightBytes,operators:operators.length,tensors:tensors.length,repeats};
}
export async function writePhysicalFixture(filename,options) {
    const fixture=await physicalFixtureHeader(options),fd=await open(filename,'wx'),hash=createHash('sha256'),weightHash=createHash('sha256');
    const put=async bytes=>{let at=0;while(at<bytes.length){const result=await fd.write(bytes,at,bytes.length-at);if(!result.bytesWritten)throw Error('Short fixture write.');at+=result.bytesWritten;}hash.update(bytes);};
    try {
        await put(fixture.header);await put(new Uint8Array(fixture.payloadOffset-fixture.header.length));
        const size=Math.min(4*1024**2,fixture.weightBytes),chunk=new Uint8Array(size);let seed=0x32647ab1;
        for(let i=0;i<chunk.length;i++){seed^=seed<<13;seed^=seed>>>17;seed^=seed<<5;chunk[i]=seed&255;}
        for(let at=0,i=0;at<fixture.weightBytes;at+=size,i++){new DataView(chunk.buffer).setUint32(0,i,true);const part=chunk.subarray(0,Math.min(size,fixture.weightBytes-at));await put(part);weightHash.update(part);}
        await fd.sync();
    }finally{await fd.close();}
    const sha256=hash.digest('hex'),readback=createHash('sha256');for await(const bytes of createReadStream(filename))readback.update(bytes);const readbackSHA256=readback.digest('hex');
    if(sha256!==readbackSHA256)throw Error('Physical fixture readback differs.');
    const info=await stat(filename);return {file:filename,bytes:info.size,payloadOffset:fixture.payloadOffset,weightBytes:fixture.weightBytes,operators:fixture.operators,tensors:fixture.tensors,repeats:fixture.repeats,sha256,readbackSHA256,weightSHA256:weightHash.digest('hex'),allocatedBytes:info.blocks===undefined?null:info.blocks*512,writeMethod:'Sequential dense nonzero 4MiB chunks, fsync, full SHA-256 readback; no sparse/truncate'};
}
