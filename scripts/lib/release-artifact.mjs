import {readFile,readdir,lstat,realpath,writeFile,mkdir,appendFile} from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';
// fileURLToPath is required for spaces/non-ASCII Windows paths.
import {fileURLToPath} from 'node:url';
export const root=fileURLToPath(new URL('../../',import.meta.url));
export const sha256=bytes=>createHash('sha256').update(bytes).digest('hex');
export const canonical=bytes=>Buffer.from(bytes.toString('utf8').replaceAll('\r\n','\n'));
export const within=(parent,child)=>{const relative=path.relative(parent,child);return relative!=='' && !relative.startsWith('..'+path.sep) && relative!=='..' && !path.isAbsolute(relative);};
export function gitSource() {
    const run=args=>{const r=spawnSync('git',args,{cwd:root,encoding:'utf8',windowsHide:true});if(r.status!==0)throw new Error('建置需要可讀的 Git checkout。');return r.stdout.trim();};
    return {commit:run(['rev-parse','HEAD']),tree:run(['rev-parse','HEAD^{tree}']),committedAt:run(['show','-s','--format=%cI','HEAD']),dirty:Boolean(run(['status','--porcelain','--untracked-files=normal']))};
}
export function webSources() {
    const result=spawnSync('git',['ls-files','-z','--cached','--others','--exclude-standard','--','src','vendor'],{cwd:root,encoding:'utf8',windowsHide:true});
    if(result.status!==0)throw new Error('無法核對網頁來源清單。');
    return new Set(result.stdout.split('\0').filter(Boolean));
}
export async function filesIn(directory) {
    const result=[];
    const walk=async(current,prefix='')=>{
        for(const entry of await readdir(current,{withFileTypes:true})) {
            const file=path.join(current,entry.name),name=prefix+entry.name,info=await lstat(file);
            if(info.isSymbolicLink())throw new Error(`部署內容不能包含 symbolic link：${name}`);
            if(info.isDirectory())await walk(file,name+'/');
            else if(info.isFile())result.push(name);
            else throw new Error(`不支援的部署項目：${name}`);
        }
    };
    await walk(directory);return result.sort();
}
export function safeFile(name) {
    if(typeof name!=='string' || !name || name.includes('\\') || name.includes(':') || name.includes('\0') || name.startsWith('/') || name.split('/').some(p=>!p || p==='.' || p==='..' || /[. ]$/.test(p)))throw new Error('部署清單含不安全的檔案路徑。');
    return name;
}
export async function writeManifest(directory,release) {
    const files=[];
    for(const name of await filesIn(directory)) {
        const bytes=await readFile(path.join(directory,name));
        files.push({path:safeFile(name),bytes:bytes.length,sha256:sha256(bytes)});
    }
    const manifest={schemaVersion:1,release,files};
    await writeFile(path.join(directory,'release-manifest.json'),JSON.stringify(manifest,null,2)+'\n');
    return manifest;
}
export async function verifyArtifact(directory,{publicOnly=false,expectedCommit,requireClean=false}={}) {
    const info=await lstat(directory);if(info.isSymbolicLink() || !info.isDirectory())throw new Error('部署來源必須是實體目錄。');
    const raw=await readFile(path.join(directory,'release-manifest.json'));
    if(raw.length>4*1024*1024)throw new Error('部署清單過大。');
    const manifest=JSON.parse(raw),release=manifest.release;
    if(manifest.schemaVersion!==1 || !release || !['public','internal'].includes(release.distribution) || !/^[a-f0-9]{16}$/.test(release.buildId) || !/^[a-f0-9]{40}$/.test(release.source?.commit) || !Array.isArray(manifest.files) || !manifest.files.length || manifest.files.length>10000)throw new Error('部署清單格式無效。');
    if(publicOnly && (release.distribution!=='public' || release.extension))throw new Error('拒絕公開發布內網／私有 dialect 建置。');
    if(expectedCommit && release.source.commit!==expectedCommit)throw new Error('建置來源與目前 commit 不符；請重新建置。');
    if(requireClean && release.source.dirty)throw new Error('建置含未提交修改；請提交、重新建置後發布。');
    const names=new Set();
    for(const row of manifest.files) {
        safeFile(row.path);const key=row.path.toLowerCase();
        if(names.has(key) || key==='release-manifest.json' || !Number.isSafeInteger(row.bytes) || row.bytes<0 || !/^[a-f0-9]{64}$/.test(row.sha256))throw new Error('部署清單有重複或無效項目。');
        names.add(key);
    }
    const actual=await filesIn(directory),expected=['release-manifest.json',...manifest.files.map(f=>f.path)].sort();
    if(JSON.stringify(actual)!==JSON.stringify(expected))throw new Error('部署目錄有遺漏或清單外檔案；請使用完整的新建置。');
    if(publicOnly && actual.some(n=>n.startsWith('src/internal-dialects/')))throw new Error('公開部署不能含內部 dialect。');
    for(const row of manifest.files) {
        const bytes=await readFile(path.join(directory,row.path));
        if(bytes.length!==row.bytes || sha256(bytes)!==row.sha256)throw new Error(`部署完整性檢查失敗：${row.path}`);
    }
    if(!['index.html','src/app.js','src/model-worker.js','release.json','LICENSE','LICENSE-Netron.txt'].every(n=>actual.includes(n)))throw new Error('部署缺少必要檔案或授權。');
    if(JSON.stringify(JSON.parse(await readFile(path.join(directory,'release.json'),'utf8')))!==JSON.stringify(release))throw new Error('版本資訊與部署清單不符。');
    return manifest;
}
export async function buildDestination(value='dist') {
    const destination=path.resolve(root,value),allowed=destination===path.join(root,'dist') || within(path.join(root,'build'),destination) || within(path.join(root,'test-results'),destination);
    if(!allowed)throw new Error('建置輸出限於專案的 dist、build/ 或 test-results/ 子目錄。');
    let current=destination;
    while(current!==path.resolve(root)) {
        try {if((await lstat(current)).isSymbolicLink())throw new Error('建置路徑不能經過 symbolic link。');} catch(error) {if(error.code!=='ENOENT')throw error;}
        current=path.dirname(current);
    }
    const resolvedRoot=await realpath(root);
    if(!within(resolvedRoot,destination) && !within(path.resolve(root),destination))throw new Error('建置路徑超出專案。');
    return destination;
}
export async function buildEvent(event) {
    await mkdir(path.join(root,'build'),{recursive:true});
    await appendFile(path.join(root,'build','events.jsonl'),JSON.stringify({timestamp:new Date().toISOString(),...event})+'\n',{flush:true});
}
