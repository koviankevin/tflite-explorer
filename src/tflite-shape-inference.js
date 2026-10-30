// Conservative metadata-only inference. Tensor-valued axes/permutations are not
// guessed; an unsupported rule keeps an explicit reference tensor.
import {inferStaticTransform} from './tflite-static-transform.js';
import {inferSpatialTransform} from './tflite-spatial-checks.js';
const unary=new Set(['ABS','NEG','EXP','LOG','SQRT','RSQRT','SQUARE','FLOOR','CEIL','ROUND','RELU','RELU6','RELU_N1_TO_1','LOGISTIC','TANH','ELU','LEAKY_RELU','HARD_SWISH','GELU','SOFTMAX','LOG_SOFTMAX','SIN','COS']);
const binary=new Set(['ADD','MUL','SUB','DIV','MAXIMUM','MINIMUM','POW','SQUARED_DIFFERENCE']);
export function inferTfliteOutputs(name,inputs,outputs,options={}){
    const manual=reason=>({status:'manual',reason});
    if(outputs.length!==1||!inputs.length||inputs.some(t=>!t))return manual('請補齊輸入；此推導需要單一輸出。');
    if([...inputs,...outputs].some(t=>t.shape_signature?.some(n=>n<0)||!Array.isArray(t.shape)||t.shape.length>128||t.shape.some(n=>!Number.isInteger(n)||n<0||n>2147483647)))return manual('動態或未知 shape 需明確指定，未自動推測。');
    let shape;const transform=inferStaticTransform(name,inputs,options)||inferSpatialTransform(name,inputs,options);
    if(transform){if(transform.status!=='inferred')return manual(transform.reason);shape=transform.shapes[0];}
    else if(unary.has(name)&&inputs.length===1)shape=[...inputs[0].shape];
    else if(binary.has(name)&&inputs.length===2){
        if(inputs[0].type!==inputs[1].type)return manual('兩個輸入 dtype 不同，請修正後再推導。');
        const [a,b]=inputs.map(t=>t.shape);shape=[];
        for(let i=0;i<Math.max(a.length,b.length);i++){const x=a.at(-1-i)??1,y=b.at(-1-i)??1;if(x!==y&&x!==1&&y!==1)return manual('兩個輸入無法 broadcast，匯出時會拒絕。');shape.unshift(x===1?y:x);}
    }else if(name==='RESHAPE'&&inputs.length===1&&options.new_shape?.length){
        shape=[...options.new_shape];if(shape.some(d=>!Number.isInteger(d)||d< -1)||shape.filter(d=>d===-1).length>1)return manual('RESHAPE new_shape 無效。');
        const elements=inputs[0].shape.reduce((n,d)=>n*d,1),known=shape.filter(d=>d!==-1).reduce((n,d)=>n*d,1),unknown=shape.indexOf(-1);
        if(!Number.isSafeInteger(elements)||!Number.isSafeInteger(known)||unknown>=0&&(!known||elements%known)||unknown<0&&elements!==known)return manual('RESHAPE 元素數無法確定或不符。');if(unknown>=0)shape[unknown]=elements/known;
    }else return manual('此 OP 尚無 metadata 推導規則，沿用所選 tensor；請執行 LiteRT 檢查。');
    if(inputs[0].type!==outputs[0].type)return manual('輸出參考 dtype 與輸入不同，請先選擇相同 dtype。');
    const q=outputs[0].quantization;if(q?.scale?.length>1&&shape[q.quantized_dimension]!==q.scale.length)return manual('新 shape 與 per-axis 量化 channel 不符，未修改量化參數。');
    if(shape.some(d=>!Number.isSafeInteger(d)||d<0||d>2147483647))return manual('推導結果超出有效 tensor 維度。');
    return {status:'inferred',reason:'依 OP 規則與已接入 tensor 推導 shape；dtype／量化沿用明確參考，仍需 runtime 驗證。',shapes:[shape]};
}
