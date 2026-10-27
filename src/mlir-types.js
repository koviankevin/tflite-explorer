// Type spelling without loading the MLIR parser into TFLite-only workers.
export const typeSpelling=type=>{
    if(type&&typeof type.dialect==='string'&&type.symbolData){
        const data=String(type.symbolData);return `!${type.dialect}${data.startsWith('<')?'':'.'}${data}`;
    }
    const text=type===null||type===undefined?'':String(type);
    return type?.elementType?text.replace(String(type.elementType),typeSpelling(type.elementType)):text;
};
