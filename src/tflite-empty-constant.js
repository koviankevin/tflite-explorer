import {staticTfliteShape} from './tflite-static-shape.js';

const denseTypes=new Set([0,1,2,3,4,6,7,8,9,10,11,12,15,16,17,18,19,20,21,22]);
// Buffer 0 is reserved. Strings require a string-table header even for zero
// elements; opaque references and sparse encodings cannot be inferred here.
// Absent data and an explicitly present zero-byte vector stay distinct.
export function isEmptyTfliteConstant(tensor,buffer){
    return tensor?.buffer>0&&buffer?.data instanceof Uint8Array&&buffer.data.byteLength===0&&denseTypes.has(tensor.type)&&!tensor.sparsity&&staticTfliteShape(tensor)?.includes(0)===true;
}
