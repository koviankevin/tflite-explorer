// Conservative metadata checks. Unsupported/dynamic cases are left to the
// optional runtime; they must never be reported as fully kernel-verified.
import {checkSpatialTransform} from './tflite-spatial-checks.js';
import {checkOperandMetadata} from './tflite-operand-checks.js';
import {inspectTensorQuantization} from './tflite-quantization-checks.js';
import {checkReshapeMetadata} from './tflite-reshape-checks.js';
import {checkBatchMatmulMetadata} from './tflite-matmul-checks.js';
import {checkGatherMetadata} from './tflite-gather-checks.js';
import {checkFullyConnectedMetadata} from './tflite-fully-connected-checks.js';
import {checkStaticTransform} from './tflite-static-transform.js';
import {checkAddMetadata} from './tflite-add-checks.js';
export function checkOperatorMetadata(name,inputs,outputs,options={}){
    const fail=message=>{throw Error(`${name} ${message}`);},out=outputs[0];
    checkSpatialTransform(name,inputs,outputs,options);
    checkStaticTransform(name,inputs,outputs,options);
    checkOperandMetadata(name,inputs,outputs,options);
    for(const [side,ts] of [['input',inputs],['output',outputs]])for(const [slot,t] of ts.entries()){
        const result=inspectTensorQuantization(t);
        if(result?.status==='failed')fail(`${side} ${slot} ${result.reason}`);
    }
    if(name==='FULLY_CONNECTED')checkFullyConnectedMetadata(inputs,outputs,options);
    if(name==='BATCH_MATMUL')checkBatchMatmulMetadata(inputs,outputs,options);
    if(name==='RESHAPE')checkReshapeMetadata(inputs,outputs,options);
    if(['TRANSPOSE','EXPAND_DIMS'].includes(name)&&inputs[0]&&out&&inputs[0].type!==out.type)fail('input／output dtype 必須相同。');
    if(name==='TRANSPOSE'&&inputs[1]&&inputs[1].type!==2)fail('permutation tensor 必須是 int32。');
    if(name==='ADD')checkAddMetadata(inputs,outputs);
    if(name==='GATHER')checkGatherMetadata(inputs,outputs,options);
}
