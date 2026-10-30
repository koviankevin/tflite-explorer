import {tflite as s} from '../vendor/netron/tflite-schema.js';
import {FlatbufferWriter} from '../src/flatbuffer-writer.js';
import {detectionOptions} from './flex-scalar-fixture.mjs';
// Valid public Detection PostProcess interface with unrelated model weights.
// Kernel availability is separate from reference-preserving extraction.
export function detectionPostprocessFixture({unusedBytes=512*1024,version=1,withReshape=false}={}){
    const t=(name,shape,buffer=0)=>Object.assign(new s.Tensor(),{name,shape:Int32Array.from(shape),has_rank:true,type:0,buffer});
    const anchors=Float32Array.from(Array.from({length:4},()=>[.5,.5,.1,.1]).flat()),options=detectionOptions();
    const model=Object.assign(new s.Model(),{version:3,description:'Public synthetic Detection PostProcess contract fixture',operator_codes:[Object.assign(new s.OperatorCode(),{builtin_code:32,deprecated_builtin_code:32,custom_code:'TFLite_Detection_PostProcess',version})],subgraphs:[Object.assign(new s.SubGraph(),{name:'public detection',tensors:[t('boxes',[1,4,4]),t('scores',[1,4,3]),t('anchors',[4,4],1),t('detections',[1,5,4]),t('classes',[1,5]),t('detection_scores',[1,5]),t('count',[1]),t('unrelated_weights',[unusedBytes/4],2)],inputs:Int32Array.of(0,1),outputs:Int32Array.of(3,4,5,6),operators:[Object.assign(new s.Operator(),{opcode_index:0,inputs:Int32Array.of(0,1,2),outputs:Int32Array.of(3,4,5,6),custom_options:options,custom_options_format:0})]})],buffers:[{data:new Uint8Array(),offset:0n,size:0n},{data:new Uint8Array(anchors.buffer),offset:0n,size:0n},{data:new Uint8Array(unusedBytes),offset:0n,size:0n}],signature_defs:[],metadata:[],metadata_buffer:[]});
    if(withReshape){
        const g=model.subgraphs[0];model.operator_codes.push(Object.assign(new s.OperatorCode(),{builtin_code:22,deprecated_builtin_code:22,version:1}));model.buffers.push({data:new Uint8Array(Int32Array.of(5,4).buffer),offset:0n,size:0n});g.tensors.push(t('reshaped_detections',[5,4]),Object.assign(t('reshape_shape',[2],3),{type:2}));g.outputs=Int32Array.of(8,4,5,6);g.operators.push(Object.assign(new s.Operator(),{opcode_index:1,inputs:Int32Array.of(3,9),outputs:Int32Array.of(8),builtin_options:Object.assign(new s.ReshapeOptions(),{new_shape:Int32Array.of(5,4)})}));
    }
    const blob=new FlatbufferWriter().finish(model,new Blob());return {model,blob,file:new File([blob],'public-detection.tflite'),anchors:new Uint8Array(anchors.buffer),options};
}
