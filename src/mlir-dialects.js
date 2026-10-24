// Trusted, build-time extensions only. A model never supplies executable hooks.
const nameOf = op => op.name.getStringRef();
const segments = (op, name) => op.getAttr(name)?.value;
export function operationSemantics(op, dialects = []) {
    const name = nameOf(op);
    const builtin = {
        'builtin.module': { isolated: true, regionKind: 'graph' },
        'func.func': { isolated: true, regionKind: 'ssacfg' },
        'func.return': { terminator: true },
        'cf.br': { terminator: true, branch: true, successorOperands: ({uses}) => {
            if (op.successors?.length !== 1) throw new Error('cf.br 必須有一個 successor。');
            return [uses];
        } },
        'cf.cond_br': { terminator: true, branch: true, successorOperands: ({uses, typeOf}) => {
            const sizes = segments(op, 'operandSegmentSizes');
            if (op.successors?.length !== 2 || !validSizes(sizes,3) || sizes[0] !== 1 || sizes.reduce((a,b)=>a+b,0) !== uses.length || typeOf(uses[0]?.type) !== 'i1') throw new Error('cf.cond_br 需要 i1 condition、兩個 successors 和正確的 operandSegmentSizes。');
            return [uses.slice(1,1+sizes[1]),uses.slice(1+sizes[1])];
        } },
        'cf.switch': { terminator: true, branch: true, successorOperands: ({uses, typeOf}) => {
            const sizes = segments(op,'operandSegmentSizes'), cases = segments(op,'case_operand_segments');
            if (!validSizes(sizes,3) || sizes[0] !== 1 || !Array.isArray(cases) || !validSizes(cases,cases.length) || op.successors?.length !== cases.length+1 || sizes.reduce((a,b)=>a+b,0) !== uses.length || cases.reduce((a,b)=>a+b,0) !== sizes[2] || !/^i[1-9]\d*$/.test(typeOf(uses[0]?.type))) throw new Error('cf.switch 的 successors、整數 flag 或 operand segments 不一致。');
            let offset=1;
            return [sizes[1],...cases].map(size=>{const group=uses.slice(offset,offset+size);offset+=size;return group;});
        } }
    }[name] || {};
    const adapter = dialects.find(item=>name.startsWith(`${item.namespace}.`));
    return { ...builtin, ...adapter?.operationSemantics?.({name,op}) };
}
function validSizes(sizes,length) {return Array.isArray(sizes) && sizes.length===length && sizes.every(n=>Number.isSafeInteger(n) && n>=0);}
