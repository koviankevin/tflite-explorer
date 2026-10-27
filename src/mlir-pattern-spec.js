import {operatorKey} from './pattern-utils.js?v=0f8361cc44fcd547';
import {normalizeConditions} from './pattern-conditions.js?v=0f8361cc44fcd547';
export const CFG_PATTERN_MODE='mlir-cfg';
const kinds=new Set(['operator','block','argument']);
const edgeKinds=new Set(['contains','ssa','argument','control']);
export const edgeKey=edge=>`${edge.kind}:${edge.port || ''}`;
export const nodeKey=node=>node.kind==='operator' ? `op:${operatorKey(node.type)}` : node.kind==='block' ? `block:${node.arity}` : `arg:${node.slot}`;

// Portable, strict topology schema. No source labels, SSA names or model data.
export function prepareMLIRPattern(structure) {
    if(structure?.mode!==CFG_PATTERN_MODE || !Array.isArray(structure.nodes) || !Array.isArray(structure.edges))throw new Error('缺少跨 block pattern 結構。');
    if(!structure.nodes.length || structure.nodes.length>256 || structure.edges.length>512)throw new Error('跨 block pattern 最多 256 個結構節點、512 條連線。');
    const aliases=new Map();
    const integer=n=>Number.isSafeInteger(n) && n>=0 && n<65536;
    const nodes=structure.nodes.map(n=>{
        if(!n || typeof n.alias!=='string' || n.alias.length>80 || !/^[A-Za-z_][A-Za-z0-9_]*$/.test(n.alias) || aliases.has(n.alias) || !kinds.has(n.kind))throw new Error('跨 block pattern 節點無效或編號重複。');
        let node={alias:n.alias,kind:n.kind,type:n.kind};
        if(n.kind==='operator') {
            if(typeof n.type!=='string' || !n.type.includes('.') || n.type.length>256 || !integer(n.order))throw new Error('跨 block operator 類型或順序無效。');
            const conditions=normalizeConditions(n.conditions);
            node={...node,type:n.type,order:n.order,...(conditions.length?{conditions}:{})};
        } else if(n.kind==='block') {
            if(n.conditions!==undefined)throw new Error('條件只能指定在 operator。');
            if(!integer(n.arity))throw new Error('Block arguments 數量無效。');
            node.arity=n.arity;
        } else {if(n.conditions!==undefined)throw new Error('條件只能指定在 operator。');if(!integer(n.slot))throw new Error('Block argument 編號無效。');node.slot=n.slot;}
        aliases.set(node.alias,node);return node;
    });
    if(!nodes.some(n=>n.kind==='operator') || nodes.filter(n=>n.kind==='operator').length>32 || !nodes.some(n=>n.kind==='block') || nodes.filter(n=>n.kind==='block').length>32)throw new Error('跨 block pattern 需包含 1～32 個 operators、1～32 個 blocks。');
    const seen=new Set(),parents=new Map(),edges=[];
    for(const e of structure.edges) {
        const a=aliases.get(e?.from),b=aliases.get(e?.to);
        if(!a || !b || !edgeKinds.has(e.kind) || (e.port!==undefined && (typeof e.port!=='string' || !/^\d+(?::\d+)?$/.test(e.port) || e.port.length>20)))throw new Error('跨 block pattern 連線無效。');
        const valid=e.kind==='contains' ? a.kind==='block' && b.kind!=='block' && !e.port
            : e.kind==='control' ? a.kind==='block' && b.kind==='block' && /^\d+$/.test(e.port || '')
            : e.kind==='ssa' ? a.kind!=='block' && b.kind==='operator' && /^\d+:\d+$/.test(e.port || '')
            : a.kind!=='block' && b.kind==='argument' && /^\d+:\d+$/.test(e.port || '');
        if(!valid)throw new Error('連線種類與節點／port 不一致。');
        const edge={from:e.from,to:e.to,kind:e.kind,...(e.port ? {port:e.port} : {})},key=JSON.stringify(edge);
        if(seen.has(key))continue;seen.add(key);edges.push(edge);
        if(e.kind==='contains') {if(parents.has(e.to))throw new Error('每個 operator／argument 只能屬於一個 block。');parents.set(e.to,e.from);}
    }
    const slots=new Set(),orders=new Set();
    for(const n of nodes)if(n.kind!=='block') {
        const parent=aliases.get(parents.get(n.alias));
        if(!parent)throw new Error('Operator／argument 缺少所屬 block。');
        const key=`${parent.alias}:${n.kind}:${n.kind==='argument' ? n.slot : n.order}`,set=n.kind==='argument' ? slots : orders;
        if(set.has(key) || (n.kind==='argument' && n.slot>=parent.arity))throw new Error('Block argument 或 operator 順序重複／超出範圍。');set.add(key);
    }
    for(const n of nodes.filter(n=>n.kind==='block')) {
        if(nodes.filter(a=>a.kind==='argument' && parents.get(a.alias)===n.alias).length!==n.arity)throw new Error('Pattern 必須包含每個選取 block 的全部 arguments。');
        if(!nodes.some(a=>a.kind==='operator' && parents.get(a.alias)===n.alias))throw new Error('每個 pattern block 至少需要選取一個 operator。');
    }
    const incoming=new Map(nodes.map(n=>[n.alias,[]])),outgoing=new Map(nodes.map(n=>[n.alias,[]]));
    for(const edge of edges){incoming.get(edge.to).push(edge);outgoing.get(edge.from).push(edge);}
    const reached=new Set(),stack=[nodes[0].alias];
    while(stack.length){const n=stack.pop();if(reached.has(n))continue;reached.add(n);stack.push(...incoming.get(n).map(e=>e.from),...outgoing.get(n).map(e=>e.to));}
    if(reached.size!==nodes.length)throw new Error('選取的 blocks／operators 必須透過 SSA 或控制流程連成同一組 pattern。');
    return {mode:CFG_PATTERN_MODE,nodes,edges,induced:Boolean(structure.induced),incoming,outgoing,parents};
}
