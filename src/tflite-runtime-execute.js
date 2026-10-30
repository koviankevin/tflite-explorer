import {RUNTIME_ENGINE,RUNTIME_LIMITS,runtimeSkipped} from './tflite-runtime-policy.js';
import {runtimeInput,validateRuntimeInputs} from './tflite-runtime-inputs.js';
import {runtimeArchive} from './tflite-runtime-archive.js';
import {runtimeFailureLocations} from './tflite-runtime-diagnostics.js';
const scope='主 subgraph 的載入／CPU 配置及一組指定輸入；不代表數值精度、等價性、全部 signatures 或分支覆蓋。';
export async function executeRuntime({blob,plan,rt,specs=plan?.inputs?.map(()=>({mode:'zero'})),progress=()=>{},diagnostics=()=>[],transferableIO=false,ioBuffer=null}){
    if(!plan?.eligible||blob.size!==plan.modelBytes||blob.size>RUNTIME_LIMITS.modelBytes)return runtimeSkipped(plan?.reason||'模型與執行檢查資料不符。');
    let stage='inputs',model=null,environment=null,ins=[],outs=[],compiled=false,invoked=false,modelSHA256=null,inputDetails=[],outputDetails=[];
    const started=performance.now();
    const record=(status,reason)=>{const lines=diagnostics().slice(-12).map(s=>String(s).slice(0,512));return {schemaVersion:1,engine:RUNTIME_ENGINE,status,stage,reason,compiled,invoked,modelSHA256,elapsedMs:Math.round(performance.now()-started),scope,diagnostics:lines,...(status==='failed'?{failureKind:/allocate|allocation/i.test(reason)?'tensor-allocation':'runtime',failureLocations:runtimeFailureLocations(lines,plan.diagnosticContext)}:{})};};
    const capture=(status,reason)=>{const result=record(status,reason);if(ins.length||invoked)try{result.io=runtimeArchive({validation:result,inputs:ins,outputs:outs,inputDetails,outputDetails:outs.map((t,i)=>({name:outputDetails[i]?.name,dtype:t.dtype})),specs,modelSHA256,transferable:transferableIO,ioBuffer});}catch(error){result.ioError=`執行記錄未能保存：${String(error.message).slice(0,512)}`;}return result;};
    try{
        validateRuntimeInputs(plan.inputs,specs);
        stage='compile';progress('LiteRT：載入模型及配置 CPU tensors…');
        const bytes=new Uint8Array(await blob.arrayBuffer());
        if(globalThis.crypto?.subtle)modelSHA256=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),b=>b.toString(16).padStart(2,'0')).join('');
        environment=await rt.Environment.create({webGpuDevice:null});
        model=await rt.loadAndCompile(bytes,{accelerator:'wasm',environment,cpuOptions:{numThreads:1}});compiled=true;
        stage='interface';inputDetails=model.getInputDetails();outputDetails=model.getOutputDetails();
        const matches=(actual,expected)=>actual.length===expected.length&&actual.every((v,i)=>v.dtype===expected[i].dtype&&JSON.stringify(Array.from(v.shape))===JSON.stringify(expected[i].shape));
        if(!matches(inputDetails,plan.inputs)||!matches(outputDetails,plan.outputs))return capture('failed','runtime 推導的輸入／輸出 shape 或 dtype 與匯出模型宣告不符；請修正 output tensor。');
        stage='inputs';for(let i=0;i<inputDetails.length;i++){const t=inputDetails[i];ins.push(new rt.Tensor(await runtimeInput({...t,shape:Array.from(t.shape)},specs[i]),t.shape,t.dtype,environment));}
        stage='invoke';progress('LiteRT：使用指定測試輸入執行；不驗證精度…');
        const values=await model.run(ins);outs=Array.isArray(values)?values:Object.values(values);invoked=true;
        if(!matches(outs.map(t=>({dtype:t.dtype,shape:t.shape})),plan.outputs))return capture('failed','執行後輸出 shape 或 dtype 與模型宣告不符。');
        stage='complete';return capture('passed','已載入、配置並以指定輸入執行一次；精度與其他分支仍需測試。');
    }catch(error){const reason=String(error?.message||error).slice(0,1024),unsupported=/not supported|unsupported|缺少|尚不支援/i.test(reason),allocation=/allocate|allocation|prepare.*fail/i.test(reason),hint=allocation?(stage==='compile'?'失敗發生在套用測試輸入之前，切換零值／亂數無法修復此階段；請檢查 OP 參數、tensor shape、量化與 runtime 支援，並查看原始診斷。':'runtime 可能在 run() 階段才配置 tensors；請依原始 kernel 訊息與 OP／tensor 對照確認原因，不能只依階段名稱判定為測試輸入錯誤。'):'需依此 runtime／輸入的診斷確認原因。';return capture(unsupported?'not-verified':'failed',`${stage==='invoke'?'指定輸入執行':stage==='inputs'?'測試輸入':'runtime 載入／配置'}失敗：${reason}。${hint}`);}
    finally{for(const t of new Set([...outs,...ins]))try{t.delete();}catch{}try{model?.delete();}catch{}try{environment?.delete();}catch{}}
}
