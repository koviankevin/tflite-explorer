import {typeSpelling} from './mlir-types.js';
import {tableFields} from './flatbuffer-writer.js';
import {tflite as schema} from '../vendor/netron/tflite-schema.js';

const scalarKinds=new Set(['bool_','int8_','int32_','uint32_','float32_','string_']);
const same=(a,b)=>a===b||a&&b&&typeof a==='object'&&typeof b==='object'&&Object.keys(a).length===Object.keys(b).length&&Object.keys(a).every(k=>same(a[k],b[k]));
const tensorId=value=>{if(typeof value==='string'){if(!/^-?\d+$/.test(value.trim()))throw Error('Tensor 編號請填十進位整數。');value=Number(value.trim());}if(!Number.isSafeInteger(value))throw Error('Tensor 編號無效。');return value;};
const spelling=(data,value)=>{const def=data.ir.definitions.get(value);return def?def.name+(def.number||value.owner?.results?.length>1?`#${def.number}`:''):'';};
function mlirOp(index,graph,node){const data=index.mlir,op=data?.graphs[graph]?.operations[node];if(!Number.isInteger(graph)||!Number.isInteger(node)||!op)throw Error('請先選取原始 OP。');const range=data.info.operations.get(op);if(!range||range[1]-range[0]>1024*1024)throw Error('此 OP 的結構文字超過 1 MiB，請使用外部編輯器。');return {data,op,range,row:data.ir.byOp.get(op)};}
function tfOp(index,graph,node){const g=index.raw?.subgraphs[graph],op=g?.operators[node];if(!Number.isInteger(graph)||!Number.isInteger(node)||!op)throw Error('請先選取原始 OP。');return {g,op};}
function checkTensor(a,b){if(!a||!b||!['type','shape','shape_signature','quantization','sparsity'].every(k=>same(a[k],b[k])))throw Error('替代 tensor 的 dtype、shape、量化或 sparsity 不同；請選擇相容的 tensor，或將刪除輸出改為模型輸入。');}

function mlirText(index,args){
    const {data,op,range,row}=mlirOp(index,args.graph,args.node),source=data.source.slice(...range);
    if(args.advanced)return args.text;
    const changes=new Map(),put=(start,end,text)=>changes.set(start,{start,end,text});
    if(args.name!==undefined){
        if(!data.info.generic.has(op))throw Error('此 OP 採 custom assembly；請使用完整 IR 編輯。');
        const name=/"(?:\\.|[^"\\])*"/.exec(source);
        if(!name||JSON.parse(name[0])!==op.name.getStringRef()||typeof args.name!=='string'||!args.name.includes('.')||args.name.length>256)throw Error('Generic OP 名稱無效。');
        put(name.index,name.index+name[0].length,JSON.stringify(args.name));
    }
    if(args.operands!==undefined){
        if(!Array.isArray(args.operands)||args.operands.length!==row.uses.length)throw Error('SSA operand 數量不同；請使用完整 IR 同步修改型別簽章。');
        row.uses.forEach((use,i)=>{const name=args.operands[i];if(typeof name!=='string'||!/^%[A-Za-z0-9_$.-]+(?:#[0-9]+)?$/.test(name))throw Error('SSA 名稱無效。');put(use.range[0]-range[0],use.range[1]-range[0],name);});
    }
    let renamed;
    if(args.mode.startsWith('add-')&&op.results.length){
        let prefix='%model_lens_new_';while(data.source.includes(prefix))prefix='%_'+prefix.slice(1);
        renamed=new Map();for(const result of op.results){const def=data.ir.definitions.get(result);if(def&&!renamed.has(def.name))renamed.set(def.name,prefix+renamed.size);}
        const own=new Set(op.results);
        for(const consumer of data.ir.rows)for(const use of consumer.uses)if(own.has(use.value)&&use.range[0]>=range[0]&&use.range[1]<=range[1]){
            const existing=changes.get(use.range[0]-range[0]);if(existing&&existing.text!==spelling(data,use.value))continue;
            const def=data.ir.definitions.get(use.value);put(use.range[0]-range[0],use.range[1]-range[0],renamed.get(def.name)+(def.number||op.results.length>1?`#${def.number}`:''));
        }
    }
    let cursor=0,text='';for(const c of [...changes.values()].sort((a,b)=>a.start-b.start)){text+=source.slice(cursor,c.start)+c.text;cursor=c.end;}text+=source.slice(cursor);
    if(renamed){const end=text.indexOf('=');if(end<0)throw Error('找不到 SSA result 定義。');text=text.slice(0,end).replace(/%[A-Za-z0-9_$.-]+/g,name=>renamed.get(name)||name)+text.slice(end);}
    return text;
}
export const operationEditText=(index,args)=>mlirText(index,args);

export function operationEditInfo(index,{graph,node}){
    if(index.mlir){
        const {data,op,range,row}=mlirOp(index,graph,node);
        return {format:'mlir',graph,node,name:op.name.getStringRef(),generic:data.info.generic.has(op),text:data.source.slice(...range),addText:mlirText(index,{graph,node,mode:'add-after'}),
            operands:row.uses.map(use=>({value:data.source.slice(...use.range),type:typeSpelling(data.ir.definitions.get(use.value)?.type)})),
            outputs:op.results.map((value,result)=>({value:spelling(data,value),result,type:typeSpelling(data.ir.definitions.get(value)?.type)})),
            deferredWeights:Boolean(data.payloads?.length&&/"0x01000000[0-9a-f]{40}"/.test(data.source.slice(...range)))};
    }
    const {g,op}=tfOp(index,graph,node),code=index.raw.operator_codes[op.opcode_index],fields=[];
    for(const [key,options] of [['options',op.builtin_options],['options2',op.builtin_options_2]])if(options)for(const f of tableFields(options.constructor.name))if(scalarKinds.has(f.kind)&&!(f.kind==='string_'&&String(options[f.key]||'').length>4096))fields.push({group:key,key:f.key,kind:f.kind,value:options[f.key]});
    const port=id=>({value:id,name:g.tensors[id]?.name||'',type:id<0?'optional':`${schema.TensorType[g.tensors[id].type]} [${g.tensors[id].shape}]`});
    return {format:'tflite',graph,node,name:code.custom_code||schema.BuiltinOperator[Math.max(code.builtin_code,code.deprecated_builtin_code)],operands:Array.from(op.inputs,port),outputs:Array.from(op.outputs,port),fields,signatures:index.raw.signature_defs.some(s=>s.subgraph_index===graph)};
}

// Only bounded metadata is sent to the main thread. No weight/custom payloads.
export function operationValueChoices(index,{graph,node,query=''}){
    if(typeof query!=='string'||query.length>256)throw Error('搜尋條件過長。');const found=[],q=query.toLowerCase();
    if(index.mlir){
        const {data,row}=mlirOp(index,graph,node);
        for(const def of data.ir.definitions.values())if(data.ir.lookup(row.region,def.key)===def){const name=spelling(data,def.value),type=typeSpelling(def.type);if((name+' '+type).toLowerCase().includes(q)){found.push({value:name,label:`${name} · ${type}`});if(found.length===50)break;}}
    }else{const {g}=tfOp(index,graph,node);for(const [id,t] of g.tensors.entries())if((`#${id} ${t.name||''} ${schema.TensorType[t.type]}`).toLowerCase().includes(q)){found.push({value:id,label:`#${id} · ${t.name||''} · ${schema.TensorType[t.type]} [${t.shape}]`});if(found.length===50)break;}}
    return found;
}

export async function editModelOperation(index,file,args,options={}){
    if(!['replace','add-before','add-after','remove'].includes(args.mode))throw Error('請選擇模型修改操作。');
    if(index.mlir){
        const {editMLIRModel}=await import('./mlir-model-edit.js');
        if(args.mode!=='remove')return editMLIRModel(index,[{kind:args.mode==='replace'?'replace':args.mode==='add-before'?'insert-before':'insert-after',graph:args.graph,node:args.node,text:mlirText(index,args)}],options);
        const {data,op,row}=mlirOp(index,args.graph,args.node),edits=[{kind:'remove',graph:args.graph,node:args.node}];
        const graphByBlock=new Map(data.graphs.map((g,i)=>[g.block,i]));
        for(const [result,name] of (args.replacements||[]).entries())if(name){
            if(!/^%[A-Za-z0-9_$.-]+(?:#[0-9]+)?$/.test(name))throw Error('替代 SSA 名稱無效。');const match=/^(%[^#]+)(?:#(\d+))?$/.exec(name),def=data.ir.lookup(row.region,`${match[1]}#${Number(match[2]||0)}`);
            if(!def)throw Error('找不到此 scope 的替代 SSA 定義。');const graph=graphByBlock.get(def.block);let value;
            if(def.row)value={graph,node:data.graphs[graph]?.operations.indexOf(def.row.op),result:def.value.resultNumber};
            else value={graph,argument:data.graphs[graph]?.block.arguments.indexOf(def.value)};
            if(result>=op.results.length)throw Error('替代 result 編號不存在。');edits.push({kind:'replace-value',graph:args.graph,node:args.node,result,value});
        }
        return editMLIRModel(index,edits,options);
    }
    const {editTfliteModel}=await import('./tflite-model-edit.js'),{g,op}=tfOp(index,args.graph,args.node);
    const operators=g.operators.map((_,template)=>({template})),plan={graph:args.graph,operators,updateSignatures:args.updateSignatures===true};
    if(args.mode==='remove'){
        operators.splice(args.node,1);
        if(args.deleteMode==='boundary'){
            const required=Array.from(op.outputs).filter(id=>g.outputs.includes(id)||g.operators.some((n,i)=>i!==args.node&&n.inputs.includes(id)));plan.inputs=[...new Set([...g.inputs,...required])];
        }else{
            const mappings=new Map();for(const [i,value] of (args.replacements||[]).entries())if(value!==''&&value!==undefined&&value!==null){const id=tensorId(value),original=op.outputs[i];if(original===undefined)throw Error('替代 output 編號不存在。');checkTensor(g.tensors[original],g.tensors[id]);mappings.set(original,id);}
            operators.forEach(entry=>{entry.inputs=Array.from(g.operators[entry.template].inputs,id=>mappings.get(id)??id);});plan.outputs=Array.from(g.outputs,id=>mappings.get(id)??id);
        }
    }else{
        const entry={template:args.node};
        if(args.operands!==undefined){if(!Array.isArray(args.operands)||args.operands.length!==op.inputs.length)throw Error('輸入數量不符。');entry.inputs=args.operands.map((value,i)=>{const id=tensorId(value);if(id< -1||!g.tensors[id]&&id!==-1)throw Error('Tensor 編號無效。');if(id===-1&&op.inputs[i]>=0&&index.graphs[args.graph].graph.nodes[args.node].type.inputs?.[i]?.option!=='optional')throw Error('此輸入未宣告為 optional，不能移除接線。');if(id>=0&&op.inputs[i]>=0)checkTensor(g.tensors[op.inputs[i]],g.tensors[id]);return id;});}
        for(const key of ['options','options2'])if(args[key]!==undefined)entry[key]=args[key];
        if(args.mode==='replace')operators[args.node]=entry;
        else {plan.tensors=Array.from(op.outputs,(id,i)=>({like:id,name:`${g.tensors[id].name||'result'}_new_${i}`}));entry.outputs=Array.from(op.outputs,(_,i)=>g.tensors.length+i);operators.splice(args.node+(args.mode==='add-after'?1:0),0,entry);if(args.exposeOutputs!==false)plan.outputs=[...g.outputs,...entry.outputs];}
    }
    return editTfliteModel(index,file,[plan]);
}
