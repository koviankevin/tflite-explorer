import {readFile,open,writeFile,mkdir,rename,lstat} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {root,verifyArtifact,buildDestination,buildEvent,sha256} from './lib/release-artifact.mjs';
const crcTable=Uint32Array.from({length:256},(_,i)=>{let c=i;for(let b=0;b<8;b++)c=c&1?0xedb88320^(c>>>1):c>>>1;return c>>>0;});
const crc32=bytes=>{let c=0xffffffff;for(const b of bytes)c=crcTable[(c^b)&255]^(c>>>8);return (c^0xffffffff)>>>0;};

export async function packageRelease(directory='dist',{output='build/releases'}={}) {
    directory=await buildDestination(directory);
    const manifest=await verifyArtifact(directory),{release}=manifest;
    if(!/^[\w.+-]{1,80}$/.test(release.version))throw new Error('版本號無效。');
    const folder=await buildDestination(output);await mkdir(folder,{recursive:true});
    const filename=path.join(folder,`model-lens-${release.distribution}-${release.version}-${release.buildId}.zip`);
    await buildEvent({event:'create_intent',operation:'package',path:filename,kind:'deliverable',purpose:'Fixed-version static deployment package',producer:'scripts/package-release.mjs',inputs:[directory],cleanup_condition:'Retain delivered versions for rollback.'});
    try {await lstat(filename);throw new Error('相同版本的部署包已存在；請保留或核對既有包。');} catch(error){if(error.code!=='ENOENT')throw error;}
    const partial=filename+'.partial',archive=await open(partial,'wx'),hash=createHash('sha256'),central=[];let offset=0;
    const write=async bytes=>{await archive.writeFile(bytes);hash.update(bytes);offset+=bytes.length;};
    try {
        const expected=new Map(manifest.files.map(f=>[f.path,f]));
        for(const item of [...manifest.files.map(f=>f.path),'release-manifest.json'].sort()) {
            const name=Buffer.from(item),bytes=await readFile(path.join(directory,item)),crc=crc32(bytes),at=offset;
            if(expected.has(item) && sha256(bytes)!==expected.get(item).sha256)throw new Error(`封裝期間來源發生改變：${item}`);
            if(item==='release-manifest.json' && JSON.stringify(JSON.parse(bytes))!==JSON.stringify(manifest))throw new Error('封裝期間部署清單發生改變。');
            if(bytes.length>0xffffffff || offset+bytes.length>512*1024*1024)throw new Error('應用部署包超過 512 MiB，請確認沒有混入模型。');
            const local=Buffer.alloc(30);local.writeUInt32LE(0x04034b50);local.writeUInt16LE(20,4);local.writeUInt16LE(0x800,6);local.writeUInt16LE(0x21,12);local.writeUInt32LE(crc,14);local.writeUInt32LE(bytes.length,18);local.writeUInt32LE(bytes.length,22);local.writeUInt16LE(name.length,26);
            await write(local);await write(name);await write(bytes);
            const entry=Buffer.alloc(46);entry.writeUInt32LE(0x02014b50);entry.writeUInt16LE(20,4);entry.writeUInt16LE(20,6);entry.writeUInt16LE(0x800,8);entry.writeUInt16LE(0x21,14);entry.writeUInt32LE(crc,16);entry.writeUInt32LE(bytes.length,20);entry.writeUInt32LE(bytes.length,24);entry.writeUInt16LE(name.length,28);entry.writeUInt32LE(at,42);central.push(entry,name);
        }
        const at=offset;for(const bytes of central)await write(bytes);
        const end=Buffer.alloc(22),count=manifest.files.length+1;end.writeUInt32LE(0x06054b50);end.writeUInt16LE(count,8);end.writeUInt16LE(count,10);end.writeUInt32LE(offset-at,12);end.writeUInt32LE(at,16);await write(end);await archive.sync();
    } catch(error) {await buildEvent({event:'failed',operation:'package',path:filename,error:error.message});throw error;} finally {await archive.close();}
    await rename(partial,filename);
    const digest=hash.digest('hex');await writeFile(filename+'.sha256',`${digest}  ${path.basename(filename)}\n`,{flag:'wx',flush:true});
    await buildEvent({event:'created',operation:'package',path:filename,bytes:offset,sha256:digest});
    return {file:filename,bytes:offset,sha256:digest,distribution:release.distribution,release:release.buildId};
}
if(process.argv[1] && path.resolve(process.argv[1])===fileURLToPath(import.meta.url))console.log(JSON.stringify(await packageRelease(process.argv[2] || 'dist')));
