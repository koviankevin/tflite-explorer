// Conservative metadata checks. Unsupported/dynamic cases are left to the
// optional runtime; they must never be reported as fully kernel-verified.
const known=t=>t&&t.has_rank!==false&&!t.shape_signature?.some(d=>d<0)&&t.shape&&Array.from(t.shape).every(d=>Number.isSafeInteger(d)&&d>=0);
const shape=t=>Array.from(t.shape),same=(a,b)=>a.length===b.length&&a.every((n,i)=>n===b[i]);
export function checkOperatorMetadata(name,inputs,outputs,options={}){
    const fail=message=>{throw Error(`${name} ${message}`);},out=outputs[0];
    for(const [side,ts] of [['input',inputs],['output',outputs]])for(const [slot,t] of ts.entries()){
        const q=t?.quantization;if(!q?.scale?.length)continue;
        if(Array.from(q.scale).some(s=>!Number.isFinite(s)||s<=0)||q.zero_point?.length!==q.scale.length)fail(`${side} ${slot} 量化 scale／zero point 數量或數值無效。`);
        if(q.scale.length>1&&known(t)&&(!Number.isInteger(q.quantized_dimension)||q.quantized_dimension<0||q.quantized_dimension>=t.shape.length||t.shape[q.quantized_dimension]!==q.scale.length))fail(`${side} ${slot} per-axis 量化維度與 scale 數量不符。`);
        const range={3:[0n,255n],7:[-32768n,32767n],9:[-128n,127n],2:[-2147483648n,2147483647n]}[t.type];
        if(range&&Array.from(q.zero_point).some(z=>BigInt(z)<range[0]||BigInt(z)>range[1]))fail(`${side} ${slot} zero point 超出 dtype 範圍。`);
    }
    if(name==='FULLY_CONNECTED'&&known(inputs[0])&&known(inputs[1])&&known(out)&&(options.weights_format??0)===0){
        const a=shape(inputs[0]),w=shape(inputs[1]),bias=inputs[2];
        if(w.length!==2)fail('weights 必須是 [units, input_size] 二維 tensor。');
        if(!w[1])return;
        const count=a.reduce((n,d)=>n*BigInt(d),1n);
        if(count%BigInt(w[1]))fail('input 元素數無法整除 weights input_size。');
        let expected;
        if(options.keep_num_dims){if(!a.length||a.at(-1)!==w[1])fail('keep_num_dims 的最後一維須等於 weights input_size。');expected=[...a.slice(0,-1),w[0]];}
        else{const batch=count/BigInt(w[1]);if(batch>BigInt(Number.MAX_SAFE_INTEGER))return;expected=[Number(batch),w[0]];}
        if(!same(shape(out),expected))fail(`output shape 應為 [${expected.join(', ')}]。`);
        if(bias&&known(bias)&&shape(bias).reduce((n,d)=>n*BigInt(d),1n)!==BigInt(w[0]))fail('bias 元素數須等於 units。');
    }
    if(name==='BATCH_MATMUL'&&inputs.slice(0,2).every(known)&&known(out)){
        const [a,b]=inputs.map(shape);if(a.length<2||b.length<2)fail('inputs rank 必須至少為 2。');
        const m=a.at(options.adj_x?-1:-2),ka=a.at(options.adj_x?-2:-1),kb=b.at(options.adj_y?-1:-2),n=b.at(options.adj_y?-2:-1);
        if(ka!==kb)fail('兩個 input 的 contracting dimension 不符。');
        const x=a.slice(0,-2),y=b.slice(0,-2),batch=[];
        for(let i=0;i<Math.max(x.length,y.length);i++){const p=x.at(-i-1)??1,q=y.at(-i-1)??1;if(p!==q&&p!==1&&q!==1)fail('batch 維度無法 broadcast。');batch.unshift(p===1?q:p);}
        if(!same(shape(out),[...batch,m,n]))fail(`output shape 應為 [${[...batch,m,n].join(', ')}]。`);
    }
    if(['TRANSPOSE','RESHAPE','EXPAND_DIMS'].includes(name)&&inputs[0]&&out&&inputs[0].type!==out.type)fail('input／output dtype 必須相同。');
    if(name==='RESHAPE'&&inputs.length===1&&known(inputs[0])&&known(out)&&options.new_shape){
        const dims=Array.from(options.new_shape);if(dims.some(d=>!Number.isInteger(d)||d< -1)||dims.filter(d=>d===-1).length>1)fail('options new_shape 無效。');
        if(!dims.includes(0)){const total=shape(inputs[0]).reduce((a,b)=>a*BigInt(b),1n),product=dims.reduce((a,b)=>b<0?a:a*BigInt(b),1n);if(!product||total%product||!dims.includes(-1)&&total!==product)fail('options new_shape 元素數不符。');const expected=dims.map(d=>d===-1?Number(total/product):d);if(!same(shape(out),expected))fail(`options new_shape 的 output 應為 [${expected.join(', ')}]。`);}
    }
    if(name==='TRANSPOSE'&&inputs[1]&&![2,4].includes(inputs[1].type))fail('permutation tensor 必須是 int32／int64。');
    if(name==='GATHER'&&known(inputs[0])&&known(inputs[1])&&known(out)){
        if(![2,4,7].includes(inputs[1].type))fail('indices 必須是 int16／int32／int64。');
        const p=shape(inputs[0]),i=shape(inputs[1]),axis=(options.axis??0)<0?(options.axis??0)+p.length:(options.axis??0),batch=(options.batch_dims??0)<0?(options.batch_dims??0)+i.length:(options.batch_dims??0);
        if(!Number.isInteger(axis)||axis<0||axis>=p.length||!Number.isInteger(batch)||batch<0||batch>Math.min(axis,i.length))fail('axis／batch_dims 超出 rank 範圍。');
        if(p.slice(0,batch).some((d,j)=>d!==i[j]))fail('batch_dims 指定的 batch 維度不符。');
        const expected=[...p.slice(0,axis),...i.slice(batch),...p.slice(axis+1)];
        if(!same(shape(out),expected))fail(`output shape 應為 [${expected.join(', ')}]。`);
        if(inputs[0].type!==out.type)fail('params／output dtype 必須相同。');
    }
}
