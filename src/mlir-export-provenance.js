const opName=op=>op.name.getStringRef();

// Coordinates are operation positions within the exported function body, not
// viewer IDs (which can change when scaffolding is hidden). Nested bodies retain
// their region/block/operation positions relative to the copied parent.
export function mlirProvenance(index,{mode,operators,selected=new Set(),ranges=[],generated=[]}) {
    const unavailable=()=>({mode,ranges,error:'保留 OP 超過 50,000 個，模型仍可下載，但本次無法提供完整來源對照報告。'});
    if(operators.size>50000)return unavailable();
    const mappings=[],wanted=new Map(),stack=[];
    for(const [op,output] of [...operators].reverse())stack.push({op,output,role:selected.has(op)?'selected':mode==='function'?'retained':'required'});
    while(stack.length) {
        if(mappings.length>=50000)return unavailable();
        const {op,output,role}=stack.pop();
        const row=index.mlir.ir.byOp.get(op);
        const mapping={type:opName(op),source:{block:row?.block.name || '',operation:row?.position},output,role};
        mappings.push(mapping);wanted.set(op,mapping);
        const regions=op.regions || [];
        for(let r=regions.length-1;r>=0;r--)for(let b=(regions[r].blocks || []).length-1;b>=0;b--) {
            const children=regions[r].blocks[b].operations || [];
            if(mappings.length+stack.length+children.length>50000)return unavailable();
            for(let n=children.length-1;n>=0;n--)stack.push({op:children[n],output:{...output,nested:[...(output.nested || []),{region:r,block:b,operation:n}]},role});
        }
    }
    // A small slice of a huge model must not duplicate an all-model OP map.
    index.mlir.graphs.forEach((g,graph)=>g.operations.forEach((op,node)=>{const mapping=wanted.get(op);if(mapping)Object.assign(mapping.source,{graph,node});}));
    return {mode,coordinates:'exported-function-body',operators:mappings,generated,ranges};
}
