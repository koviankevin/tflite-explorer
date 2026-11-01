import {staticTfliteShape} from './tflite-static-shape.js';

const denseTypes=new Set([0,1,2,3,4,6,7,8,9,10,11,12,15,16,17,18,19,20,21,22]);
// Buffer 0 is reserved. Strings require a string-table header even for zero
// elements; opaque references and sparse encodings cannot be inferred here.
// Absent data and an explicitly present zero-byte vector stay distinct.
export function emptyTfliteConstantLookup(graph,buffers){
    let produced;
    return {has(id){
        const tensor=graph.tensors[id],buffer=buffers[tensor?.buffer];
        if(!(tensor?.buffer>0&&buffer?.data instanceof Uint8Array&&buffer.data.byteLength===0&&denseTypes.has(tensor.type)&&!tensor.sparsity&&staticTfliteShape(tensor)?.includes(0)===true))return false;
        // A produced zero-element value is still an activation. Build this
        // graph-local set lazily; ordinary models do not need another index.
        if(!produced){produced=new Set();for(const op of graph.operators)for(const output of op.outputs)if(output>=0)produced.add(output);}
        return !produced.has(id);
    }};
}
