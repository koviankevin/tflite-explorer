// Test-only bounded DOM metadata. Native Blob objects and payloads are never
// retained; all create/revoke calls and exceptions still belong to the browser.
export function installDesktopRuntimeURLAudit(){
    const rows=[],byURL=new Map(),create=URL.createObjectURL,revoke=URL.revokeObjectURL;let overflow=false;
    const publish=()=>{try{document.documentElement?.setAttribute('data-lens-runtime-urls',JSON.stringify({version:1,overflow,rows}));}catch{/* Observation failure must not change native URL behavior. */}};
    URL.createObjectURL=function(...args){
        const value=Reflect.apply(create,this,args);
        if(rows.length<512){const row={id:rows.length+1,bytes:args[0].size,createdAt:Date.now(),revokedAt:null};rows.push(row);byURL.set(value,row);}else overflow=true;
        publish();return value;
    };
    URL.revokeObjectURL=function(...args){const value=Reflect.apply(revoke,this,args),row=byURL.get(args[0]);if(row){row.revokedAt=Date.now();byURL.delete(args[0]);}publish();return value;};
    document.addEventListener('DOMContentLoaded',publish,{once:true});publish();
}
