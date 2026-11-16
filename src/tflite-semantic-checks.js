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
import {BROADCAST_OPERATORS,checkBroadcastMetadata} from './tflite-broadcast-checks.js';
import {checkAxisTransformMetadata} from './tflite-axis-transform-checks.js';
export function checkOperatorMetadata(name,inputs,outputs,options={}){
    const fail=message=>{throw Error(`${name} ${message}`);};
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
    checkAxisTransformMetadata(name,inputs,outputs);
    if(BROADCAST_OPERATORS.has(name))checkBroadcastMetadata(name,inputs,outputs);
    if(name==='GATHER')checkGatherMetadata(inputs,outputs,options);
}
