// Metadata only. Shared by editor inference and export validation; never reads
// weights or invokes a runtime. TensorFlow kernel reference: 7bc5d217d3bd79426527d0055fd3b54812f52e93
// tensorflow/lite/kernels/{conv.cc,depthwise_conv.cc,pooling.cc,padding.h}.
const names=new Set(['CONV_2D','DEPTHWISE_CONV_2D','AVERAGE_POOL_2D','MAX_POOL_2D','L2_POOL_2D']);
const dims=t=>t?.shape!==undefined&&(Array.isArray(t.shape)||ArrayBuffer.isView(t.shape))?Array.from(t.shape):null;
const known=t=>{const d=dims(t);return t?.has_rank!==false&&d&&d.length<=128&&!t.shape_signature?.some(n=>n<0)&&d.every(n=>Number.isInteger(n)&&n>=0&&n<=2147483647);};
export function inferSpatialTransform(name,inputs,options={}){
    if(!names.has(name))return null;
    const invalid=reason=>({status:'invalid',reason:`${name} ${reason}`}),manual=reason=>({status:'manual',reason:`${name} ${reason}`});
    const convolution=name==='CONV_2D'||name==='DEPTHWISE_CONV_2D',depthwise=name==='DEPTHWISE_CONV_2D';
    if(convolution?inputs.length<2||inputs.length>3:inputs.length!==1)return invalid(convolution?'需要資料、filter 與選用 bias。':'需要 1 個輸入。');
    if(!inputs[0]||convolution&&!inputs[1])return manual('請補齊資料及 filter tensor。');
    const required=convolution?inputs.slice(0,2):inputs;
    if(!required.every(known))return manual('動態或未知 shape 未推測，請明確指定。');
    const a=dims(inputs[0]);if(a.length!==4)return invalid('input 必須是 [batch, height, width, channels] 四維 tensor。');
    const sh=options.stride_h??0,sw=options.stride_w??0,dh=convolution?options.dilation_h_factor??1:1,dw=convolution?options.dilation_w_factor??1:1,padding=options.padding??0;
    if(![sh,sw,dh,dw].every(n=>Number.isInteger(n)&&n>0&&n<=2147483647))return invalid('stride／dilation 必須是正整數。');
    if(![0,1].includes(padding))return invalid('padding 必須是 SAME 或 VALID。');
    let fh,fw,channels=a[3];
    if(convolution){
        const w=dims(inputs[1]);if(w.length!==4)return invalid('filter 必須是四維 tensor。');
        if(a.slice(1).some(n=>n<=0)||w.some(n=>n<=0))return invalid('input 空間／channel 及 filter 維度必須大於 0。');
        [fh,fw]=w.slice(1,3);
        if(depthwise){
            if(w[0]!==1||w[3]%a[3])return invalid('filter 應為 [1, height, width, output_channels]，output channel 須為 input channel 的倍數。');
            channels=w[3];
        }else{
            if(a[3]%w[3]||w[0]%(a[3]/w[3]))return invalid('input／filter channel 與 grouped convolution 分組數不符。');
            channels=w[0];
        }
        const bias=inputs[2];if(bias){
            if(known(bias)&&(depthwise?dims(bias).length!==1||dims(bias)[0]!==channels:dims(bias).reduce((n,d)=>n*BigInt(d),1n)!==BigInt(channels)))return invalid('bias shape／元素數須對應 output channels。');
            const allowed={0:[0],3:[2],9:[2],7:depthwise?[4]:[2,4]}[inputs[0].type];
            if(allowed&&!allowed.includes(bias.type))return invalid('bias dtype 與 input 量化／浮點型別不符。');
        }
    }else{
        fh=options.filter_height??0;fw=options.filter_width??0;
        if(![fh,fw].every(n=>Number.isInteger(n)&&n>0&&n<=2147483647))return invalid('filter_height／filter_width 必須是正整數。');
    }
    // C++ integer division truncates toward zero, including an oversized VALID
    // window that produces zero. BigInt avoids precision loss in effective size.
    const size=(image,filter,stride,dilation)=>{
        const i=BigInt(image),s=BigInt(stride),effective=(BigInt(filter)-1n)*BigInt(dilation)+1n;
        const n=padding===0?(i+s-1n)/s:(i+s-effective)/s;
        return n<0n||n>2147483647n?null:Number(n);
    };
    const h=size(a[1],fh,sh,dh),w=size(a[2],fw,sw,dw);
    if(h===null||w===null)return invalid('window／dilation 產生無效或超出 int32 的 output shape。');
    return {status:'inferred',shapes:[[a[0],h,w,channels]]};
}
export function checkSpatialTransform(name,inputs,outputs,options){
    const result=inferSpatialTransform(name,inputs,options);if(!result)return;
    if(result.status==='invalid')throw Error(result.reason);
    if(outputs.length!==1)throw Error(`${name} 需要 1 個輸出。`);
    const out=outputs[0];if(inputs[0]&&out&&inputs[0].type!==out.type)throw Error(`${name} input／output dtype 必須相同。`);
    if(result.status==='inferred'&&known(out)){const actual=dims(out),expected=result.shapes[0];if(actual.length!==4||actual.some((n,i)=>n!==expected[i]))throw Error(`${name} output shape 應為 [${expected.join(', ')}]。`);}
}
