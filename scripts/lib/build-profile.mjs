import {readFile,lstat,cp,mkdir} from 'node:fs/promises';
import path from 'node:path';
import {filesIn,sha256,canonical} from './release-artifact.mjs';
export async function copyWebTree(directory,target,{include=()=>true}={}) {
    for(const name of await filesIn(directory)) {
        if(!include(name))continue;
        if(/\.(tflite|lite|mlir|onnx|bin|pt|pth|h5|safetensors)$/i.test(name))throw new Error(`網頁來源含模型或權重：${name}；請移到部署來源以外。`);
        if(!/\.(js|wasm|css|html|json|svg|png|ico|woff2?|ttf|txt|md)$/i.test(name) && path.basename(name)!=='LICENSE')continue;
        if(name.split('/').some(p=>p.startsWith('.')))throw new Error(`網頁來源含隱藏項目：${name}`);
        if(name.startsWith('internal-dialects/'))throw new Error('私有 dialect 請透過獨立的 --profile 目錄接入。');
        await mkdir(path.dirname(path.join(target,name)),{recursive:true});await cp(path.join(directory,name),path.join(target,name));
    }
}
export async function readProfile(filename) {
    if(!filename)return {distribution:'public',extension:null};
    const absolute=path.resolve(filename),bytes=await readFile(absolute);
    if(bytes.length>8192)throw new Error('內網建置設定超過 8 KiB。');
    const p=JSON.parse(bytes),allowed=['schemaVersion','distribution','name','extensionVersion','adapterInterfaceVersion','dialectDirectory'];
    if(!p || Object.keys(p).some(k=>!allowed.includes(k)) || p.schemaVersion!==1 || p.distribution!=='internal' || p.adapterInterfaceVersion!==1 || typeof p.name!=='string' || !p.name.trim() || p.name.length>80 || typeof p.extensionVersion!=='string' || !/^[\w.+-]{1,64}$/.test(p.extensionVersion) || typeof p.dialectDirectory!=='string' || !p.dialectDirectory || p.dialectDirectory.includes('://'))throw new Error('內網建置設定無效，或 adapter interface 版本不相容。');
    const directory=path.resolve(path.dirname(absolute),p.dialectDirectory),info=await lstat(directory);
    if(info.isSymbolicLink() || !info.isDirectory())throw new Error('Dialect 擴充來源必須是實體目錄。');
    const files=await filesIn(directory);let total=0;
    if(!files.includes('index.js'))throw new Error('Dialect 擴充缺少 index.js。');
    const fingerprint=[];
    for(const name of files) {
        if(!/\.(js|json|md|txt)$/i.test(name) && path.basename(name)!=='LICENSE')throw new Error(`Dialect 擴充不接受此檔案：${name}；模型與認證資料不得放在擴充目錄。`);
        const size=(await lstat(path.join(directory,name))).size;total+=size;
        if(size>16*1024*1024 || total>32*1024*1024)throw new Error('Dialect 擴充超過檔案／總量限制。');
        fingerprint.push(name,sha256(canonical(await readFile(path.join(directory,name)))));
    }
    return {distribution:'internal',directory,files,extension:{name:p.name.trim(),version:p.extensionVersion,adapterInterfaceVersion:1,sourceHash:sha256(Buffer.from(fingerprint.join('\n')))}};
}
export async function installProfile(stage,profile) {
    if(!profile.extension)return;
    const target=path.join(stage,'src/internal-dialects');
    await mkdir(target,{recursive:true});
    for(const name of profile.files){await mkdir(path.dirname(path.join(target,name)),{recursive:true});await cp(path.join(profile.directory,name),path.join(target,name));}
    await import('node:fs/promises').then(fs=>fs.writeFile(path.join(stage,'src/mlir-dialect-registry.js'),`import {validateDialectAdapters} from './mlir-dialect-contract.js';\nimport {mlirDialects as internal} from './internal-dialects/index.js';\nexport const mlirDialects=validateDialectAdapters(internal);\n`));
    await import('node:fs/promises').then(fs=>fs.writeFile(path.join(stage,'src/tflite-custom-registry.js'),`import {validateCustomContracts} from './tflite-custom-contract.js';\nimport {publicCustomContracts} from './tflite-public-custom-contracts.js';\nimport * as internal from './internal-dialects/index.js';\nconst extra=internal.tfliteCustomContracts===undefined?[]:validateCustomContracts(internal.tfliteCustomContracts);\nexport const tfliteCustomContracts=validateCustomContracts([...publicCustomContracts,...extra]);\n`));
}
