import {tflite as schema} from '../vendor/netron/tflite-schema.js';
// Bounded reads of actual serialized candidate bytes, never all weights.
export function validateTfliteConstants(model,graphId,readAt,{budget=4*1024**2}={}){
    const g=model.subgraphs[graphId],produced=new Set(g.operators.flatMap(o=>Array.from(o.outputs))),inputs=new Set(g.inputs),cache=new Map();let bytesRead=0,checked=0,unchecked=0;
    const shape=t=>t?.has_rank!==false&&!t?.shape_signature?.some(d=>d<0)&&t?.shape&&Array.from(t.shape).every(d=>d>=0)?Array.from(t.shape):null;
    const values=id=>{
        if(cache.has(id))return cache.get(id);
        const t=g.tensors[id],b=model.buffers[t?.buffer],dims=shape(t);if(!t||!b||t.is_variable||inputs.has(id)||produced.has(id)||!dims||![2,4].includes(t.type))return null;
        const count=dims.reduce((a,b)=>a*b,1),width=t.type===2?4:8,size=count*width;
        if(!Number.isSafeInteger(size)||size>1024**2||bytesRead+size>budget)return null;
        const length=Number(b.size||b.data?.length||0);if(!length||length!==size)return null;
        const data=b.size?readAt(Number(b.offset),size):b.data;if(!(data instanceof Uint8Array)||data.byteLength!==size)throw Error(`Tensor #${id} 常數資料讀取不完整。`);
        bytesRead+=size;const dv=new DataView(data.buffer,data.byteOffset,data.byteLength),result=Array.from({length:count},(_,i)=>t.type===2?BigInt(dv.getInt32(i*4,true)):dv.getBigInt64(i*8,true));
        if(cache.size<128)cache.set(id,result);return result;
    };
    for(const [node,op]of g.operators.entries()){
        const code=model.operator_codes[op.opcode_index];if(code.custom_code)continue;
        const name=schema.BuiltinOperator[Math.max(code.builtin_code,code.deprecated_builtin_code||0)];if(!['TRANSPOSE','RESHAPE','EXPAND_DIMS','GATHER'].includes(name))continue;
        const id=op.inputs[1],v=values(id),a=shape(g.tensors[op.inputs[0]]),out=shape(g.tensors[op.outputs[0]]);
        if(!v||!a||!out){unchecked++;continue;}
        const fail=message=>{throw Error(`Subgraph #${graphId} · OP #${node} ${name} · tensor #${id}：${message}`);};let expected;
        if(name==='TRANSPOSE'){
            if(v.length!==a.length||new Set(v).size!==v.length||v.some(n=>n<0n||n>=BigInt(a.length)))fail('permutation 必須包含每個 axis 一次，且長度等於 input rank。');
            expected=v.map(n=>a[Number(n)]);
        }else if(name==='EXPAND_DIMS'){
            if(v.length!==1||v[0]<BigInt(-a.length-1)||v[0]>BigInt(a.length))fail('axis 必須是 rank 範圍內的單一整數。');
            const axis=Number(v[0]<0n?v[0]+BigInt(a.length+1):v[0]);expected=[...a.slice(0,axis),1,...a.slice(axis)];
        }else if(name==='RESHAPE'){
            if(v.some(n=>n< -1n||n>2147483647n)||v.filter(n=>n===-1n).length>1)fail('shape 只能包含非負維度與最多一個 -1。');
            if(v.includes(0n)){unchecked++;continue;}
            const total=a.reduce((p,n)=>p*BigInt(n),1n),known=v.reduce((p,n)=>n<0n?p:p*n,1n);
            if(v.includes(-1n)&&known&&total%known===0n)expected=v.map(n=>Number(n===-1n?total/known:n));else if(!v.includes(-1n)&&known===total)expected=v.map(Number);else fail('shape tensor 與 input 元素數不符。');
        }else{
            let axis=op.builtin_options?.axis??0;if(axis<0)axis+=a.length;
            if(!Number.isInteger(axis)||axis<0||axis>=a.length)fail('axis 超出 input rank。');
            if(v.some(n=>n<0n||n>=BigInt(a[axis])))fail(`indices 必須位於 0～${a[axis]-1}。`);
        }
        if(expected&&(expected.length!==out.length||expected.some((d,i)=>d!==out[i])))fail(`output tensor #${op.outputs[0]} shape 應為 [${expected.join(', ')}]。`);
        checked++;
    }
    return {checked,unchecked,bytesRead,scope:'只檢查有靜態型別及可讀常數的 TRANSPOSE／RESHAPE／EXPAND_DIMS／GATHER；最多讀取 4 MiB，不含未知值、custom kernel 與數值等價。'};
}
