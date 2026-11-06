// Resolve display nodes back to original operators. Diagram-only headers,
// successor routes and block arguments never become captured operations.
export function layerLocation(entry,graph) {
    const node=entry.node;
    if(node.diagramKind!==undefined) {
        if(node.diagramKind!=='operator')return null;
        graph=node.sourceGraph;
    }
    const index=node.diagramKind==='operator'?node.sourceNode:entry.index;
    return Number.isInteger(graph) && graph>=0 && Number.isInteger(index) && index>=0?{graph,node:index}:null;
}

const selectionLimit = 32;

export function parseTfliteOpIds(text, operatorCount) {
    if (text.length > 4096) throw Error('OP ID 清單太長，請只貼上要選取的編號。');
    const tokens = text.split(/[\s,，、]+/).filter(Boolean);
    if (!tokens.length) throw Error('請至少輸入一個 OP ID，例如 10-13,16,18。');
    if (!Number.isSafeInteger(operatorCount) || operatorCount < 1) throw Error('目前子圖沒有可選取的 OP。');
    const ids = new Set();
    for (const token of tokens) {
        const match = /^#?([0-9]+)(?:-#?([0-9]+))?$/.exec(token);
        const label = token.slice(0, 40);
        if (!match) {
            throw Error(`「${label}」不是有效的 OP ID 或範圍。請使用整數或起點-終點，例如 10-13,16,18。`);
        }
        const first = Number(match[1]);
        const last = Number(match[2] ?? match[1]);
        if (![first, last].every(id => Number.isSafeInteger(id) && id < operatorCount)) {
            throw Error(`「${label}」不在目前子圖，OP ID 範圍是 #0 到 #${operatorCount - 1}。`);
        }
        if (first > last) throw Error(`範圍「${label}」寫反了，請將較小的 ID 放在前面。`);
        for (let id = first; id <= last; id++) {
            ids.add(id);
            if (ids.size > selectionLimit) throw Error(`加入「${label}」會超過上限，一組選取最多 ${selectionLimit} 個不同的 OP ID。`);
        }
    }
    return ids;
}

// Apply a multi-block selection atomically; a bulk add over the limit leaves
// every existing selection intact. Keep Set identities for block-local views.
export function updateLayerSelection(selections,locations,{toggle=false,limit=selectionLimit,scopeForGraph}={}) {
    const changes=new Map();let count=[...selections.values()].reduce((n,s)=>n+s.size,0);
    for(const location of locations) {
        if(!location || !Number.isInteger(location.graph) || location.graph<0 || !Number.isInteger(location.node) || location.node<0)throw new Error('選取的 layer 位置無效。');
        changes.set(`${location.graph}:${location.node}`,location);
    }
    const updates=[...changes.values()].map(location=>{
        const selected=selections.get(location.graph)?.has(location.node) || false,next=toggle?!selected:true;
        count+=Number(next)-Number(selected);return {...location,selected:next};
    });
    if(count>limit)return false;
    if(scopeForGraph) {
        const counts=new Map([...selections].map(([graph,nodes])=>[graph,nodes.size]));
        for(const update of updates)counts.set(update.graph,(counts.get(update.graph)||0)+Number(update.selected)-Number(selections.get(update.graph)?.has(update.node)||false));
        const scopes=new Set([...counts].filter(([,n])=>n>0).map(([graph])=>scopeForGraph(graph)));
        if(scopes.has(undefined) || scopes.size>1)throw new Error('選取必須位於同一個 function／region 或 TFLite subgraph；已保留原選取，請縮小選框或清除後重選。');
    }
    for(const {graph,node,selected} of updates) {
        if(!selections.has(graph))selections.set(graph,new Set());
        if(selected)selections.get(graph).add(node);else selections.get(graph).delete(node);
    }
    return true;
}

export function selectionRectangle(start,end,bounds) {
    const x=p=>Math.max(bounds.left,Math.min(bounds.right,p.x)),y=p=>Math.max(bounds.top,Math.min(bounds.bottom,p.y));
    return {left:Math.min(x(start),x(end)),right:Math.max(x(start),x(end)),top:Math.min(y(start),y(end)),bottom:Math.max(y(start),y(end))};
}

export function layersInRectangle(candidates,rectangle) {
    if(rectangle.right<=rectangle.left || rectangle.bottom<=rectangle.top)return [];
    return candidates.filter(({rect})=>rect.right>rectangle.left && rect.left<rectangle.right && rect.bottom>rectangle.top && rect.top<rectangle.bottom);
}
