// Bounded, static operand rules. Kernel reference: TensorFlow
// 7bc5d217d3bd79426527d0055fd3b54812f52e93, lite/kernels/
// {pad,slice,strided_slice,split,split_v,reduce}.cc. Never executes a model.
import {staticTfliteShape} from './tflite-static-shape.js';
export const REDUCTIONS=new Set(['MEAN','SUM','REDUCE_PROD','REDUCE_MIN','REDUCE_MAX','REDUCE_ANY','REDUCE_ALL']);
export const OPERAND_OPERATORS=new Set(['PAD','PADV2','SLICE','STRIDED_SLICE','SPLIT','SPLIT_V',...REDUCTIONS]);
const dims=t=>t?.shape!==undefined?Array.from(t.shape):null;
const known=t=>staticTfliteShape(t)!==null;
const count=t=>dims(t)?.reduce((n,d)=>n*BigInt(d),1n);
const same=(a,b)=>a.length===b.length&&a.every((n,i)=>n===b[i]);
export function checkOperandMetadata(name,inputs,outputs,options={}){
    if(!OPERAND_OPERATORS.has(name))return;
    const fail=message=>{throw Error(`${name} ${message}`);};
    const data=inputs[name==='SPLIT'?1:0];
    const expected=name==='PADV2'?3:name==='PAD'||REDUCTIONS.has(name)||name==='SPLIT'?2:name==='STRIDED_SLICE'?4:3;
    if(inputs.length!==expected||inputs.some(t=>!t))fail(`需要 ${expected} 個完整輸入。`);
    if(!outputs.length||outputs.some(t=>!t))fail('請補齊輸出 tensor。');
    const split=name==='SPLIT'||name==='SPLIT_V';
    if(split){if(!Number.isInteger(options.num_splits)||options.num_splits<=0||options.num_splits!==outputs.length)fail('num_splits 必須為正整數且等於輸出數量。');}
    else if(outputs.length!==1)fail('需要 1 個輸出。');
    if(outputs.some(t=>t.type!==data.type))fail('data／output dtype 必須相同。');
    const type=(slot,allowed)=>{if(!allowed.includes(inputs[slot].type))fail(`input ${slot} dtype 必須是 ${allowed.map(n=>({2:'int32',4:'int64',7:'int16',9:'int8',6:'bool'})[n]).join('／')}。`);};
    const vector=slot=>{if(known(inputs[slot])&&dims(inputs[slot]).length!==1)fail(`input ${slot} 必須為一維 tensor。`);};
    const axis=slot=>{type(slot,[2]);if(known(inputs[slot])&&count(inputs[slot])!==1n)fail(`input ${slot} axis 必須只有一個元素。`);};
    if(name==='PAD'||name==='PADV2'){
        type(1,[2,4,7,9,6]);
        if(known(inputs[1])){const p=dims(inputs[1]);if(p.length!==2||p[1]!==2||known(data)&&p[0]!==dims(data).length)fail('paddings shape 必須為 [input rank, 2]。');}
        if(name==='PADV2'&&(inputs[2].type!==data.type||known(inputs[2])&&count(inputs[2])!==1n))fail('constant_values 必須是與 data 相同 dtype 的單一元素。');
    }else if(name==='SLICE'){
        type(1,[2,4]);type(2,[2,4]);vector(1);vector(2);
        if(inputs[1].type!==inputs[2].type)fail('begin／size dtype 必須相同。');
        if(known(data))for(const i of [1,2])if(known(inputs[i])&&count(inputs[i])!==BigInt(dims(data).length))fail('begin／size 長度必須等於 input rank。');
    }else if(name==='STRIDED_SLICE'){
        for(const i of [1,2,3]){type(i,[2]);vector(i);}
        if([1,2,3].every(i=>known(inputs[i]))){const n=count(inputs[1]);if(n>31n||[2,3].some(i=>count(inputs[i])!==n))fail('begin／end／strides 長度須相同且最多 31 個元素。');}
        for(const key of ['begin_mask','end_mask','ellipsis_mask','new_axis_mask','shrink_axis_mask'])if(options[key]!==undefined&&(!Number.isInteger(options[key])||options[key]<-2147483648||options[key]>2147483647))fail(`${key} 必須是 int32。`);
    }else if(split){
        axis(name==='SPLIT'?0:2);
        if(name==='SPLIT_V'){type(1,[2,4]);vector(1);if(known(inputs[1])&&count(inputs[1])!==BigInt(options.num_splits))fail('size_splits 長度必須等於 num_splits。');}
    }else{
        type(1,[2]);
        if(['REDUCE_ANY','REDUCE_ALL'].includes(name)&&data.type!==6)fail('data／output 必須是 bool。');
        if(options.keep_dims!==undefined&&typeof options.keep_dims!=='boolean')fail('keep_dims 必須是 boolean。');
    }
}

// getValues returns null and a caller-owned reason for dynamic/unreadable data.
export function checkOperandValues(name,inputs,outputs,options,getValues){
    if(!OPERAND_OPERATORS.has(name))return null;
    checkOperandMetadata(name,inputs,outputs,options);
    const data=inputs[name==='SPLIT'?1:0],fail=message=>{throw Error(message);};
    const pending=reason=>({status:'not-run',reason});
    if(!known(data)||outputs.some(t=>!known(t)))return pending('data／output 為動態或未知 shape，未推測實際尺寸。');
    const a=dims(data),slots=name==='SPLIT'?[0]:name==='SPLIT_V'?[1,2]:name==='SLICE'?[1,2]:name==='STRIDED_SLICE'?[1,2,3]:[1],v=new Map();
    for(const i of slots){const values=getValues(i);if(values===null)return pending(`input ${i} 的常數不可讀。`);v.set(i,values);}
    let shapes;
    if(name==='PAD'||name==='PADV2'){
        const p=v.get(1);if(p.length!==2*a.length||p.some(n=>n<0n||n>2147483647n))fail('paddings 必須是 rank × 2 個非負 int32 範圍整數。');
        const shape=a.map((n,i)=>BigInt(n)+p[2*i]+p[2*i+1]);if(shape.some(n=>n>2147483647n))fail('paddings 產生的 output shape 超出 int32 範圍。');shapes=[shape.map(Number)];
    }else if(name==='SLICE'){
        const begin=v.get(1),sizes=v.get(2);if(begin.length!==a.length||sizes.length!==a.length)fail('begin／size 長度須等於 input rank。');
        shapes=[a.map((n,i)=>{const dim=BigInt(n),b=begin[i],s=sizes[i];if(b<0n||b>dim||s< -1n||s>=0n&&s>dim-b)fail(`axis ${i} 的 begin／size 超出 input 範圍。`);return Number(s===-1n?dim-b:s);})];
    }else if(name==='SPLIT'||name==='SPLIT_V'){
        let axis=v.get(name==='SPLIT'?0:2);if(axis.length!==1)fail('axis 必須只有一個元素。');axis=axis[0]<0n?axis[0]+BigInt(a.length):axis[0];
        if(axis<0n||axis>=BigInt(a.length))fail('axis 超出 input rank。');axis=Number(axis);
        let sizes;
        if(name==='SPLIT'){if(a[axis]%outputs.length)fail('axis 維度無法被 num_splits 整除。');sizes=outputs.map(()=>BigInt(a[axis]/outputs.length));}
        else{
            sizes=v.get(1);if(sizes.length!==outputs.length||sizes.some(n=>n< -1n)||sizes.filter(n=>n===-1n).length>1)fail('size_splits 長度須等於輸出數量，且只能包含非負尺寸與最多一個 -1。');
            const sum=sizes.reduce((n,s)=>s<0n?n:n+s,0n),total=BigInt(a[axis]);
            if(sum>total||!sizes.includes(-1n)&&sum!==total)fail('size_splits 總和與 axis 維度不符。');sizes=sizes.map(n=>n===-1n?total-sum:n);
        }
        shapes=sizes.map(n=>a.map((d,i)=>i===axis?Number(n):d));
    }else if(REDUCTIONS.has(name)){
        const axes=new Set();if(a.length)for(let axis of v.get(1)){if(axis<0n)axis+=BigInt(a.length);if(axis<0n||axis>=BigInt(a.length))fail('axis 超出 input rank。');axes.add(Number(axis));}
        shapes=[options.keep_dims?a.map((n,i)=>axes.has(i)?1:n):a.filter((_,i)=>!axes.has(i))];
    }else{
        const result=stridedShape(a,v.get(1),v.get(2),v.get(3),options);if(result.reason)return pending(result.reason);shapes=[result.shape];
    }
    for(const [i,expected]of shapes.entries())if(!same(dims(outputs[i]),expected))fail(`output ${i} shape 應為 [${expected.join(', ')}]。`);
    return {status:'passed',reason:'已核對靜態參數、可讀常數與所有 output shape；不含 kernel 執行及數值語意。'};
}

function stridedShape(input,begin,end,strides,options){
    const bit=(key,i)=>((BigInt(options[key]??0)&0xffffffffn)>>BigInt(i)&1n)!==0n;
    const n=begin.length,ellipsis=Array.from({length:n},(_,i)=>i).filter(i=>bit('ellipsis_mask',i)),newCount=begin.filter((_,i)=>bit('new_axis_mask',i)&&!bit('ellipsis_mask',i)).length;
    if(input.length+newCount>31||ellipsis.length>1)return {reason:'超過 31 個有效維度或多個 ellipsis 的 mask 組合尚未驗證。'};
    const consumed=n-newCount-ellipsis.length;if(consumed>input.length)throw Error('slice 規格消耗的維度超出 input rank。');
    if(options.offset&&(ellipsis.length||newCount))return {reason:'offset 與 ellipsis／new_axis 組合尚未驗證，未猜測 output shape。'};
    const shape=[];let axis=0;
    const clamp=(n,lo,hi)=>n<lo?lo:n>hi?hi:n;
    for(let i=0;i<n;i++){
        if(bit('ellipsis_mask',i)){const width=input.length-consumed;shape.push(...input.slice(axis,axis+width));axis+=width;continue;}
        if(bit('new_axis_mask',i)){shape.push(1);continue;}
        const dim=BigInt(input[axis++]),step=strides[i];if(step===0n||step===-2147483648n)throw Error('stride 必須非零且不能為 INT32_MIN。');
        let start=begin[i];if(start<0n)start+=dim;start=clamp(start,step>0n?0n:-1n,step>0n?dim:dim-1n);if(bit('begin_mask',i))start=step>0n?0n:dim-1n;
        if(bit('shrink_axis_mask',i)){if(start<0n||start>=dim)throw Error('shrink axis 的 begin 未指向有效元素。');continue;}
        let stop=end[i];if(!options.offset){if(stop<0n)stop+=dim;stop=clamp(stop,step>0n?0n:-1n,step>0n?dim:dim-1n);if(bit('end_mask',i))stop=step>0n?dim:-1n;}
        const distance=options.offset?stop:stop-start;
        const size=(distance<0n)!==(step<0n)?0n:distance===0n?0n:(distance<0n?-distance:distance)+(step<0n?-step:step)-1n;
        const length=size===0n?0n:size/(step<0n?-step:step);if(length>2147483647n)throw Error('output shape 超出 int32 範圍。');shape.push(Number(length));
    }
    shape.push(...input.slice(axis));return {shape};
}
