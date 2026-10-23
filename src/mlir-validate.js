import { parseMLIR, typeSpelling } from './mlir-engine.js';

export const MLIR_VALIDATION_SCOPE = '本機語法／SSA 檢查；不含 dialect 自訂語意與完整 LLVM verifier';
const nameOf = op => op?.name.getStringRef();
const keyOf = (name,number=0) => `${name}#${number}`;
const refOf = (name,number=0) => number ? `${name}#${number}` : name;
const sameType = (a,b) => Boolean(a && b) && typeSpelling(a)===typeSpelling(b);
class Scope {
    constructor(parent=null,hidden=[]) {this.parent=parent;this.hidden=new Set(hidden);this.values=new Map();}
    get(key) {return this.values.has(key) ? this.values.get(key) : this.hidden.has(key) ? undefined : this.parent?.get(key);}
    has(key) {return this.get(key)!==undefined;}
    set(key,value) {this.values.set(key,value);}
}

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
    const key=graphIndex ?? 'all';
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

function inspect({root,source,info},targetBlock) {
    const rows=[],byOp=new Map(),contexts=new Map(),lineStarts=[0],diagnostics=[];
    for(let i=0;i<source.length;i++) if(source[i]==='\n') lineStarts.push(i+1);
    let nextContext=0;
    const collect=(block,parent=null,context=0)=> {
        contexts.set(block,context);
        for(const op of block.operations || []) {
            const range=info.operations.get(op);
            const row={op,parent,context:nameOf(op)==='func.func' ? ++nextContext : context,range,uses:[]};
            rows.push(row); byOp.set(op,row);
            for(const region of op.regions || []) for(const child of region.blocks || []) collect(child,row,row.context);
        }
    };
    collect(root);
    const targetContext=targetBlock ? contexts.get(targetBlock) : undefined;
    const sorted=rows.filter(row=>row.range).sort((a,b)=>a.range[0]-b.range[0]);
    for(const use of info.uses) {
        let lo=0,hi=sorted.length;
        while(lo<hi) {const mid=(lo+hi)>>>1;if(sorted[mid].range[0]<=use.range[0]) lo=mid+1;else hi=mid;}
        let row=sorted[lo-1];
        while(row && use.range[1]>row.range[1]) row=row.parent;
        if(row) row.uses.push(use);
    }
    const emit=(code,message,row,position=row?.range?.[0] || 0)=> {
        if(targetContext!==undefined && (row?.context || 0)!==targetContext) return;
        if(diagnostics.length>=100) return;
        let lo=0,hi=lineStarts.length;
        while(lo<hi) {const mid=(lo+hi)>>>1;if(lineStarts[mid]<=position)lo=mid+1;else hi=mid;}
        diagnostics.push({code,message:message.slice(0,1200),line:lo,column:position-lineStarts[lo-1]+1,operator:(nameOf(row?.op)||'').slice(0,240),context:row?.context || 0,excerpt:source.slice(lineStarts[lo-1],lineStarts[lo] || source.length).trimEnd().slice(0,240)});
    };
    const definition=value=> {
        const original=info.definitions.get(value);
        return original ? {...original,value} : null;
    };
    const define=(env,value,row)=> {
        const def=definition(value);
        if(!def) {emit('DECLARATION_UNAVAILABLE','無法取得 SSA 的原始宣告型別。',row);return;}
        const key=keyOf(def.name,def.number);
        if(env.has(key)) emit('SSA_REDEFINITION',`${refOf(def.name,def.number)} 重複定義，或遮蔽仍可見的外層 SSA 值。`,row,def.position ?? row?.range?.[0]);
        else env.set(key,def);
    };
    const visit=(block,inherited,owner=null,func=null,graphRegion=false)=> {
        const env=new Scope(inherited);
        const operations=block.operations || [];
        for(const arg of block.arguments || []) define(env,arg,owner);
        if(graphRegion) for(const op of operations) for(const result of op.results || []) define(env,result,byOp.get(op));
        const future=new Map();
        for(const op of operations) for(const result of op.results || []) {
            const def=definition(result);if(def) future.set(keyOf(def.name,def.number),def);
        }
        for(let i=0;i<operations.length;i++) {
            const op=operations[i],row=byOp.get(op),name=nameOf(op);
            if(!info.generic.has(op) && !['builtin.module','func.func','func.return'].includes(name)) emit('ASSEMBLY_UNSUPPORTED','此 operation 使用 custom assembly；請先輸出 generic MLIR，才能完整檢查其 SSA。',row);
            if(row.uses.length!==(op.operands || []).length) emit('USE_COVERAGE','無法完整對應 operation 的所有 SSA operands，已停止匯出。',row);
            row.uses.sort((a,b)=>a.range[0]-b.range[0]);
            for(const use of row.uses) {
                const key=keyOf(use.name,use.number),def=env.get(key),ref=source.slice(...use.range);
                if(!def) {
                    if(future.has(key)) emit('SSA_DOMINANCE',`${ref} 在定義之前使用，或在其定義的 region 內使用自身結果（dominance 違規）。`,row,use.range[0]);
                    else if(env.has(keyOf(use.name)) || future.has(keyOf(use.name))) emit('SSA_RESULT_INDEX',`${ref} 的結果編號不存在。`,row,use.range[0]);
                    else emit('SSA_UNDEFINED',`${ref} 未定義，或不在目前可見的 SSA scope。`,row,use.range[0]);
                    continue;
                }
                if(!sameType(def.type,use.type)) emit('SSA_TYPE_MISMATCH',`${ref} 宣告為 ${typeSpelling(def.type)}，此處卻使用 ${typeSpelling(use.type)}。`,row,use.range[0]);
                if(use.value!==def.value) emit('SSA_IDENTITY_UNSUPPORTED',`${ref} 的 forward reference 或 scope 無法可靠還原；請先以 compiler 正規化 IR。`,row,use.range[0]);
            }
            if(name==='func.return') {
                if(!func || nameOf(owner?.op)!=='func.func') emit('RETURN_SCOPE','func.return 必須位於 func.func 的直接 body。',row);
                else {
                    const results=func.results;
                    if(row.uses.length!==results.length || row.uses.some((use,j)=>!sameType(use.type,results[j]))) emit('RETURN_SIGNATURE','func.return 的數量或型別與 function signature 不一致。',row);
                }
                if(i!==operations.length-1) emit('TERMINATOR_POSITION','func.return 後仍有 operation。',row);
            }
            for(const region of op.regions || []) {
                if(region.blocks?.length>1) {emit('CFG_UNSUPPORTED','此 region 有多個 blocks；本機檢查尚不能完整驗證跨 block dominance，已停止匯出。',row);continue;}
                let signature=null;
                if(name==='func.func') {
                    const attribute=op.getAttr('function_type');
                    const type=attribute?.value || attribute?.type;
                    if(!Array.isArray(type?.inputs) || !Array.isArray(type?.results)) emit('FUNCTION_SIGNATURE','缺少有效的 function_type。',row);
                    else {
                        signature=type;
                        const args=region.blocks?.[0]?.arguments || [];
                        if(args.length!==type.inputs.length || args.some((arg,j)=>!sameType(definition(arg)?.type,type.inputs[j]))) emit('FUNCTION_ARGUMENTS','Function entry block 的 arguments 與 function_type 不一致。',row);
                    }
                }
                const isolated=name==='func.func' || name==='builtin.module';
                const hidden=(op.results || []).map(result=>definition(result)).filter(Boolean).map(def=>keyOf(def.name,def.number));
                const childEnv=isolated ? null : new Scope(env,hidden);
                for(const child of region.blocks || []) visit(child,childEnv,row,name==='func.func' ? signature : func,name==='builtin.module');
            }
            if(!graphRegion) for(const result of op.results || []) define(env,result,row);
        }
        if(nameOf(owner?.op)==='func.func' && func && nameOf(operations.at(-1))!=='func.return') emit('FUNCTION_TERMINATOR','此 function body 缺少可驗證的 func.return；其他 terminator 需由對應 dialect verifier 檢查。',owner);
    };
    visit(root,null,null,null,true);
    return diagnostics;
}
