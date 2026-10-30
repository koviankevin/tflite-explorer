// Audited public contracts. Internal registration is kept in a separate module.
import {validateCustomContracts} from './tflite-custom-contract.js';
// TensorFlow 7bc5d217d3bd79426527d0055fd3b54812f52e93:
// tensorflow/lite/kernels/detection_postprocess.cc. Three tensor inputs, four
// outputs, scalar FlexBuffers options; no opaque tensor/buffer/subgraph indices.
export const publicCustomContracts=validateCustomContracts([{
    interfaceVersion:1,customCode:'TFLite_Detection_PostProcess',versionMin:1,versionMax:1,coverage:'local-ports-options-only',inputCount:3,outputCount:4,
    options:{format:'flexbuffers-scalars',fields:Object.fromEntries([
        ...['max_detections','max_classes_per_detection','num_classes'].map(k=>[k,{type:'integer',required:true}]),
        ...['nms_score_threshold','nms_iou_threshold','y_scale','x_scale','h_scale','w_scale'].map(k=>[k,{type:'number',required:true}]),
        ['detections_per_class',{type:'integer',required:false}],['use_regular_nms',{type:'boolean',required:false}]
    ])}
}]);
