import {open,readFile,stat,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {spawn} from 'node:child_process';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {EXPORT_REPORT_LIMIT} from '../src/export-report.js';

const chunkBytes=1024*1024;
function validateReport(report) {
    if(report?.schemaVersion!==1 || report.format!=='model-lens-export-report' || !['mlir','tflite'].includes(report.output?.format) || report.source?.format!==report.output.format)throw new Error('不支援的匯出報告。');
    const ranges=report.provenance?.ranges;
    if(!Array.isArray(ranges) || ranges.length>100000 || ![report.source.bytes,report.output.bytes].every(n=>Number.isSafeInteger(n) && n>0))throw new Error('報告的檔案大小／資料範圍無效或過多。');
    for(const r of ranges)if(![r.sourceOffset,r.outputOffset,r.bytes].every(Number.isSafeInteger) || r.sourceOffset<0 || r.outputOffset<0 || r.bytes<=0 || r.sourceOffset>report.source.bytes-r.bytes || r.outputOffset>report.output.bytes-r.bytes)throw new Error('報告的資料範圍超出檔案。');
    const ordered=[...ranges].sort((a,b)=>a.outputOffset-b.outputOffset);
    for(let i=1;i<ordered.length;i++)if(ordered[i-1].outputOffset+ordered[i-1].bytes>ordered[i].outputOffset)throw new Error('報告的輸出資料範圍重疊。');
    return ranges;
}
async function hashRange(handle,start,bytes) {
    const hash=createHash('sha256'),buffer=Buffer.allocUnsafe(Math.min(chunkBytes,bytes));
    let offset=0;
    while(offset<bytes) {
        const {bytesRead}=await handle.read(buffer,0,Math.min(buffer.length,bytes-offset),start+offset);
        if(!bytesRead)throw new Error('檔案被截斷，未完成資料範圍比對。');
        hash.update(buffer.subarray(0,bytesRead));offset+=bytesRead;
    }
    return hash.digest('hex');
}
const sameFile=(before,after)=>before.size===after.size && before.mtimeMs===after.mtimeMs && before.ctimeMs===after.ctimeMs && before.ino===after.ino;
async function runCompiler(compiler,args,output,timeoutMs) {
    return new Promise((resolve,reject)=>{
        // Only explicit CLI options supply executable/arguments. A report cannot
        // select a program. No shell, no model-supplied commands or plugins.
        const child=spawn(compiler,[...args,output,'-o',process.platform==='win32'?'NUL':'/dev/null'],{shell:false,windowsHide:true,stdio:['ignore','ignore','pipe']});
        let diagnostic='',timedOut=false;
        child.stderr.on('data',data=>{if(diagnostic.length<8192)diagnostic+=data.toString('utf8').slice(0,8192-diagnostic.length);});
        const timer=setTimeout(()=>{timedOut=true;child.kill();},timeoutMs);
        child.on('error',error=>{clearTimeout(timer);reject(error);});
        child.on('close',(code,signal)=>{clearTimeout(timer);resolve({status:code===0&&!timedOut?'passed':'failed',exitCode:code,signal,timedOut,executable:path.basename(compiler),arguments:args,diagnostic,scope:'此 compiler 與指定參數的驗證；不含 runtime 數值等價性。'});});
    });
}

export async function verifyExportFiles({report,source,output,compiler,compilerArgs=[],timeoutMs=120000}) {
    const ranges=validateReport(report);
    if(compilerArgs.length && !compiler)throw new Error('指定 compiler 參數時也必須指定 --compiler。');
    if(compiler && report.output.format!=='mlir')throw new Error('compiler 接點僅適用於 MLIR；TFLite 需另用對應 runtime 驗證。');
    if(!Number.isSafeInteger(timeoutMs) || timeoutMs<1000 || timeoutMs>3600000)throw new Error('compiler timeout 必須為 1～3600 秒。');
    const sourceHandle=await open(source,'r');let outputHandle;
    try {
        outputHandle=await open(output,'r');
        const beforeSource=await sourceHandle.stat(),beforeOutput=await outputHandle.stat();
        if(!beforeSource.isFile() || !beforeOutput.isFile() || beforeSource.size!==report.source.bytes || beforeOutput.size!==report.output.bytes)throw new Error('來源或匯出檔案的大小與報告不符。');
        const compared=[],cached=new Map();
        for(const r of ranges) {
            const key=`${r.sourceOffset}:${r.bytes}`;
            if(!cached.has(key))cached.set(key,await hashRange(sourceHandle,r.sourceOffset,r.bytes));
            const actual=await hashRange(outputHandle,r.outputOffset,r.bytes),expected=cached.get(key);
            if(actual!==expected)throw new Error(`原始資料不一致：${r.kind || 'payload'}，來源 ${r.sourceOffset} → 輸出 ${r.outputOffset}（${r.bytes} bytes）。`);
            compared.push({...r,sha256:actual});
        }
        const outputSHA256=await hashRange(outputHandle,0,beforeOutput.size);
        const native=compiler?await runCompiler(compiler,compilerArgs,path.resolve(output),timeoutMs):{status:'not-run'};
        if(!sameFile(beforeSource,await sourceHandle.stat()) || !sameFile(beforeOutput,await outputHandle.stat()) || !sameFile(beforeSource,await stat(source)) || !sameFile(beforeOutput,await stat(output)))throw new Error('驗證期間檔案已變動，結果無效。');
        return {schemaVersion:1,format:'model-lens-export-verification',verifiedAt:new Date().toISOString(),outputSHA256,source:{name:path.basename(source),bytes:beforeSource.size},output:{name:path.basename(output),bytes:beforeOutput.size},byteComparison:{status:ranges.length?'passed':'not-applicable',ranges:compared,bytes:ranges.reduce((n,r)=>n+r.bytes,0)},nativeCompiler:native,runtimeEquivalence:{status:'not-run'},limitations:['僅比對報告列出的原始 byte ranges，完整來源檔未計算 SHA-256；報告本身未簽章。','下載後的完整輸出 SHA-256 供後續檔案核對；未宣稱來源身分或 OP 語意等價。','瀏覽器內的結構檢查記錄未在此工具重跑；native compiler 驗證僅在明確指定時執行。']};
    } finally {await sourceHandle.close();await outputHandle?.close();}
}

if(process.argv[1] && import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href) {
    try {
        const options={compilerArgs:[]},names={'--report':'reportFile','--source':'source','--output':'output','--compiler':'compiler','--save':'save','--compiler-timeout':'timeoutMs'};
        for(let i=2;i<process.argv.length;i++) {
            const flag=process.argv[i],value=process.argv[++i];
            if(value===undefined)throw new Error(`缺少 ${flag} 的值。`);
            if(flag==='--compiler-arg')options.compilerArgs.push(value);
            else if(names[flag])options[names[flag]]=flag==='--compiler-timeout'?Number(value):value;
            else throw new Error(`未知參數 ${flag}`);
        }
        if(!options.reportFile || !options.source || !options.output)throw new Error('用法：node scripts/verify-export.mjs --report 匯出.report.json --source 原始模型 --output 匯出模型 [--save 驗證.json] [--compiler mlir-opt] [--compiler-arg 參數]');
        const info=await stat(options.reportFile);if(!info.isFile() || info.size>EXPORT_REPORT_LIMIT)throw new Error('報告超過 16 MiB 或不是檔案。');
        options.report=JSON.parse(await readFile(options.reportFile,'utf8'));
        const receipt=await verifyExportFiles(options),text=JSON.stringify(receipt,null,2)+'\n';
        if(options.save)await writeFile(options.save,text,{flag:'wx'});
        process.stdout.write(text);if(receipt.nativeCompiler.status==='failed')process.exitCode=1;
    } catch(error) {process.stderr.write(error.message+'\n');process.exitCode=1;}
}
