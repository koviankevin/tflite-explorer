// Metadata-only shape evidence. Legacy FlatBuffers may omit has_rank while
// still providing a nonempty concrete shape, which the interpreter consumes.
// The flag distinguishes empty unknown rank from a known scalar. A negative
// shape_signature remains dynamic even when the allocated shape is concrete.
export function staticTfliteShape(tensor){
    const raw=tensor?.shape;
    if(!Array.isArray(raw)&&!(ArrayBuffer.isView(raw)&&typeof raw.length==='number'))return null;
    if(raw.length>128||!raw.length&&tensor.has_rank===false||tensor.shape_signature?.some(n=>n<0))return null;
    const shape=Array.from(raw);
    return shape.every(n=>Number.isInteger(n)&&n>=0&&n<=2147483647)?shape:null;
}
