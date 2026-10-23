import { parseMLIR, typeSpelling } from './mlir-engine.js?v=6e7883d91ddec2ad';
import { opName as nameOf, ssaKey as keyOf, buildDominance } from './mlir-ir.js?v=6e7883d91ddec2ad';
import { operationSemantics } from './mlir-dialects.js?v=6e7883d91ddec2ad';

export const MLIR_VALIDATION_SCOPE = '本機語法／SSA／dominance 檢查；不含 dialect 自訂語意與完整 LLVM verifier';
const refOf = (name,number=0) => number ? `${name}#${number}` : name;
const sameType = (a,b) => Boolean(a && b) && typeSpelling(a)===typeSpelling(b);
export class MLIRValidationError extends Error {
    constructor(diagnostics,stage='來源模型') {
        super(`${stage}的 MLIR 語法／SSA 檢查未通過，已停止匯出。`);
        this.name='MLIRValidationError';
        this.validation={ stage, scope:MLIR_VALIDATION_SCOPE, diagnostics:diagnostics.slice(0,20), total:diagnostics.length };
    }
}

// An independent structural pass over parser-recorded declarations and uses.
// Never infer a declaration from a parser placeholder or its mutated value.type.
export function validateMLIR(index,{graphIndex}={}) {
    const data=index.mlir;
    if (!data?.root || !data.info.definitions) throw new MLIRValidationError([{code:'VALIDATION_UNAVAILABLE',message:'缺少原始 SSA 定義，無法完整檢查。'}]);
    if (!data.validationCache) data.validationCache=new Map();
    const key=graphIndex===undefined ? 'all' : `context:${data.ir.byBlock.get(data.graphs[graphIndex]?.block)?.owner?.context || 0}`;
    if(!data.validationCache.has(key)) data.validationCache.set(key,inspect(data,graphIndex===undefined ? undefined : data.graphs[graphIndex]?.block));
    return {scope:MLIR_VALIDATION_SCOPE,diagnostics:data.validationCache.get(key)};
}

export function assertValidMLIR(index,options={},stage='來源模型') {
    const result=validateMLIR(index,options);
    if (result.diagnostics.length) throw new MLIRValidationError(result.diagnostics,stage);
    return {scope:result.scope,passed:true};
}

export async function validateMLIRText(text,options={}) {
    let candidate;
    try {candidate=await parseMLIR(new TextEncoder().encode(text),{...options,identifier:'extracted.mlir'});}
    catch(error) {
        const location=/at (\d+):(\d+)/.exec(error.message);
        throw new MLIRValidationError([{code:'SYNTAX',message:error.message,line:Number(location?.[1]) || undefined,column:Number(location?.[2]) || undefined}],'匯出子圖');
    }
    return assertValidMLIR(candidate,{},'匯出子圖');
}

function inspect({source,info,ir,dialects},targetBlock) {
    const {rows,regions,definitions,byOp,byBlock,lookup}=ir;
    const lineStarts=[0],diagnostics=[],cfg=new Map();
    for(let i=0;i<source.length;i++) if(source[i]==='\n')lineStarts.push(i+1);
    const targetContext=targetBlock ? byBlock.get(targetBlock)?.owner?.context || 0 : undefined;
    const emit=(code,message,row,position=row?.range?.[0] || 0)=> {
        if(targetContext!==undefined && (row?.context || 0)!==targetContext) return;
        if(diagnostics.length>=100) return;
        let lo=0,hi=lineStarts.length;
        while(lo<hi) {const mid=(lo+hi)>>>1;if(lineStarts[mid]<=position)lo=mid+1;else hi=mid;}
        diagnostics.push({code,message:String(message).slice(0,1200),line:lo,column:position-lineStarts[lo-1]+1,operator:(nameOf(row?.op)||'').slice(0,240),context:row?.context || 0,excerpt:source.slice(lineStarts[lo-1],lineStarts[lo] || source.length).trimEnd().slice(0,240)});
    };
    // Build edges from terminators, never from data-flow lines in the viewer.
    for(const region of regions) {
        const labels=new Map(),edges=new Map();
        if(!['graph','ssacfg'].includes(region.kind)) emit('DIALECT_REGION_KIND','Dialect adapter 的 regionKind 必須是 graph 或 ssacfg。',region.owner);
        if(region.kind==='graph' && region.blocks.length>1) emit('CFG_GRAPH_BLOCKS','Graph region 不允許多個 blocks。',region.owner);
        for(const block of region.blocks) {
            if(block.name && labels.has(block.name)) emit('CFG_BLOCK_REDEFINITION',`${block.name} 重複定義。`,region.owner);
            labels.set(block.name,block);
        }
        for(const block of region.blocks) {
            const operations=block.operations || [],last=operations.at(-1),targets=[];
            for(const [i,op] of operations.entries()) {
                const row=byOp.get(op),sem=operationSemantics(op,dialects);
                if((sem.terminator || op.successors?.length) && i!==operations.length-1) emit('TERMINATOR_POSITION','Terminator／branch 後仍有 operation。',row);
                if(op.successors?.length || sem.branch) {
                    if(!sem.branch || typeof sem.successorOperands!=='function') emit('CFG_BRANCH_UNSUPPORTED',`${nameOf(op)} 尚未註冊 successor operands 規則；請加入 dialect adapter。`,row);
                    let groups;
                    try {groups=sem.successorOperands?.({op,uses:row.uses,typeOf:typeSpelling});}
                    catch(error){emit('CFG_BRANCH_SIGNATURE',error.message,row);}
                    if(groups && (!Array.isArray(groups) || groups.length!==(op.successors || []).length || groups.some(g=>!Array.isArray(g)))) {emit('CFG_BRANCH_SIGNATURE','Dialect adapter 回傳的 successor operands 數量不符。',row);groups=null;}
                    for(const [j,successor] of (op.successors || []).entries()) {
                        const label=successor.label || successor.name,target=labels.get(label);
                        if(!target) {emit('CFG_TARGET_UNDEFINED',`找不到同一 region 的 successor ${label}。`,row);continue;}
                        if(target===region.blocks[0]) emit('CFG_ENTRY_PREDECESSOR','Region entry block 不可有 predecessor。',row);
                        if(op===last) targets.push(target);
                        const group=groups?.[j],args=target.arguments || [];
                        if(group && (group.length!==args.length || group.some((use,k)=>!sameType(use?.type,definitions.get(args[k])?.type)))) emit('CFG_ARGUMENTS',`${label} 的 branch operands 數量或型別與 block arguments 不一致。`,row);
                    }
                    if(nameOf(op).startsWith('cf.') && (op.results || []).length) emit('CFG_BRANCH_SIGNATURE','cf branch 不可產生 SSA results。',row);
                }
            }
            edges.set(block,targets);
            if(region.kind!=='graph' && (region.blocks.length>1 || nameOf(region.owner?.op)==='func.func') && !operationSemantics(last || {name:{getStringRef:()=>''}},dialects).terminator) emit('CFG_TERMINATOR_UNSUPPORTED','Block 缺少已知 terminator；custom terminator 請透過 dialect adapter 宣告。',byOp.get(last) || region.owner);
        }
        cfg.set(region,buildDominance(region.blocks,edges));
    }
    const dominates=(def,row)=> {
        let anchor=row;
        while(anchor && anchor.region!==def.region) anchor=anchor.parent;
        if(!anchor) return false;
        // An operation's result cannot be captured by its own nested region.
        if(def.row===anchor && row!==anchor) return false;
        if(def.region.kind==='graph')return true;
        if(def.block===anchor.block)return def.order<anchor.position;
        return cfg.get(def.region).dominates(def.block,anchor.block);
    };
    for(const def of definitions.values()) {
        const visible=lookup(def.region,def.key);
        const outer=!def.region.isolated && def.region.parent ? lookup(def.region.parent,def.key) : undefined;
        if(visible!==def || outer) emit('SSA_REDEFINITION',`${refOf(def.name,def.number)} 重複定義，或遮蔽仍可見的外層 SSA 值。`,def.row || def.region.owner,def.position ?? def.row?.range?.[0]);
    }
    for(const row of rows) {
        const {op,region}=row,name=nameOf(op);
        if(!info.generic.has(op) && !['builtin.module','func.func','func.return'].includes(name)) emit('ASSEMBLY_UNSUPPORTED','此 operation 使用 custom assembly；請先輸出 generic MLIR，才能完整檢查其 SSA。',row);
        if(row.uses.length!==(op.operands || []).length) emit('USE_COVERAGE','無法完整對應 operation 的所有 SSA operands，已停止匯出。',row);
        for(const use of row.uses) {
            const def=lookup(region,keyOf(use.name,use.number)),ref=source.slice(...use.range);
            if(!def) {
                const code=lookup(region,keyOf(use.name)) ? 'SSA_RESULT_INDEX' : 'SSA_UNDEFINED';
                emit(code,code==='SSA_RESULT_INDEX' ? `${ref} 的結果編號不存在。` : `${ref} 未定義，或不在目前可見的 SSA scope。`,row,use.range[0]);
                continue;
            }
            if(!sameType(def.type,use.type)) emit('SSA_TYPE_MISMATCH',`${ref} 宣告為 ${typeSpelling(def.type)}，此處卻使用 ${typeSpelling(use.type)}。`,row,use.range[0]);
            if(!dominates(def,row)) emit('SSA_DOMINANCE',`${ref} 的定義未支配此使用位置；請檢查 block 路徑、先後順序與 region scope。`,row,use.range[0]);
        }
        if(name==='func.func') {
            const attr=op.getAttr('function_type'),type=attr?.value || attr?.type;
            if(!Array.isArray(type?.inputs) || !Array.isArray(type?.results)) emit('FUNCTION_SIGNATURE','缺少有效的 function_type。',row);
            else if(op.regions?.[0]?.blocks.length) {
                const args=op.regions[0].blocks[0].arguments || [];
                if(args.length!==type.inputs.length || args.some((arg,j)=>!sameType(definitions.get(arg)?.type,type.inputs[j]))) emit('FUNCTION_ARGUMENTS','Function entry block 的 arguments 與 function_type 不一致。',row);
            }
        }
        if(name==='func.return') {
            const owner=region.owner?.op,attr=owner?.getAttr('function_type'),type=attr?.value || attr?.type;
            if(nameOf(owner)!=='func.func') emit('RETURN_SCOPE','func.return 必須位於 func.func 的直接 body。',row);
            else if(!type?.results || row.uses.length!==type.results.length || row.uses.some((use,j)=>!sameType(use.type,type.results[j]))) emit('RETURN_SIGNATURE','func.return 的數量或型別與 function signature 不一致。',row);
        }
        const sem=operationSemantics(op,dialects);
        for(const issue of sem.verify?.({op,uses:row.uses,typeOf:typeSpelling}) || []) emit(issue.code || 'DIALECT_VALIDATION',issue.message,row);
    }
    return diagnostics;
}
