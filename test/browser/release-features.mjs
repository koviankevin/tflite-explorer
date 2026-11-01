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

// These exact published releases predate the in-flight font reflow fix. Other
// labels, including repackaged/unknown previews, cannot silently skip the check.
export function fontReflowRequired(version){
    browserReleaseFeatures(version);
    const preview=/^0\.2\.0-preview\.([1-9]\d*)$/.exec(version);
    const immutablePreview=preview&&Number(preview[1])>=1&&Number(preview[1])<=34;
    return !immutablePreview&&!['1.0.0','1.0.1','1.1.0'].includes(version);
}

export function operatorValidationRequired(version){
    browserReleaseFeatures(version);
    const preview=/^0\.2\.0-preview\.([1-9]\d*)$/.exec(version);
    return !(preview&&Number(preview[1])<=34)&&!['1.0.0','1.0.1','1.1.0','1.2.0','1.2.1'].includes(version);
}

export function quantizationValidationRequired(version){
    browserReleaseFeatures(version);
    const preview=/^0\.2\.0-preview\.([1-9]\d*)$/.exec(version);
    return !(preview&&Number(preview[1])<=34)&&!['1.0.0','1.0.1','1.1.0','1.2.0','1.2.1','1.3.0','1.3.1'].includes(version);
}

export function legacyShapeValidationRequired(version){
    browserReleaseFeatures(version);
    const preview=/^0\.2\.0-preview\.([1-9]\d*)$/.exec(version);
    return !(preview&&Number(preview[1])<=34)&&!['1.0.0','1.0.1','1.1.0','1.2.0','1.2.1','1.3.0','1.3.1','1.4.0'].includes(version);
}

// The partial runtime archive correction ships in the same unpublished 1.4.1
// candidate. Only exact immutable older releases may omit its new scenario.
export function partialRuntimeIORequired(version){return legacyShapeValidationRequired(version);}
