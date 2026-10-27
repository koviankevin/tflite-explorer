// Edits a query, never an MLIR model. Invalid intermediate topology is allowed;
// prepareMLIRPattern remains the authority before saving or searching.
export function editMLIRPattern(pattern,action) {
    const draft=structuredClone(pattern),{nodes,edges}=draft;
    const node=alias=>{const found=nodes.find(n=>n.alias===alias);if(!found)throw Error('找不到 pattern 節點。');return found;};
    const block=alias=>{const found=node(alias);if(found.kind!=='block')throw Error('請選擇 block。');return found;};
    const parent=alias=>edges.find(e=>e.kind==='contains'&&e.to===alias)?.from;
    const children=(alias,kind)=>nodes.filter(n=>n.kind===kind&&parent(n.alias)===alias).sort((a,b)=>(a.order??a.slot)-(b.order??b.slot));
    const alias=()=>{for(let i=1;i<=258;i++)if(!nodes.some(n=>n.alias===`N${i}`))return `N${i}`;throw Error('Pattern 節點已達上限。');};
    const attach=(child,owner)=>{nodes.push(child);edges.push({from:owner,to:child.alias,kind:'contains'});return child;};
    const addOperator=owner=>{const list=children(owner,'operator');list.forEach((n,i)=>{n.order=i;});return attach({alias:alias(),kind:'operator',type:action.type??nodes.find(n=>n.kind==='operator')?.type??'company.op',order:list.length},owner);};
    const reindex=owner=>{
        children(owner,'operator').forEach((n,i)=>{n.order=i;});
        children(owner,'argument').forEach((n,i)=>{n.slot=i;});
        const ownerNode=nodes.find(n=>n.alias===owner);if(ownerNode)ownerNode.arity=children(owner,'argument').length;
    };
    switch(action.kind) {
        case 'add-block': {const created={alias:alias(),kind:'block',type:'block',arity:0};nodes.push(created);addOperator(created.alias);break;}
        case 'add-operator': {const owner=block(action.block).alias;addOperator(owner);break;}
        case 'add-argument': {const owner=block(action.block),slot=owner.arity;attach({alias:alias(),kind:'argument',type:'argument',slot},owner.alias);owner.arity++;break;}
        case 'remove-node': {
            const target=node(action.alias),owner=parent(target.alias),removed=new Set([target.alias]);
            if(target.kind==='block')for(const e of edges)if(e.kind==='contains'&&e.from===target.alias)removed.add(e.to);
            draft.nodes=nodes.filter(n=>!removed.has(n.alias));draft.edges=edges.filter(e=>!removed.has(e.from)&&!removed.has(e.to));
            // Renumber surviving arguments without replacing their aliases or
            // routing edges. OP order gaps are valid relative-order queries.
            if(target.kind==='argument') {
                const args=draft.nodes.filter(n=>n.kind==='argument'&&draft.edges.some(e=>e.kind==='contains'&&e.from===owner&&e.to===n.alias)).sort((a,b)=>a.slot-b.slot);
                args.forEach((n,i)=>{n.slot=i;});draft.nodes.find(n=>n.alias===owner).arity=args.length;
            }
            break;
        }
        case 'set-operator': {
            const target=node(action.alias);if(target.kind!=='operator')throw Error('請選擇 operator。');
            if(action.type!==undefined)target.type=action.type;
            if(action.block!==undefined&&parent(target.alias)!==action.block) {
                block(action.block);const old=parent(target.alias),membership=edges.find(e=>e.kind==='contains'&&e.to===target.alias);
                target.order=Math.max(-1,...children(action.block,'operator').map(n=>n.order))+1;membership.from=action.block;reindex(old);reindex(action.block);
            }
            break;
        }
        case 'move-operator': {
            const target=node(action.alias);if(target.kind!=='operator'||![1,-1].includes(action.delta))throw Error('Operator 順序無效。');
            const list=children(parent(target.alias),'operator'),position=list.indexOf(target),next=position+action.delta;
            if(next>=0&&next<list.length){[list[position],list[next]]=[list[next],list[position]];list.forEach((n,i)=>{n.order=i;});}break;
        }
        case 'add-edge': {
            const from=nodes.find(n=>n.kind!=='block'),to=nodes.find(n=>n.kind==='operator');
            if(!from||!to)throw Error('請先加入 operator。');edges.push({from:from.alias,to:to.alias,kind:'ssa',port:'0:0'});break;
        }
        case 'set-edge': {
            const target=edges[action.index];if(!target||target.kind==='contains')throw Error('找不到可編輯的連線。');
            const next={...target,...action.edge};
            if(!['ssa','argument','control'].includes(next.kind))throw Error('連線種類無效。');
            node(next.from);node(next.to);Object.assign(target,next);break;
        }
        case 'remove-edge': if(!edges[action.index]||edges[action.index].kind==='contains')throw Error('找不到可編輯的連線。');else edges.splice(action.index,1);break;
        case 'set-induced': draft.induced=Boolean(action.value);break;
        default: throw Error('不支援的 pattern 編輯操作。');
    }
    if(draft.nodes.length>256||draft.edges.length>512||draft.nodes.filter(n=>n.kind==='operator').length>32||draft.nodes.filter(n=>n.kind==='block').length>32)throw Error('Pattern 最多 32 個 operators、32 個 blocks、256 個結構節點及 512 條連線；已保留原草稿。');
    return draft;
}
