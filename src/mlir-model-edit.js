import {typeSpelling} from './mlir-engine.js';
import {mlirArtifact} from './mlir-file.js';
import {validateMLIRText} from './mlir-validate.js';

// Atomic full-model edits against parser-recorded source coordinates. All
// untouched IR, custom dialect spelling and deferred weight slices survive.
// The returned artifact becomes a new model only after candidate validation.
export async function editMLIRModel(index,edits,{progress=()=>{}}={}) {
    if(!index?.mlir)throw Error('此模型不是 MLIR。');
    if(!Array.isArray(edits)||!edits.length||edits.length>128)throw Error('一次請套用 1～128 個模型修改。');
    const {source,graphs,ir,info,metadata,dialects,payloads}=index.mlir,patches=[];
    const operation=(graph,node)=>{
        if(!Number.isInteger(graph)||!Number.isInteger(node)||!graphs[graph]?.operations[node])throw Error('找不到要修改的原始 OP。');
        const op=graphs[graph].operations[node],range=info.operations.get(op);
        if(!range)throw Error('缺少 OP 原文位置。');return {op,range,row:ir.byOp.get(op)};
    };
    const value=location=>{
        // A transaction may wire an OP to a result inserted in the same batch.
        // Its definition, type and dominance are checked on the full candidate.
        if(typeof location?.name==='string'){
            if(!/^%[A-Za-z0-9_$.-]+(?:#[0-9]+)?$/.test(location.name))throw Error('SSA 名稱無效。');
            return {spelling:location.name};
        }
        if(!location||!Number.isInteger(location.graph)||!graphs[location.graph])throw Error('找不到 SSA 來源 block。');
        let actual;
        if(location.argument!==undefined){if(!Number.isInteger(location.argument))throw Error('SSA argument 編號無效。');actual=graphs[location.graph].block.arguments[location.argument];}
        else {if(!Number.isInteger(location.result)||location.result<0)throw Error('SSA result 編號無效。');actual=operation(location.graph,location.node).op.results[location.result];}
        const definition=ir.definitions.get(actual);if(!definition)throw Error('找不到 SSA 定義。');
        const spelling=definition.name+(definition.number||actual.owner?.results?.length>1?`#${definition.number}`:'');
        return {actual,definition,spelling};
    };
    const removedRanges=edits.filter(e=>e?.kind==='remove').map(e=>operation(e.graph,e.node).range);
    const replaceUse=(use,row,target,number)=>{
        if(target.definition&&ir.lookup(row.region,target.definition.key)!==target.definition)throw Error('SSA 來源不在此 OP 可見的 scope；不能用同名 SSA 值代替其他 function／region 的定義。');
        const previous=ir.definitions.get(use.value);
        if(previous&&target.definition&&typeSpelling(previous.type)!==typeSpelling(target.definition.type))throw Error('SSA 重接的型別不同；請先修改 OP 的完整型別簽章。');
        patches.push({start:use.range[0],end:use.range[1],text:target.spelling,edit:number});
    };
    let insertedCharacters=0;
    for(const [number,edit] of edits.entries()) {
        const {op,range,row}=operation(edit.graph,edit.node);
        if(edit.kind==='replace-value'){
            if(!Number.isInteger(edit.result)||edit.result<0||!op.results[edit.result])throw Error('找不到要重接的 SSA result。');
            const target=value(edit.value),original=op.results[edit.result];
            for(const consumer of ir.rows)for(const use of consumer.uses)if(use.value===original&&!removedRanges.some(([start,end])=>use.range[0]>=start&&use.range[1]<=end))replaceUse(use,consumer,target,number);
            continue;
        }
        if(edit.kind==='rewire') {
            if(!Number.isInteger(edit.operand)||edit.operand<0||!row?.uses[edit.operand])throw Error('找不到要重接的 SSA operand。');
            replaceUse(row.uses[edit.operand],row,value(edit.value),number);continue;
        }
        if(edit.kind==='remove'){patches.push({start:range[0],end:range[1],text:'',edit:number});continue;}
        if(!['replace','insert-before','insert-after'].includes(edit.kind)||typeof edit.text!=='string'||!edit.text.trim()||edit.text.length>1024*1024)throw Error('請提供有效的 OP 文字；每筆最多 1 MiB。');
        insertedCharacters+=edit.text.length;if(insertedCharacters>8*1024*1024)throw Error('單次新增結構文字超過 8 MiB，請分批套用。');
        if(edit.kind==='replace')patches.push({start:range[0],end:range[1],text:edit.text,edit:number});
        else {
            const indent=/^[\t ]*/.exec(source.slice(source.lastIndexOf('\n',range[0]-1)+1,range[0]))[0];
            const at=edit.kind==='insert-before'?range[0]:range[1];
            patches.push({start:at,end:at,text:edit.kind==='insert-before'?`${edit.text}\n${indent}`:`\n${indent}${edit.text}\n${indent}`,edit:number});
        }
    }
    patches.sort((a,b)=>a.start-b.start||a.end-b.end);
    const parts=[];let cursor=0;
    for(const patch of patches){
        if(patch.start<cursor)throw Error('修改的 OP／SSA 範圍重疊；請合併為同一筆替換，或分次套用。');
        parts.push(source.slice(cursor,patch.start),patch.text);cursor=patch.end;
    }
    parts.push(source.slice(cursor));const text=parts.join('');
    progress('檢查修改後整個 MLIR 的語法、SSA、型別與 dominance…');
    const validation=await validateMLIRText(text,{metadata,dialects,payloads});
    const artifact=mlirArtifact(text,payloads);
    return {...artifact,validation,changes:edits.length,format:'mlir',verification:'structure-only'};
}
