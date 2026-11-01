// Conservative metadata checks. Unsupported/dynamic cases are left to the
// optional runtime; they must never be reported as fully kernel-verified.
import {checkSpatialTransform} from './tflite-spatial-checks.js';
import {checkOperandMetadata} from './tflite-operand-checks.js';
import {inspectTensorQuantization} from './tflite-quantization-checks.js';
import {staticTfliteShape} from './tflite-static-shape.js';
import {checkBatchMatmulMetadata} from './tflite-matmul-checks.js';
import {checkGatherMetadata} from './tflite-gather-checks.js';
import {checkFullyConnectedMetadata} from './tflite-fully-connected-checks.js';
const known=t=>staticTfliteShape(t)!==null;
const shape=t=>Array.from(t.shape),same=(a,b)=>a.length===b.length&&a.every((n,i)=>n===b[i]);
export function checkOperatorMetadata(name,inputs,outputs,options={}){
    const fail=message=>{throw Error(`${name} ${message}`);},out=outputs[0];
    checkSpatialTransform(name,inputs,outputs,options);
    checkOperandMetadata(name,inputs,outputs,options);
    for(const [side,ts] of [['input',inputs],['output',outputs]])for(const [slot,t] of ts.entries()){
        const result=inspectTensorQuantization(t);
        if(result?.status==='failed')fail(`${side} ${slot} ${result.reason}`);
    }
    if(name==='FULLY_CONNECTED')checkFullyConnectedMetadata(inputs,outputs,options);
    if(name==='BATCH_MATMUL')checkBatchMatmulMetadata(inputs,outputs,options);
    if(['TRANSPOSE','RESHAPE','EXPAND_DIMS'].includes(name)&&inputs[0]&&out&&inputs[0].type!==out.type)fail('input／output dtype 必須相同。');
    if(name==='RESHAPE'&&inputs.length===1&&known(inputs[0])&&known(out)&&options.new_shape){
        const dims=Array.from(options.new_shape);if(dims.some(d=>!Number.isInteger(d)||d< -1)||dims.filter(d=>d===-1).length>1)fail('options new_shape 無效。');
        if(!dims.includes(0)){const total=shape(inputs[0]).reduce((a,b)=>a*BigInt(b),1n),product=dims.reduce((a,b)=>b<0?a:a*BigInt(b),1n);if(!product||total%product||!dims.includes(-1)&&total!==product)fail('options new_shape 元素數不符。');const expected=dims.map(d=>d===-1?Number(total/product):d);if(!same(shape(out),expected))fail(`options new_shape 的 output 應為 [${expected.join(', ')}]。`);}
    }
    if(name==='TRANSPOSE'&&inputs[1]&&inputs[1].type!==2)fail('permutation tensor 必須是 int32。');
    if(name==='GATHER')checkGatherMetadata(inputs,outputs,options);
}
