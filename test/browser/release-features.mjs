// Selection shared by the hosted drivers. Keep the historical preview cutoffs
// explicit so immutable rollback releases retain their original capabilities.
export function browserReleaseFeatures(version){
    if(typeof version!=='string'||version.length>128||!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/.test(version))throw Error('Browser acceptance requires valid release version metadata.');
    const match=version.match(/^0\.2\.0-preview\.(\d+)$/),generation=match?Number(match[1]):Infinity;
    if(match&&(!Number.isSafeInteger(generation)||generation<1))throw Error('Invalid legacy preview generation.');
    // Only the named legacy family reduces coverage. Stable/future labels
    // require every current scenario rather than silently skipping unknowns.
    return {demoRuntime:generation>=28,inputCleanup:generation>=31,workspaceStorage:generation>=34,desktopRuntimeRSS:generation>=31};
}
