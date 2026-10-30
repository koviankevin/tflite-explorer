// Count a streamed literal without retaining its values. Unknown encodings
// remain explicitly unchecked; a dialect verifier is still authoritative.
export function denseCounter(){
    let token='',count=0n,hexDigits=0n,quoted=false,hex=false,unknown=false,comment=false,slash=false,array=false;
    const flush=()=>{if(!token)return;if(/^(?:true|false|[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?|[+-]?0x[0-9a-fA-F]+)$/.test(token))count++;else unknown=true;token='';};
    const char=c=>{
        if(comment){if(c==='\n')comment=false;return;}
        if(quoted){if(c==='"'){quoted=false;hex=token==='0x';if(!hex)unknown=true;token='';}else if(token.length<2)token+=c;else if(/[0-9a-fA-F]/.test(c))hexDigits++;else unknown=true;return;}
        if(c==='/'&&slash){comment=true;slash=false;return;}if(slash){unknown=true;slash=false;}
        if(c==='/'){flush();slash=true;return;}
        if(c==='"'){flush();quoted=true;return;}
        if(c==='['){array=true;flush();return;}
        if(/[\s,\]\(\)]/.test(c)){flush();return;}
        if(token.length<256)token+=c;else unknown=true;
    };
    return {char,hex:n=>{hexDigits+=BigInt(n);},text(text){for(const part of text.matchAll(/[^\s,\[\]()"/]+|[\s,\[\]()"/]/g)){const s=part[0];if(s.length>1&&!quoted&&!comment&&!slash){if(token.length+s.length<=256)token+=s;else unknown=true;}else for(const c of s)char(c);}},finish(){flush();return {status:unknown||quoted||slash?'unchecked':'counted',count:String(count),hex,hexDigits:String(hexDigits),array};}};
}
export function checkDensePayloads(source,payloads){
    if(!payloads.some(p=>p.kind==='dense'))return {checked:0,unchecked:0,payloads:[]};
    const positions=new Map(Array.from(source.matchAll(/"0x01000000[0-9a-f]{40}"/g),m=>[m[0],m.index]));
    const rows=[];
    for(const p of payloads){
        if(p.kind!=='dense')continue;
        const at=positions.get(p.token);if(at===undefined)continue;
        const before=source.slice(Math.max(0,at-4096),at),after=source.slice(at+p.token.length,at+p.token.length+4096);
        const type=(/dense\s*<\s*((?:tensor|vector)\s*<[^<>]*>)\s*:\s*$/.exec(before)?.[1]||/^\s*>\s*:\s*((?:tensor|vector)\s*<[^<>]*>)/.exec(after)?.[1]||'').replace(/\s/g,'');
        const m=/^(?:tensor|vector)<((?:\d+x)*)([su]?i\d+|f16|f32|f64|bf16)>$/.exec(type),c=p.count;
        if(!m||!c||c.status!=='counted'){rows.push({status:'unchecked',reason:'未知型別／編碼，保留原文，需 dialect verifier。'});continue;}
        const dims=m[1]?m[1].slice(0,-1).split('x').map(BigInt):[],expected=dims.reduce((a,b)=>a*b,1n),width=Number(m[2]==='bf16'?16:m[2].replace(/^[sui f]+/,''));
        let matches,actual;
        if(c.hex){
            // Byte-aligned common scalar types only. Sub-byte/index/complex
            // serialization differs; do not guess their packing or splats.
            if(![8,16,32,64].includes(width)){rows.push({status:'unchecked',reason:'此 bitwidth 的 hex packing 尚未檢查。'});continue;}
            actual=BigInt(c.hexDigits)/2n;const size=BigInt(width/8);matches=BigInt(c.hexDigits)%2n===0n&&(actual===expected*size||expected>0n&&actual===size);
        }else{actual=BigInt(c.count);matches=actual===expected||!c.array&&actual===1n&&expected>0n;}
        if(!matches)throw Error(`MLIR dense 權重元素數／hex bytes 與 ${type} 不符（實際 ${actual}，預期 ${c.hex?expected*BigInt(width/8):expected}）。原檔未修改。`);
        rows.push({status:'passed',type,elements:String(expected),encoding:c.hex?'hex':'numeric'});
    }
    return {checked:rows.filter(r=>r.status==='passed').length,unchecked:rows.filter(r=>r.status==='unchecked').length,payloads:rows};
}
