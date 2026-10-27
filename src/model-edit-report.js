import {createExportReport} from './export-report.js';

// Bounded metadata only. Native verification/CLI use the same byte-range schema
// as submodel exports; an edited model never claims numerical equivalence.
export function createModelEditReport(index,file,result,candidate,args,{outputName,buildId}={}){
    if(!Array.isArray(result.ranges)||result.ranges.length>100000)throw Error('模型修改的 byte ranges 無效或過多，無法提供完整報告。');
    let values=0,characters=0;
    const text=value=>{const s=String(value??'');characters+=s.length;if(s.length>4096||characters>1024*1024)throw Error('模型介面文字過多，無法提供完整修改報告。');return s;};
    const vector=array=>{values+=array?.length||0;if(values>262144)throw Error('模型介面 metadata 過多，無法提供完整修改報告。');return Array.from(array||[],n=>typeof n==='bigint'?String(n):n);};
    const interfaces=(model,side)=>{
        const rows=[];
        for(const [graph,g] of model.graphs.entries())for(const arg of g.graph[side])for(const value of arg.value||[]){
            if(rows.length>=16384)throw Error('模型介面超過 16,384 個值，無法提供完整修改報告。');
            const q=model.raw?.subgraphs[graph]?.tensors[Number(value.identifier)]?.quantization;
            rows.push({graph,id:text(value.identifier),name:text(value.name),dtype:text(value.type?.dataType),shape:vector(value.type?.shape?.dimensions),...(q?{quantization:{min:vector(q.min),max:vector(q.max),scale:vector(q.scale),zeroPoint:vector(q.zero_point).map(String),dimension:q.quantized_dimension}}:{})});
        }return rows;
    };
    const before={inputs:interfaces(index,'inputs'),outputs:interfaces(index,'outputs')},inputs=interfaces(candidate,'inputs'),outputs=interfaces(candidate,'outputs');
    const total=model=>model.graphs.reduce((n,g)=>n+g.graph.nodes.length,0),sourceNode=index.graphs[args.graph]?.graph.nodes[args.node];
    if(!sourceNode)throw Error('模型修改的來源 OP 不存在。');
    const outputNode=args.mode==='remove'||args.advanced||index.mlir?.graphs[args.graph]?.operations[args.node]?.regions?.length?null:args.node+(args.mode==='add-after'?1:0);
    const target=outputNode===null?null:{graph:args.graph,node:outputNode,type:text(candidate.graphs[args.graph]?.graph.nodes[outputNode]?.type?.name)};
    const modification={action:args.mode,source:{graph:args.graph,node:args.node,type:text(sourceNode.type.name)},output:target,
        before:{layers:total(index),scopes:index.graphs.length,interface:before},after:{layers:total(candidate),scopes:candidate.graphs.length},
        parameterNames:[...Object.keys(args.options||{}),...Object.keys(args.options2||{})],fullIR:!!args.advanced,
        mappingScope:'只列修改目標；完整 IR 或 region 修改不推測一對一 OP 對照。未提供其他 OP 的逐筆位置映射。',interfaceScope:'各顯示 block／subgraph 的介面；不等同於所有 MLIR function 的 ABI。'};
    const provenance={mode:'model-edit',ranges:result.ranges,operators:target?[{source:{graph:args.graph,node:args.node},output:{graph:target.graph,node:target.node},role:args.mode==='replace'?'modified':'cloned'}]:[],generated:[]};
    return createExportReport(index,file,{...result,provenance,modification,inputs,outputs,layers:total(candidate),tensors:candidate.graphs.reduce((n,g)=>n+g.tensors.size,0),preservedIds:!index.mlir,retainedBuffers:candidate.raw?.buffers.length},{graph:args.graph,nodes:[args.node],outputName,buildId});
}
