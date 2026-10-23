import { ModelFactory } from '../vendor/netron/mlir.js';
import { Decoder } from '../vendor/netron/text.js';
import { indexModel } from './model-engine.js';
import { prepareMLIR, opName } from './mlir-ir.js';

export const MLIR_TEXT_LIMIT = 64 * 1024 * 1024;
export const MLIR_ATTRIBUTE_PREVIEW_LIMIT = 16 * 1024;
const spelling = value => value === null || value === undefined ? '' : String(value);
const argument = (name, value) => ({ name, value: [value] });
export const typeSpelling = type => {
    if (type && typeof type.dialect === 'string' && type.symbolData) {
        const data=spelling(type.symbolData);
        return `!${type.dialect}${data.startsWith('<') ? '' : '.'}${data}`;
    }
    const text=spelling(type);
    return type?.elementType ? text.replace(spelling(type.elementType),typeSpelling(type.elementType)) : text;
};
const ssaName = value => {
    if (value.modelLensSSAName) return value.modelLensSSAName;
    const siblings = value.owner?.results;
    if (siblings?.length > 1 && siblings.every((item,i)=>item.name === siblings[0].name+(i ? `.${i}` : ''))) return `${siblings[0].name}#${value.resultNumber}`;
    return value.name || value.value;
};
function valueType(type) {
    const text = typeSpelling(type);
    const shaped = /^(tensor|memref|vector)<(.+)>$/.exec(text);
    let body=shaped?.[2] || text;
    if (shaped) {
        let depth=0, quoted=false, escaped=false;
        for (let i=0;i<body.length;i++) {
            const c=body[i];
            if (quoted) { if (escaped) escaped=false; else if (c==='\\') escaped=true; else if (c==='"') quoted=false; continue; }
            if (c==='"') quoted=true;
            else if ('<([{'.includes(c)) depth++;
            else if ('>)]}'.includes(c)) depth--;
            else if (c===',' && depth===0) { body=body.slice(0,i).trim(); break; }
        }
    }
    const parts = body.split('x');
    const dimensions = [];
    while (parts.length > 1 && /^(\d+|\?|\*)$/.test(parts[0])) {
        const dimension = parts.shift();
        dimensions.push(/^\d+$/.test(dimension) && Number.isSafeInteger(Number(dimension)) ? Number(dimension) : dimension);
    }
    return { dataType: parts.join('x') || text || '?', shape: { dimensions }, spelling: text };
}

// Internal builds may supply namespace-specific decorators/metadata. Generic
// operation identity and SSA connections remain independent of display hooks.
export async function parseMLIR(bytes, { identifier = 'model.mlir', metadata = '[]', dialects = [], progress = () => {} } = {}) {
    if (bytes.byteLength > MLIR_TEXT_LIMIT) throw new Error('文字 MLIR 基礎版最多 64 MiB；請先縮小 IR dump。');
    if (bytes[0] === 0x4d && bytes[1] === 0x4c && bytes[2] === 0xef && bytes[3] === 0x52) throw new Error('目前支援文字 .mlir，尚不支援 MLIR bytecode。');
    const start = performance.now();
    const source = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    const graphs = [];
    const exportGraphs = [];
    let sourceInfo, rootBlock, ir;
    progress('解析 MLIR operations 與 SSA 資料流');
    const build = (root, info) => {
        sourceInfo = info;
        rootBlock = root;
        ir = prepareMLIR(root,info,dialects);
        const cfgContexts=new Set(),contextBlocks=new Map();
        for(const region of ir.regions) {
            const context=region.owner?.context;
            if(!context) continue;
            contextBlocks.set(context,(contextBlocks.get(context) || 0)+region.blocks.length);
            if(region.blocks.length>1) cfgContexts.add(context);
        }
        const visitBlock = (block, path) => {
            const graph = { name: path, type: 'graph', inputs: [], outputs: [], nodes: [], metadata: [] };
            const values = new Map();
            const value = (name, type) => {
                if (!name) throw new Error(`MLIR SSA 名稱缺失：${path}`);
                if (!values.has(name)) values.set(name, { name, identifier: name, type: valueType(type), description: spelling(type), initializer: null });
                return values.get(name);
            };
            const operations = block.operations || [];
            const exportOperations = [];
            for (const arg of block.arguments || []) { const name=ssaName(arg); graph.inputs.push(argument(name, value(name, arg.type))); }
            const containers = [];
            for (const op of operations) {
                const name = op.name.getStringRef();
                const symbol = op.getAttr('sym_name')?.value;
                const isContainer = name === 'builtin.module' || name === 'func.func';
                if (isContainer) { containers.push({ op, path: `${path}/${symbol ? '@'+symbol : name}` }); continue; }
                const id = String(graph.nodes.length);
                const node = { identifier: id, name, type: { name, identifier: name }, inputs: [], outputs: [], attributes: [], metadata: [], blocks: [] };
                for (const operand of op.operands || []) { const name=ssaName(operand); node.inputs.push(argument(name, value(name, operand.type))); }
                for (const result of op.results || []) { const name=ssaName(result); node.outputs.push(argument(name, value(name, result.type))); }
                if (/\.(return|yield)$/.test(name)) graph.outputs.push(...node.inputs);
                for (const [key, attr] of op.getAttrDictionary()) {
                    const range = info.attributes.get(attr);
                    const length = range ? range[1]-range[0] : 0;
                    const raw = range ? source.slice(range[0],Math.min(range[1],range[0]+MLIR_ATTRIBUTE_PREVIEW_LIMIT)) : spelling(attr);
                    const display = raw.startsWith('"') && typeof attr.value === 'string' ? attr.value.slice(0,MLIR_ATTRIBUTE_PREVIEW_LIMIT) : raw;
                    node.attributes.push({ name: key, type: 'string', value: length>MLIR_ATTRIBUTE_PREVIEW_LIMIT ? `${display}…（屬性預覽已截短；匯出保留完整原文）` : display });
                }
                if (op.loc) node.metadata.push({ name: 'location', value: op.loc.printLocationInternal?.() || spelling(op.loc), type: 'string' });
                node.metadata.push({ name: 'scope', value: path, type: 'string' });
                if (op.successors?.length) node.metadata.push({ name: 'successors', value: op.successors.map(s=>s.label || s.name).join('、'), type: 'string' });
                for (const dialect of dialects) if (name.startsWith(`${dialect.namespace}.`)) {
                    const extra = dialect.describeOperation?.({ name, attributes: node.attributes, scope: path });
                    if (extra) node.attributes.push(...extra);
                }
                graph.nodes.push(node);
                exportOperations.push(op);
                if (op.regions?.length) containers.push({ op, path: `${path}/#${id} ${name}` });
            }
            if (graph.nodes.length || (block.arguments || []).length) {
                const produced = new Set(graph.nodes.flatMap(n=>n.outputs.flatMap(a=>a.value.map(v=>v.identifier))));
                const used = new Set(graph.nodes.flatMap(n=>n.inputs.flatMap(a=>a.value.map(v=>v.identifier))));
                const inputNames = new Set(graph.inputs.flatMap(a=>a.value.map(v=>v.identifier)));
                for (const [name, v] of values) {
                    if (used.has(name) && !produced.has(name) && !inputNames.has(name)) graph.inputs.push(argument(name, v));
                    if (produced.has(name) && !used.has(name)) graph.outputs.push(argument(name, v));
                }
                graphs.push(graph);
                let row=ir.byBlock.get(block)?.owner, func;
                while(row) { if(opName(row.op)==='func.func') {func=row;break;}row=row.parent; }
                const cfgExport=func && cfgContexts.has(func.context) ? {blocks:contextBlocks.get(func.context), function:func.op.getAttr('sym_name')?.value || 'function'} : null;
                exportGraphs.push({ block, operations: exportOperations, cfgFunction:cfgExport ? func.op : null, cfgExport });
            }
            for (const { op, path: owner } of containers) for (let r=0; r<(op.regions || []).length; r++) {
                const blocks = op.regions[r].blocks || [];
                for (let b=0; b<blocks.length; b++) visitBlock(blocks[b], `${owner}/region ${r}/${blocks[b].name || '^bb'+b}`);
            }
        };
        visitBlock(root, identifier);
        return { format: 'MLIR text', description: 'SSA 資料流依 region／block 顯示；可匯出局部 SSA／控制流程，或保留完整 function。', modules: graphs, metadata: [] };
    };
    const model = await new ModelFactory().open({ type: 'mlir.text', identifier, asset: async () => metadata,
        read: async type => { if (type !== 'text.decoder') throw new Error(`不支援的 MLIR 讀取方式 ${type}`); return Decoder.open(source); }, buildMLIRModel: build });
    if (!graphs.length) throw new Error('MLIR 沒有可檢視的 operation／block。');
    progress('建立 MLIR 搜尋索引');
    return { ...indexModel(model), sourceFormat: 'mlir', capabilities: { tfliteExport: false, mlirExport: true }, mlir: { source, info: sourceInfo, root: rootBlock, graphs: exportGraphs, metadata, dialects, ir }, stats: { bytesRead: bytes.byteLength, fileBytes: bytes.byteLength, parseMs: performance.now()-start } };
}
