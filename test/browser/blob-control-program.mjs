// Standalone diagnostic harness, never shipped in the application. Drive each
// API transition by a visible button; export only scalar status, not file data.
export const BLOB_CONTROL_PREFIX_BYTES=8268412;
export function installBlobControlWorker(scope,{prefixBytes=65536}={}){
    if(![65536,8268412].includes(prefixBytes))throw Error('Unknown control prefix size.');
    let file,blob,candidate;const stats={inputBytes:0,blobBytes:0,readBytes:0,maxRead:0,builds:0,readbacks:0,boundaryReads:0,shares:0};
    const read=(source,start,end)=>{
        const length=end-start;if(length<0||length>65536||stats.readBytes+length>16*1024**2)throw Error('Bounded control read exceeded.');
        stats.readBytes+=length;stats.maxRead=Math.max(stats.maxRead,length);return new scope.FileReaderSync().readAsArrayBuffer(source.slice(start,end));
    };
    scope.onmessage=({data})=>{try{
        if(data.action==='build'){
            if(file||blob||!data.file||!Number.isSafeInteger(data.file.size)||data.file.size<=1024**3||typeof data.file.slice!=='function')throw Error('Expected one physical large source.');
            file=data.file;stats.inputBytes=file.size;const prefix=new Uint8Array(prefixBytes);
            for(let offset=0;offset<prefixBytes;offset+=65536)prefix.set(new Uint8Array(read(file,offset,Math.min(prefixBytes,offset+65536))),offset);
            blob=new scope.Blob([prefix,file.slice(prefixBytes)],{type:'application/octet-stream'});stats.blobBytes=blob.size;stats.builds++;scope.postMessage({stage:'built',stats:{...stats}});
        }else if(data.action==='readback'){
            if(!blob||candidate)throw Error('Unexpected readback order.');candidate=new scope.File([blob],'control.tflite');
            read(candidate,0,64);read(candidate,candidate.size-64,candidate.size);stats.readbacks++;scope.postMessage({stage:'readback',stats:{...stats}});
        }else if(data.action==='boundary'){
            if(!candidate||stats.boundaryReads||stats.shares)throw Error('Unexpected boundary read order.');
            // This read straddles the actual typed-prefix/File join.
            read(candidate,prefixBytes-32,prefixBytes+32);stats.boundaryReads++;scope.postMessage({stage:'boundary',stats:{...stats}});
        }else if(data.action==='share'){
            if(!candidate||stats.boundaryReads!==1||stats.shares)throw Error('Unexpected share order.');stats.shares++;scope.postMessage({stage:'shared',blob,stats:{...stats}});
        }else throw Error('Unknown control action.');
    }catch(error){scope.postMessage({stage:'error',error:error.message});}};
}

export function installBlobControlPage({fileWrap='after-download'}={}){
    if(!['after-download','during-download'].includes(fileWrap))throw Error('Unknown File wrap timing.');
    const $=id=>document.getElementById(id),actions=['build','readback','boundary','share','url','download','wrap','clear'];let source,worker,blob,wrapped,url,stats={},stage='initial',revoked=false,urlCreatedAt=null,urlRevokedAt=null,downloadClickedAt=null,fileWrappedAt=null,wraps=0;const operationOrder=[];
    function update(value){stage=value;$('state').textContent=JSON.stringify({stage,fileWrap,downloadClickedAt,fileWrappedAt,wraps,operationOrder,revoked,urlCreatedAt,urlRevokedAt,bytes:source?.size||blob?.size||wrapped?.size||0,stats});for(const id of actions)$(id).disabled=true;const next={selected:'build',built:'readback',readback:'boundary',boundary:'share',shared:'url',url:'download',downloaded:'wrap',wrapped:'clear'}[value];if(next)$(next).disabled=false;}
    function wrap(){if(wrapped||wraps)throw Error('Control File is already wrapped.');wrapped=new File([blob],'blob-control.tflite',{type:blob.type});fileWrappedAt=performance.now();wraps++;operationOrder.push('file-wrap');update('wrapped');}
    $('choose').onclick=()=>$('file').click();$('file').onchange=()=>{if(source||worker)throw Error('Control source already selected.');source=$('file').files[0];update('selected');};
    $('build').onclick=()=>{worker=new Worker('/worker.js',{type:'module'});worker.onerror=()=>update('error');worker.onmessage=({data})=>{if(data.stage==='error'){update('error');return;}stats=data.stats;if(data.blob)blob=data.blob;update(data.stage);};worker.postMessage({action:'build',file:source});};
    $('readback').onclick=()=>worker.postMessage({action:'readback'});$('boundary').onclick=()=>worker.postMessage({action:'boundary'});$('share').onclick=()=>worker.postMessage({action:'share'});
    $('url').onclick=()=>{url=URL.createObjectURL(blob);const selected=url;urlCreatedAt=performance.now();setTimeout(()=>{URL.revokeObjectURL(selected);revoked=true;urlRevokedAt=performance.now();if(stage==='cleared')update('revoked');},60000);update('url');};
    $('download').onclick=async()=>{const link=document.createElement('a');link.href=url;link.download='blob-control.tflite';document.body.append(link);downloadClickedAt=performance.now();operationOrder.push('download-click');link.click();link.remove();if(fileWrap==='during-download'){await Promise.resolve();wrap();}else update('downloaded');};
    $('wrap').onclick=wrap;
    $('clear').onclick=()=>{worker.terminate();worker=null;source=null;blob=null;wrapped=null;url=null;$('file').value='';update(revoked?'revoked':'cleared');};update('initial');
}

export function blobControlSettings(env,platform){
    if(platform!=='linux'||env.GITHUB_ACTIONS!=='true'||env.GITHUB_REPOSITORY!=='koviankevin/tflite-explorer'||env.GITHUB_WORKFLOW!=='Physical File Blob control'||env.GITHUB_REF!=='refs/heads/main'||env.GITHUB_EVENT_NAME!=='workflow_dispatch'||!['firefox','webkit'].includes(env.DESKTOP_ENGINE))throw Error('Blob control is restricted to this repository on hosted manual main CI.');
    const fileWrap=env.BLOB_CONTROL_FILE_WRAP??'during-download';if(!['after-download','during-download'].includes(fileWrap))throw Error('Unknown File wrap timing.');
    return {engine:env.DESKTOP_ENGINE,fileWrap};
}
