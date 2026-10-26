// Trusted local build extensions only. Models never supply executable hooks.
export function validateDialectAdapters(adapters) {
    if(!Array.isArray(adapters) || adapters.length>128)throw new Error('Dialect 擴充必須提供最多 128 個 adapters。');
    const names=new Set();
    for(const adapter of adapters) {
        const name=adapter?.namespace;
        if(typeof name!=='string' || !/^[A-Za-z_][A-Za-z0-9_]*$/.test(name) || names.has(name))throw new Error('Dialect namespace 無效或重複。');
        if(adapter.interfaceVersion!==undefined && adapter.interfaceVersion!==1)throw new Error(`Dialect ${name} 的 interface 版本不相容。`);
        for(const hook of ['describeOperation','operationSemantics'])if(adapter[hook]!==undefined && typeof adapter[hook]!=='function')throw new Error(`Dialect ${name} 的 ${hook} 必須是 function。`);
        names.add(name);
    }
    return Object.freeze([...adapters]);
}
