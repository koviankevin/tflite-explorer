import {staticTfliteShape} from './tflite-static-shape.js';

// Pinned TFL_FullyConnectedOp and CPU CheckTypes have different encoding
// coverage. Preserve format-valid F16/U16/U32 cases as explicitly unverified;
// int64 bias is admitted by the CPU quantized path even though ODS omits it.
const activationTypes=new Set([0,1,3,7,9,16]),weightTypes=new Set([0,1,3,7,9,17,19]),biasTypes=new Set([0,1,2,4,15]);
const integerTypes=new Set([3,7,9]),quantizedWeights=new Set([3,7,9,17,19]);
const rank=t=>{
    const s=t?.shape;
    return (Array.isArray(s)||ArrayBuffer.isView(s)&&typeof s.length==='number')&&(s.length||t.has_rank!==false)?s.length:null;
};
const same=(a,b)=>a.length===b.length&&a.every((n,i)=>n===b[i]);
const elements=s=>s.reduce((n,d)=>n*BigInt(d),1n);
export function checkFullyConnectedMetadata(inputs,outputs,options={}){
    const fail=reason=>{throw Error(`FULLY_CONNECTED ${reason}`);},skip=reason=>({status:'not-run',reason:`FULLY_CONNECTED ${reason}`});
    if(![2,3].includes(inputs.length)||!inputs[0]||!inputs[1])fail('需要 2 個必要輸入與可省略的 bias。');
    const format=options.weights_format??0;
    if(![0,1].includes(format))return skip('未知 weights_format，未推測其型別或 shape 契約。');
    if(outputs.length!==(format===0?1:2)||outputs.some(t=>!t))fail(format===0?'DEFAULT 需要 1 個輸出。':'SHUFFLED4x16INT8 需要 result 與 workspace 兩個輸出。');
    if(options.quant_spec?.length)return skip('quant_spec 含非標準量化契約，尚未接入對應 verifier；未套用一般 dtype／shape 規則。');
    if(format!==0)return skip('SHUFFLED4x16INT8 的 workspace／packing 尚無完整規則，未冒充 DEFAULT 驗證。');
    const [input,weights,bias]=inputs,out=outputs[0];
    if(!activationTypes.has(input.type))fail('input dtype 不在已定義的 float／量化 activation 範圍。');
    if(!weightTypes.has(weights.type))fail('weights dtype 不在已定義的 float／量化 weights 範圍。');
    if(!activationTypes.has(out.type))fail('output dtype 不在已定義的 float／量化 activation 範圍。');
    if(bias&&!biasTypes.has(bias.type))fail('bias dtype 不在 float／整數 accumulator 範圍。');
    let understood=false;
    const extended=[input,weights,bias,out].some(t=>t&&[1,15,16].includes(t.type));
    if(!extended&&input.type===0&&(weights.type===0||[3,9,17,19].includes(weights.type))){
        if(out.type!==0)fail('float／hybrid output dtype 必須是 float32。');
        if(bias&&bias.type!==0)fail('float／hybrid bias dtype 必須是 float32。');
        understood=true;
    }else if(!extended&&integerTypes.has(input.type)&&quantizedWeights.has(weights.type)){
        if(!integerTypes.has(out.type))fail('量化 output dtype 必須是 uint8／int8／int16。');
        if(bias&&![2,4].includes(bias.type))fail('量化 bias dtype 必須是 int32／int64。');
        understood=out.type===input.type&&(weights.type===input.type||input.type===7&&weights.type===9||input.type===9&&[17,19].includes(weights.type));
    }
    const inputRank=rank(input),weightsRank=rank(weights),outRank=rank(out),keep=options.keep_num_dims??false;
    if(typeof keep!=='boolean')fail('keep_num_dims 必須是 boolean。');
    if(weightsRank!==null&&weightsRank!==2)fail('weights rank 必須為 2：[units, input_size]。');
    if(keep&&inputRank===0)fail('keep_num_dims 需要 input rank 至少為 1。');
    const expectedRank=keep?inputRank:2;
    if(outRank!==null&&expectedRank!==null&&outRank!==expectedRank)fail(`output rank 應為 ${expectedRank}。`);
    const a=staticTfliteShape(input),w=staticTfliteShape(weights),o=staticTfliteShape(out),b=staticTfliteShape(bias);
    if(w&&w[1]===0)return skip('weights input_size 為零的特殊 kernel 路徑尚未完整驗證；保留已核對的 dtype／rank。');
    if(w&&b&&elements(b)!==BigInt(w[0]))fail('bias 元素數須等於 weights units。');
    if(a&&w){
        const count=elements(a),cols=BigInt(w[1]);
        if(count%cols)fail('input 元素數無法整除 weights input_size。');
        if(keep&&a.at(-1)!==w[1])fail('keep_num_dims 的最後一維須等於 weights input_size。');
        const batch=count/cols;
        if(batch>BigInt(Number.MAX_SAFE_INTEGER))return skip('flattened batch 超過安全整數，未推測 output shape。');
        const expected=keep?[...a.slice(0,-1),w[0]]:[Number(batch),w[0]];
        if(o&&!same(o,expected))fail(`output shape 應為 [${expected.join(', ')}]。`);
    }
    if(!a||!w||!o||bias&&!b)return skip('input／weights／output／bias 含動態或未知 shape，僅核對可確定的型別與 rank／尺寸關係。');
    if(!understood)return skip('此 dtype／packing 組合尚無完整規則；已核對可確定的 rank 與靜態 shape，未推測 kernel 支援。');
    return {status:'passed',reason:'已核對 FULLY_CONNECTED dtype 關係、weights rank／keep_num_dims／output shape 與 bias 元素數；未讀權重、執行 kernel 或驗證量化數值。'};
}
