export function validatePerformancePolicy(policy) {
    if(policy?.format!=='model-lens-performance-policy' || policy.version!==1 || !Number.isInteger(policy.samplesPerCase) || policy.samplesPerCase<2 || policy.samplesPerCase>5 || !Number.isInteger(policy.childTimeoutMs) || policy.childTimeoutMs<1000 || policy.childTimeoutMs>120000 || !Array.isArray(policy.cases) || !policy.cases.length || policy.cases.length>10 || !policy.reference || typeof policy.reference.platform!=='string' || typeof policy.reference.arch!=='string' || !Number.isInteger(policy.reference.nodeMajor) || typeof policy.reference.runnerImage!=='string')throw new Error('Invalid performance policy.');
    const ids=new Set();
    if(!/^\d+\.\d+\.\d+$/.test(policy.reference.nodeVersion) || Number(policy.reference.nodeVersion.split('.')[0])!==policy.reference.nodeMajor)throw new Error('Reference Node version must be fixed.');
    for(const c of policy.cases) {
        if(!/^[a-z0-9-]{1,40}$/.test(c.id) || ids.has(c.id) || !['virtual-tflite','generic-mlir'].includes(c.fixture?.kind))throw new Error('Invalid or duplicate performance case.');ids.add(c.id);
        if(!c.limits || !c.expected || Object.keys(c.limits).length<2 || !Object.keys(c.expected).length)throw new Error('Performance case needs limits and functional expectations.');
        for(const [key,max] of Object.entries(c.limits))if(!/^[A-Za-z][A-Za-z0-9]+$/.test(key) || !Number.isFinite(max) || max<0)throw new Error('Invalid performance limit.');
        if(!(c.limits.maxRSSBytes>0) || !(c.limits.parseMs>0))throw new Error('RSS and parse limits are required.');
        const metrics=c.fixture.kind==='virtual-tflite'?['searchMsMax','patternMs','cancelMs','overviewMs','bytesRead','maxReadBytes','localNodes']:['patternMs','exportMs','reopenMs','repeatExportMs','discoveryMs','pageMsMax','outputBytes','pathWorkMax','displayHelpersMax','newMaterializationsAfterWarmup'];
        const checks=c.fixture.kind==='virtual-tflite'?['layers','matches','searchExact','truncated','cancelResponsive','overviewNodes','virtual']:['layers','blocks','matches','reopenedMatches','ssaValid','pathResolved','cachedPageWork','cachedPageHits','exportStableAfterPaging'];
        if(metrics.some(k=>!Object.hasOwn(c.limits,k)) || checks.some(k=>!Object.hasOwn(c.expected,k)))throw new Error('A required performance measurement or functional check is missing.');
        if(!Number.isSafeInteger(c.fixture.bytes) || c.fixture.bytes<=0)throw new Error('Fixed fixture bytes are required.');
        if(c.fixture.kind==='virtual-tflite' && (!Number.isInteger(c.fixture.repeats) || c.fixture.repeats<1 || c.fixture.repeats>10000 || !Number.isSafeInteger(c.fixture.weightBytes) || c.fixture.weightBytes<1024**3 || !/^[a-f0-9]{64}$/.test(c.fixture.headerSHA256)))throw new Error('Invalid fixed virtual fixture.');
        if(c.fixture.kind==='generic-mlir' && (!Number.isInteger(c.fixture.hidden) || c.fixture.hidden<20000 || c.fixture.hidden>30000 || !/^[a-f0-9]{64}$/.test(c.fixture.sha256)))throw new Error('Invalid fixed MLIR fixture.');
    }
    return policy;
}
export function evaluatePerformanceSample(c,sample) {
    const issues=[];
    if(sample?.caseId!==c.id || sample?.status!=='measured')issues.push('measurement-missing-or-failed');
    for(const [key,value] of Object.entries(c.fixture))if(sample?.fixture?.[key]!==value)issues.push(`fixture.${key}`);
    for(const [key,max] of Object.entries(c.limits)) {
        const value=sample?.metrics?.[key];if(typeof value!=='number' || !Number.isFinite(value) || value<0 || value>max || (max>0 && value===0))issues.push(`limit.${key}`);
    }
    for(const [key,value] of Object.entries(c.expected))if(sample?.checks?.[key]!==value)issues.push(`check.${key}`);
    return issues;
}
export function evaluatePerformanceRun(policy,samples) {
    validatePerformancePolicy(policy);const issues=[],seen=new Set();
    for(const sample of samples) {
        const c=policy.cases.find(c=>c.id===sample.caseId),key=`${sample.caseId}:${sample.iteration}`;
        if(!c || !Number.isInteger(sample.iteration) || sample.iteration<1 || sample.iteration>policy.samplesPerCase || seen.has(key)){issues.push({sample:key,issues:['unknown-duplicate-or-invalid-sample']});continue;}
        seen.add(key);const failures=evaluatePerformanceSample(c,sample);if(failures.length)issues.push({sample:key,issues:failures});
    }
    for(const c of policy.cases)for(let i=1;i<=policy.samplesPerCase;i++)if(!seen.has(`${c.id}:${i}`))issues.push({sample:`${c.id}:${i}`,issues:['missing-sample']});
    return {status:issues.length?'failed':'passed',issues};
}
