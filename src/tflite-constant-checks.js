import {tflite as schema} from '../vendor/netron/tflite-schema.js';
import {OPERAND_OPERATORS,checkOperandValues,checkOperandMetadata} from './tflite-operand-checks.js';
// Bounded reads of actual serialized candidate bytes, never all weights.
export function validateTfliteConstants(model,graphId,readAt,{budget=4*1024**2}={}){
    const g=model.subgraphs[graphId],produced=new Set(g.operators.flatMap(o=>Array.from(o.outputs))),inputs=new Set(g.inputs),cache=new Map(),reasons=new Map(),operators=[];let bytesRead=0,inspectedBytes=0,checked=0,unchecked=0;
    const shape=t=>t?.has_rank!==false&&!t?.shape_signature?.some(d=>d<0)&&t?.shape&&Array.from(t.shape).every(d=>d>=0)?Array.from(t.shape):null;
    const values=id=>{
        if(cache.has(id))return cache.get(id);
        const skip=reason=>{reasons.set(id,reason);return null;};
        const t=g.tensors[id],b=model.buffers[t?.buffer],dims=shape(t),width={2:4,4:8,7:2,9:1,6:1}[t?.type];
        if(!t||!b||t.is_variable||inputs.has(id)||produced.has(id))return skip('是模型輸入、producer 的動態結果、variable 或沒有可讀 buffer。');
        if(!dims||!width)return skip('shape／整數編碼未知，未讀取常數。');
        const count=dims.reduce((a,b)=>a*b,1),size=count*width;
        if(!Number.isSafeInteger(size)||size>1024**2||inspectedBytes+size>budget)return skip('超過單 tensor 1 MiB 或本輪 4 MiB 常數檢視預算。');
        const length=Number(b.size||b.data?.length||0);if(length!==size)return skip('buffer 長度與 dtype／shape 不符，無法檢查常數內容。');
        if(!size){const result=[];cache.set(id,result);return result;}
        const data=b.size?readAt(Number(b.offset),size):b.data;if(!(data instanceof Uint8Array)||data.byteLength!==size)throw Error(`Tensor #${id} 常數資料讀取不完整。`);
        if(b.size)bytesRead+=size;inspectedBytes+=size;const dv=new DataView(data.buffer,data.byteOffset,data.byteLength),getter={2:'getInt32',4:'getBigInt64',7:'getInt16',9:'getInt8',6:'getUint8'}[t.type],result=Array.from({length:count},(_,i)=>BigInt(dv[getter](i*width,true)));
        if(cache.size<128)cache.set(id,result);return result;
    };
    for(const [node,op]of g.operators.entries()){
        const code=model.operator_codes[op.opcode_index],name=code.custom_code||schema.BuiltinOperator[Math.max(code.builtin_code,code.deprecated_builtin_code||0)];
        const record={graph:graphId,node,type:name,inputs:Array.from(op.inputs),outputs:Array.from(op.outputs),status:'not-run',reason:''};operators.push(record);
        if(code.custom_code){record.reason='custom kernel 的靜態語意尚未驗證；原始 options 與引用保留另列。';continue;}
        if(!['TRANSPOSE','RESHAPE','EXPAND_DIMS','GATHER'].includes(name)&&!OPERAND_OPERATORS.has(name)){record.reason='此 OP 尚無完整常數／輸出 shape 檢查規則；結構與已實作的 metadata 檢查另列。';continue;}
        const id=op.inputs[1],fail=message=>{throw Error(`Subgraph #${graphId} · OP #${node} ${name} · tensor #${id}：${message}`);};
        if(OPERAND_OPERATORS.has(name)){
            const inTensors=Array.from(op.inputs,id=>g.tensors[id]),outTensors=Array.from(op.outputs,id=>g.tensors[id]),options=op.builtin_options||{};
            try{
                checkOperandMetadata(name,inTensors,outTensors,options);
                const attempted=new Set(),proof=checkOperandValues(name,inTensors,outTensors,options,slot=>{const id=op.inputs[slot];attempted.add(id);return values(id);});
                record.status=proof.status;record.reason=proof.reason;
                if(proof.status==='passed')checked++;else{unchecked++;const missing=[...attempted].filter(id=>reasons.has(id));if(missing.length)record.reason=missing.map(id=>`tensor #${id}：${reasons.get(id)}`).join(' ');}
            }catch(error){throw Error(`Subgraph #${graphId} · OP #${node} ${name} · inputs tensor [${record.inputs.join(', ')}]／outputs tensor [${record.outputs.join(', ')}]：${error.message}`,{cause:error});}
            continue;
        }
        if(name==='TRANSPOSE'&&g.tensors[id]&&g.tensors[id].type!==2)fail('permutation tensor 必須是 int32。');
        const v=values(id),a=shape(g.tensors[op.inputs[0]]),out=shape(g.tensors[op.outputs[0]]);
        if(!v||!a||!out){unchecked++;record.reason=reasons.get(id)||'input／output 是動態或未知 shape，未推測實際尺寸。';continue;}
        let expected;
        if(name==='TRANSPOSE'){
            const rank=BigInt(a.length);
            if(v.length!==a.length||v.some(n=>n< -rank||n>=rank))fail('permutation 必須包含每個 axis 一次，且長度等於 input rank。');
            const axes=v.map(n=>Number(n<0n?n+rank:n));
            if(new Set(axes).size!==axes.length)fail('permutation 必須包含每個 axis 一次，且長度等於 input rank。');
            expected=axes.map(n=>a[n]);
        }else if(name==='EXPAND_DIMS'){
            if(v.length!==1||v[0]<BigInt(-a.length-1)||v[0]>BigInt(a.length))fail('axis 必須是 rank 範圍內的單一整數。');
            const axis=Number(v[0]<0n?v[0]+BigInt(a.length+1):v[0]);expected=[...a.slice(0,axis),1,...a.slice(axis)];
        }else if(name==='RESHAPE'){
            if(v.some(n=>n< -1n||n>2147483647n)||v.filter(n=>n===-1n).length>1)fail('shape 只能包含非負維度與最多一個 -1。');
            if(v.includes(0n)){unchecked++;record.reason='含零維度的 RESHAPE 常數組合尚未驗證。';continue;}
            const total=a.reduce((p,n)=>p*BigInt(n),1n),known=v.reduce((p,n)=>n<0n?p:p*n,1n);
            if(v.includes(-1n)&&known&&total%known===0n)expected=v.map(n=>Number(n===-1n?total/known:n));else if(!v.includes(-1n)&&known===total)expected=v.map(Number);else fail('shape tensor 與 input 元素數不符。');
        }else{
            let axis=op.builtin_options?.axis??0;if(axis<0)axis+=a.length;
            if(!Number.isInteger(axis)||axis<0||axis>=a.length)fail('axis 超出 input rank。');
            if(v.some(n=>n<0n||n>=BigInt(a[axis])))fail(`indices 必須位於 0～${a[axis]-1}。`);
        }
        if(expected&&(expected.length!==out.length||expected.some((d,i)=>d!==out[i])))fail(`output tensor #${op.outputs[0]} shape 應為 [${expected.join(', ')}]。`);
        checked++;
        record.status='passed';record.reason='已核對可讀常數及適用的靜態 shape／indices 範圍；不含 kernel 執行或數值語意。';
    }
    return {graph:graphId,checked,unchecked,bytesRead,inspectedBytes,operators,scope:'檢查有靜態型別及可讀常數的 TRANSPOSE／RESHAPE／EXPAND_DIMS／GATHER、PAD／SLICE／SPLIT 家族及 MEAN／SUM／REDUCE；最多檢視 4 MiB。逐 OP 列出適用規則，未知值、未支援規則、custom kernel 與數值等價仍未驗證。'};
}
