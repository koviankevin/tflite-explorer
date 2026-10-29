// Numeric metadata only. Native Blob/Worker objects are never retained by this audit.
export function installRuntimeURLAudit(){
    const rows=[];Object.defineProperty(globalThis,'__runtimeURLAudit',{value:rows});
    const create=URL.createObjectURL,revoke=URL.revokeObjectURL;
    URL.createObjectURL=function(blob){const url=create.call(this,blob);rows.push({url,bytes:blob.size,createdAt:Date.now(),revokedAt:null});return url;};
    URL.revokeObjectURL=function(url){for(const row of rows)if(row.url===url)row.revokedAt=Date.now();return revoke.call(this,url);};
}
