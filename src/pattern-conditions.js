// Conditions inspect metadata only. Never read tensor initializers or weights.
export function normalizeConditions(rules) {
    if(rules===undefined)return [];
    if(!Array.isArray(rules) || rules.length>16)throw new Error('每個 OP 最多 16 個條件。');
    return rules.map(rule=>{
        if(!rule || !['shape','dtype','attribute'].includes(rule.kind))throw new Error('未知的 pattern 條件。');
        if(rule.kind==='attribute') {
            if(typeof rule.name!=='string' || !rule.name.trim() || rule.name.length>256 || typeof rule.value!=='string' || rule.value.length>2048)throw new Error('Attribute 名稱／值無效（值最多 2048 字元）。');
            return {kind:'attribute',name:rule.name.trim(),value:rule.value.trim()};
        }
        if(!['input','output'].includes(rule.side) || !Number.isInteger(rule.port) || rule.port<0 || rule.port>65535)throw new Error('Tensor 條件需指定輸入／輸出及從 0 起算的 port。');
        const base={kind:rule.kind,side:rule.side,port:rule.port};
        if(rule.kind==='dtype') {
            if(typeof rule.value!=='string' || !rule.value.trim() || rule.value.length>256)throw new Error('請輸入有效的 dtype。');
            return {...base,value:rule.value.trim().toLowerCase()};
        }
        if(!Array.isArray(rule.value) || rule.value.length>32 || rule.value.some(d=>d!==null && d!=='?' && (!Number.isSafeInteger(d) || d<0)))throw new Error('Shape 使用非負整數、*（任意維度）或 ?（動態維度）；[] 代表 scalar。');
        return {...base,value:[...rule.value]};
    });
}
export function parseShape(text) {
    const body=text.trim().replace(/^\[(.*)\]$/,'$1').trim();
    const value=body===''?[]:body.split(',').map(s=>{s=s.trim();if(s==='*')return null;if(s==='?' || s==='-1')return '?';if(!/^\d+$/.test(s))throw new Error('Shape 請以逗號分隔，例如 1, *, 128。');return Number(s);});
    return normalizeConditions([{kind:'shape',side:'output',port:0,value}])[0].value;
}
export const shapeText=value=>'['+value.map(d=>d===null?'*':String(d)).join(', ')+']';
export function attributeText(value) {
    if(value===null || ['string','number','boolean','bigint'].includes(typeof value))return String(value).trim();
    if((Array.isArray(value) || ArrayBuffer.isView(value)) && value.length<=512 && Array.from(value).every(v=>v===null || ['string','number','boolean','bigint'].includes(typeof v)))return '['+Array.from(value,String).join(', ')+']';
    return null;
}
export function matchesConditions(node,rules=[]) {
    return rules.every(rule=>{
        if(rule.kind==='attribute') {
            const attribute=node.attributes?.find(a=>a.name===rule.name),text=attribute?attributeText(attribute.value):null;
            return text!==null && text.length<=2048 && !text.includes('屬性預覽已截短') && text===rule.value;
        }
        // Ports count tensor values, across all named argument groups.
        const value=(rule.side==='input'?node.inputs:node.outputs)?.flatMap(a=>Array.isArray(a.value)?a.value:[])[rule.port];
        if(!value?.type)return false;
        if(rule.kind==='dtype')return typeof value.type.dataType==='string' && value.type.dataType.trim().toLowerCase()===rule.value;
        if(/^(tensor|memref)<\*x/.test(value.type.spelling || ''))return false;
        const dimensions=value.type.shape?.dimensions;
        return Array.isArray(dimensions) && dimensions.length===rule.value.length && rule.value.every((d,i)=>d===null || (d==='?' ? dimensions[i]==='?' || dimensions[i]===-1 : String(d)===String(dimensions[i])));
    });
}
// One cache per query: repeated frontier checks reuse metadata comparisons.
export function conditionMatcher() {
    const cache=new WeakMap();
    return (node,spec)=>{
        if(!spec.conditions?.length)return true;
        let results=cache.get(node);if(!results){results=new Map();cache.set(node,results);}
        if(!results.has(spec))results.set(spec,matchesConditions(node,spec.conditions));
        return results.get(spec);
    };
}
