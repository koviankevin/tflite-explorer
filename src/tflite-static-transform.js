// Shared metadata rules for draft inference and export validation. No weights
// or interpreter are read. Kernel facts: TensorFlow 87a97a3655fdf006ac1e9b7a6a41fec45022fe3c
// tensorflow/lite/kernels/{squeeze,concatenation}.cc
const dimensions=t=>t?.shape!==undefined&&(Array.isArray(t.shape)||ArrayBuffer.isView(t.shape))?Array.from(t.shape):null;
const known=t=>{const shape=dimensions(t);return shape&&shape.length<=128&&!t.shape_signature?.some(d=>d<0)&&shape.every(d=>Number.isInteger(d)&&d>=0&&d<=2147483647);};
export function inferStaticTransform(name,inputs,options={}){
    if(!['SQUEEZE','CONCATENATION'].includes(name))return null;
    const invalid=reason=>({status:'invalid',reason:`${name} ${reason}`}),manual=reason=>({status:'manual',reason});
    if(name==='SQUEEZE'?inputs.length!==1:inputs.length<1)return invalid(name==='SQUEEZE'?'需要 1 個輸入。':'至少需要 1 個輸入。');
    if(inputs.some(t=>!t))return manual('請補齊所有輸入 tensor。');
    if(name==='CONCATENATION'&&inputs.some(t=>t.type!==inputs[0].type))return invalid('輸入 dtype 必須相同。');
    if(!inputs.every(known))return manual('動態或未知 shape 需明確指定，未自動推測。');
    const shapes=inputs.map(dimensions),first=shapes[0];let shape;
    if(name==='SQUEEZE'){
        const axes=options.squeeze_dims??[],set=new Set();
        if(!Array.isArray(axes)&&!ArrayBuffer.isView(axes))return invalid('squeeze_dims 必須為整數陣列。');
        for(const value of axes){const axis=value<0?value+first.length:value;if(!Number.isInteger(axis)||axis<0||axis>=first.length||first[axis]!==1)return invalid('squeeze_dims 只能指定範圍內、大小為 1 的維度。');set.add(axis);}
        // Kernel accepts duplicate/aliased axes and removes each dimension once.
        shape=first.filter((d,i)=>axes.length?!set.has(i):d!==1);
    }else{
        const axis=(options.axis??0)<0?(options.axis??0)+first.length:(options.axis??0);
        if(!first.length)return manual('scalar CONCATENATION 的常數條件需由 runtime 檢查，未自動推導。');
        if(!Number.isInteger(axis)||axis<0||axis>=first.length)return invalid('axis 超出輸入 rank。');
        shape=[...first];shape[axis]=0;
        for(const dims of shapes){
            if(dims.length!==first.length)return invalid('所有輸入 rank 必須相同。');
            if(dims.some((d,i)=>i!==axis&&d!==first[i]))return invalid('非 axis 維度必須相同。');
            shape[axis]+=dims[axis];if(shape[axis]>2147483647)return invalid('axis 維度總和超出 int32 範圍。');
        }
    }
    return {status:'inferred',shapes:[shape]};
}
export function checkStaticTransform(name,inputs,outputs,options){
    const result=inferStaticTransform(name,inputs,options);if(!result)return;
    if(result.status==='invalid')throw Error(result.reason);
    if(outputs.length!==1)throw Error(name+' 需要 1 個輸出。');
    if(inputs[0]&&outputs[0]&&inputs[0].type!==outputs[0].type)throw Error(name+' 輸入／輸出 dtype 不符。');
    if(result.status==='inferred'&&known(outputs[0])){const actual=dimensions(outputs[0]),expected=result.shapes[0];if(actual.length!==expected.length||actual.some((d,i)=>d!==expected[i]))throw Error(name+' 輸出 shape 不符合參數與輸入維度。');}
}
