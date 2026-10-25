// A File-backed structural view. Large dense literals/resource blobs never
// become a single JavaScript string or an array of decoded weight values.
export const MLIR_STRUCTURE_LIMIT = 256 * 1024 * 1024;
export const MLIR_PAYLOAD_THRESHOLD = 4 * 1024;
const tokenPattern = /"0x01000000[0-9a-f]{32}[0-9a-f]{8}"/g;
const structureError = () => new Error('MLIR 結構文字超過 256 MiB（不含延後讀取的 dense／resource 權重）；請拆分 function 或移除大型非權重屬性。');
const whitespace = c => c===32 || c===9 || c===10 || c===13;
const wordChar = c => c>=65 && c<=90 || c>=97 && c<=122 || c>=48 && c<=57 || [95,46,36,37,64,35,33].includes(c);

function typedHeader(bytes) {
    const text=new TextDecoder().decode(Uint8Array.from(bytes));
    if(!/^(?:\s|\/\/[^\n]*\n)*(tensor|vector)\s*</.test(text))return 0;
    let depth=0,quoted=false,escaped=false,comment=false;
    for(let i=0;i<text.length;i++) {
        if(comment){if(text[i]==='\n')comment=false;continue;}
        if(quoted){if(escaped)escaped=false;else if(text[i]==='\\')escaped=true;else if(text[i]==='"')quoted=false;continue;}
        if(text[i]==='/' && text[i+1]==='/'){comment=true;continue;}
        if(text[i]==='"')quoted=true;
        else if(text[i]==='<')depth++;
        else if(text[i]==='>' && text[i-1]!=='-')depth--;
        else if(text[i]===':' && depth===0)return new TextEncoder().encode(text.slice(0,i+1)).length;
    }
    throw new Error('大型 typed dense 屬性的型別標頭過長，無法安全延後讀取。');
}

export async function readMLIRFile(file,{progress=()=>{},chunkSize=1024*1024,structureLimit=MLIR_STRUCTURE_LIMIT,payloadThreshold=MLIR_PAYLOAD_THRESHOLD}={}) {
    const captureLimit=Math.max(payloadThreshold,64*1024);
    const pieces=[],payloads=[],nonce=crypto.randomUUID().replaceAll('-','');
    const utf8=new TextDecoder('utf-8',{fatal:true}),decoder=new TextDecoder('utf-8',{fatal:true});
    let retained=0,mode='code',word='',pending=false,previous=0,significant=0,tail='',resource=false,escape=false,candidate=null;
    let originalLine=1,originalColumn=1,compactLine=1,compactColumn=1;
    const emit=bytes=>{
        retained+=bytes.length;if(retained>structureLimit)throw structureError();
        const text=decoder.decode(bytes,{stream:true});pieces.push(text);
        let at=0,next;while((next=text.indexOf('\n',at))!==-1){compactLine++;compactColumn=1;at=next+1;}compactColumn+=text.length-at;
    };
    const begin=(kind,at)=>{candidate={kind,start:at,prefix:[],depth:1,state:'code',escape:false,previous:0,brackets:[],hex:true};mode='payload';};
    const finish=(end,endLine,endColumn)=>{
        const item=candidate,length=end-item.start;
        if(length<=payloadThreshold)emit(Uint8Array.from(item.prefix));
        else {
            if(item.kind==='resource' && (!item.hex || item.prefix[1]!==48 || item.prefix[2]!==120 || (length-4)%2))throw new Error('大型 resource 權重必須是完整且偶數長度的 "0x…" 十六進位字串。');
            if(payloads.length>=100000)throw new Error('MLIR 大型權重區段超過 100,000 個，請拆分模型。');
            const header=item.kind==='dense'?typedHeader(item.prefix):0;
            if(header)emit(Uint8Array.from(item.prefix.slice(0,header)));
            const token=`"0x01000000${nonce}${payloads.length.toString(16).padStart(8,'0')}"`;
            emit(new TextEncoder().encode(token));
            payloads.push({token,file,start:item.start+header,end,bytes:length-header,kind:item.kind,compactLine,compactColumn,originalLine:endLine,originalColumn:endColumn});
        }
        candidate=null;mode='code';word='';pending=false;previous=0;
    };
    for(let offset=0;offset<file.size;offset+=chunkSize) {
        const bytes=new Uint8Array(await file.slice(offset,Math.min(file.size,offset+chunkSize)).arrayBuffer());
        if(offset===0 && bytes[0]===0x4d && bytes[1]===0x4c && bytes[2]===0xef && bytes[3]===0x52)throw new Error('目前支援文字 .mlir，尚不支援 MLIR bytecode。');
        const chunkText=utf8.decode(bytes,{stream:true}); // Validate deferred bytes too.
        const ascii=chunkText.length===bytes.length && !/[^\x00-\x7f]/.test(chunkText),special=/[<>"/\[\]()]/g;
        let start=mode==='payload'?bytes.length:0;
        for(let i=0;i<bytes.length;i++) {
            const c=bytes[i],at=offset+i;
            // Native scanning keeps multi-GB hex weights out of a per-byte JS
            // loop. Fall back for delimiters/escapes and malformed data.
            if(candidate?.prefix.length>captureLimit && (candidate.kind==='resource' && candidate.hex || candidate.kind==='dense' && candidate.state==='string' && candidate.stringPrefix==='0x' && candidate.stringHex)) {
                let end=bytes.indexOf(34,i);if(end===-1)end=bytes.length;
                if(end>i && !/[^0-9a-fA-F]/.test(ascii?chunkText.slice(i,end):new TextDecoder().decode(bytes.subarray(i,end)))) {
                    const count=end-i;originalColumn+=count;
                    if(candidate.kind==='dense')candidate.stringCount+=count;
                    i=end-1;continue;
                }
            }
            if(ascii && candidate?.kind==='dense' && candidate.state==='code' && candidate.prefix.length>captureLimit) {
                special.lastIndex=i;const match=special.exec(chunkText),end=match?.index ?? bytes.length;
                if(end>i) {
                    let at=i,next;while((next=chunkText.indexOf('\n',at))!==-1 && next<end){originalLine++;originalColumn=1;at=next+1;}
                    originalColumn+=end-at;candidate.previous=bytes[end-1];i=end-1;continue;
                }
            }
            const line=originalLine,column=originalColumn;
            if(c===10){originalLine++;originalColumn=1;}else if(c<128 || c>=192)originalColumn+=c>=240?2:1;
            if(mode==='payload') {
                const item=candidate;
                if(item.kind==='resource') {
                    if(c===34 && !item.escape) {if(item.prefix.length<=captureLimit)item.prefix.push(c);finish(at+1,originalLine,originalColumn);start=i+1;continue;}
                    if(at>item.start+2 && !(c>=48 && c<=57 || c>=65 && c<=70 || c>=97 && c<=102))item.hex=false;
                    if(item.escape)item.escape=false;else if(c===92)item.escape=true;
                } else if(item.state==='comment') {
                    if(c===10)item.state='code';
                } else if(item.state==='string') {
                    if(item.escape)item.escape=false;
                    else if(c===92){item.escape=true;item.stringHex=false;}
                    else if(c===34) {
                        if(at-item.stringStart>payloadThreshold && item.stringPrefix==='0x' && (!item.stringHex || item.stringCount%2))throw new Error('大型 dense 權重的十六進位字串無效或長度不是偶數。');
                        item.state='code';
                    } else {
                        if(item.stringPrefix.length<2)item.stringPrefix+=String.fromCharCode(c);
                        else {item.stringCount++;if(!(c>=48 && c<=57 || c>=65 && c<=70 || c>=97 && c<=102))item.stringHex=false;}
                    }
                } else {
                    if(c===34){item.state='string';item.stringStart=at;item.stringPrefix='';item.stringCount=0;item.stringHex=true;}
                    else if(c===47 && item.previous===47)item.state='comment';
                    else if(c===60)item.depth++;
                    else if(c===62 && item.previous!==45 && --item.depth===0) {
                        if(item.brackets.length)throw new Error('MLIR dense 權重的括號未閉合。');
                        finish(at,line,column);start=i;previous=c;continue;
                    } else if(c===91 || c===40) {item.brackets.push(c);if(item.brackets.length>4096)throw new Error('MLIR dense 權重的巢狀深度超過 4096，已停止讀取。');}
                    else if(c===93 || c===41) {if(item.brackets.pop()!==(c===93?91:40))throw new Error('MLIR dense 權重的括號不成對。');}
                }
                item.previous=c;
                if(item.prefix.length<=captureLimit)item.prefix.push(c);
                continue;
            }
            if(mode==='comment'){if(c===10)mode='code';previous=c;continue;}
            if(mode==='string'){if(escape)escape=false;else if(c===92)escape=true;else if(c===34)mode='code';previous=c;continue;}
            if(c===47 && previous===47){mode='comment';pending=false;word='';previous=c;continue;}
            if(!whitespace(c)) {
                tail=(tail+String.fromCharCode(c)).slice(-3);
                if(tail==='{-#')resource=true;
                if(tail==='#-}')resource=false;
            }
            if(wordChar(c)){word=word.length<16?word+String.fromCharCode(c):'!';previous=c;continue;}
            if(word){pending=word==='dense';word='';}
            if(c===60 && pending) {
                emit(bytes.subarray(start,i+1));begin('dense',at+1);start=bytes.length;previous=c;continue;
            }
            if(c===34) {
                if(resource && significant===58) {
                    emit(bytes.subarray(start,i));begin('resource',at);candidate.prefix.push(c);start=bytes.length;
                } else {mode='string';escape=false;}
                pending=false;
            } else if(!whitespace(c)) {
                pending=false;
                significant=c;
            }
            previous=c;
        }
        if(mode!=='payload')emit(bytes.subarray(start));
        if(offset===0 || offset+chunkSize>=file.size || offset%(32*1024*1024)===0)progress(`分段讀取 MLIR：${Math.min(100,Math.floor((offset+bytes.length)/file.size*100))}% · 大型權重留在本機檔案`);
    }
    utf8.decode();
    if(candidate)throw new Error('MLIR dense／resource 權重未閉合，已停止讀取。');
    pieces.push(decoder.decode());
    const source=pieces.join('');
    return {source,payloads,stats:{bytesRead:file.size,fileBytes:file.size,structureBytes:retained,deferredBytes:payloads.reduce((n,p)=>n+p.bytes,0),deferredPayloads:payloads.length}};
}

// Map diagnostics after elided literals back to the selected file. Exported
// structural strings deliberately do not reuse the original file's locations.
export function mlirLocation(locations,line,column) {
    if(!locations?.length)return {line,column};
    let lo=0,hi=locations.length;
    while(lo<hi){const mid=(lo+hi)>>>1,p=locations[mid];if(p.compactLine<line || p.compactLine===line && p.compactColumn<=column)lo=mid+1;else hi=mid;}
    const p=locations[lo-1];
    return p?{line:line+p.originalLine-p.compactLine,column:column+(line===p.compactLine?p.originalColumn-p.compactColumn:0)}:{line,column};
}

export function deferredAttribute(raw,payloads=[]) {
    const byToken=payloads instanceof Map?payloads:new Map(payloads.map(p=>[p.token,p]));
    return raw.replace(tokenPattern,token=>{const p=byToken.get(token);return p?`…（屬性預覽已截短；${p.bytes.toLocaleString('en-US')} bytes 權重留在原始檔案；匯出保留完整原文）`:token;});
}

// Adapter hooks must never mistake the parser's temporary bytes for weights.
export function prepareDeferredAttributes(root,info,source,payloads) {
    if(!payloads.length)return;
    const tokens=new Set(payloads.map(p=>p.token)),positions=[...source.matchAll(tokenPattern)].filter(m=>tokens.has(m[0])).map(m=>m.index);
    const resources=new Set(payloads.filter(p=>p.kind==='resource').map(p=>p.token.slice(11,-1)));
    const dense=new Set(payloads.filter(p=>p.kind==='dense').map(p=>p.token.slice(3,-1)));
    const stack=[...(root.operations || [])];
    while(stack.length) {
        const op=stack.pop();
        for(const [,attr] of op.getAttrDictionary()) {
            if(attr.modelLensDeferred)continue;
            const span=info.attributes.get(attr);let lo=0,hi=positions.length;
            if(span)while(lo<hi){const mid=(lo+hi)>>>1;if(positions[mid]<span[0])lo=mid+1;else hi=mid;}
            const blob=attr.rawHandle?.blob,resource=blob?.length===20 && resources.has(Array.from(blob,b=>b.toString(16).padStart(2,'0')).join(''));
            // A reused #attribute alias can replace the parser's recorded
            // source range. Recognize its temporary value as well.
            const value=attr.value,scalar=Array.isArray(value) && value.length===1?value[0]?.value:null;
            const alias=value instanceof Uint8Array && value.length===24 && dense.has(Array.from(value,b=>b.toString(16).padStart(2,'0')).join('')) || typeof scalar==='string' && scalar.startsWith('0x') && dense.has(scalar.slice(2));
            if(resource || alias || span && positions[lo]<span[1]) {
                attr.modelLensDeferred=true;
                Object.defineProperty(attr,'value',{value:null,writable:true,configurable:true});
                if(resource)attr.rawHandle.blob=null;
            }
        }
        for(const region of op.regions || [])for(const block of region.blocks || [])for(const child of block.operations)stack.push(child);
    }
}

export function mlirBlob(text,payloads=[]) {
    const byToken=new Map(payloads.map(p=>[p.token,p])),parts=[];let start=0;
    for(const match of text.matchAll(tokenPattern)) {
        const payload=byToken.get(match[0]);if(!payload)continue;
        parts.push(text.slice(start,match.index),payload.file.slice(payload.start,payload.end));start=match.index+match[0].length;
    }
    parts.push(text.slice(start));
    return new Blob(parts,{type:'text/plain;charset=utf-8'});
}
