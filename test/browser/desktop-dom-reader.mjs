// Run in Playwright's documented contentScript selector world, isolated from
// Netron's replaced window.eval and app JS objects. Only inspect the shared DOM.
// A detached output carries JSON back through locator.textContent(); it is
// never inserted into the document and is never used as an action target.
export function createDOMObservationEngine(){
    const query=(root,encoded)=>{
        const {expression,args}=JSON.parse(decodeURIComponent(encoded));
        const value=(0,eval)(`(${expression})(...${JSON.stringify(args)})`);
        const carrier=(root.ownerDocument||root).createElement('output');
        carrier.textContent=JSON.stringify({value});return carrier;
    };
    return {query,queryAll:(root,encoded)=>[query(root,encoded)]};
}
export async function registerDOMReader(selectors){
    await selectors.register('lensobserve',createDOMObservationEngine,{contentScript:true});
}
export function desktopDOMReader(page){
    return async(fn,...args)=>{
        const encoded=encodeURIComponent(JSON.stringify({expression:fn.toString(),args}));
        const raw=await page.locator('lensobserve='+encoded).textContent();
        return JSON.parse(raw).value;
    };
}
