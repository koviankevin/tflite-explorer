import {createHash} from 'node:crypto';
export const INTERPRETER_UPSTREAM_JS_SHA256='08e963fcde11dc041feeac97ff711b3a157614edc98ff8bfa309557189b7368d';
// Reproduce the pinned loader from its official bytes and the checked-in,
// ahead-of-time embind factory arguments. No browser string compilation.
export function precompileInterpreterBindings(original,entries){
    if(createHash('sha256').update(original).digest('hex')!==INTERPRETER_UPSTREAM_JS_SHA256)throw Error('Unexpected upstream Interpreter loader.');
    if(!Array.isArray(entries)||entries.length!==116)throw Error('Unexpected Interpreter binding table.');
    const keys=new Set(),literals=[];
    for(const args of entries){
        if(!Array.isArray(args)||!args.length||args.some(p=>typeof p!=='string')||args.slice(0,-1).some(p=>!/^[a-zA-Z_$][a-zA-Z0-9_$]*$/.test(p)))throw Error('Invalid static binding.');
        const key=JSON.stringify(args);if(keys.has(key))throw Error('Duplicate static binding.');keys.add(key);
        literals.push('['+JSON.stringify(key)+',function('+args.slice(0,-1).join(',')+'){\n'+args.at(-1)+'\n}]');
    }
    const text=String(original);
    if([...text.matchAll(/new Function/g)].length!==2||text.split('new_(Function,').length-1!==2)throw Error('Unexpected dynamic binding sites.');
    const fallback='function emval_get_global(){if(typeof globalThis=="object"){return globalThis}return function(){return Function}()("return this")()}';
    if(text.split(fallback).length!==2)throw Error('Unexpected legacy global lookup.');
    const patched=text.replaceAll('new Function','new modelLensBindingFunction').replaceAll('new_(Function,','new_(modelLensBindingFunction,').replace(fallback,'function emval_get_global(){return globalThis}');
    return '// Model Lens: ahead-of-time embind functions, no browser string evaluation.\nvar modelLensBindingFunctions=new Map([\n'+literals.join(',\n')+'\n]);\nfunction modelLensBindingFunction(...args){const f=modelLensBindingFunctions.get(JSON.stringify(args));if(!f)throw Error("Unsupported precompiled Interpreter binding");return f;}\n'+patched;
}
