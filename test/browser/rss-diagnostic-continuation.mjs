// A completed numeric RSS failure stays the primary failure. Collect independent
// cold-page evidence only after that RSS browser and all owned processes exited.
export async function preserveRSSFailure(runRSS,runCold){
    let rss,original;
    try{rss=await runRSS();}
    catch(error){
        const value=error.desktopRuntimeRSS,evaluation=value?.evaluation;
        if(!runCold||value?.browserClosed!==true||value.processCleanup?.allReaped!==true||evaluation?.status!=='failed'||!evaluation.summary||!Array.isArray(evaluation.issues)||!evaluation.issues.length||!evaluation.issues.every(issue=>['closed-rss-slope','settled-rss-drift','peak-growth'].includes(issue)))throw error;
        original=error;
    }
    if(!original)return {rss,cold:runCold?await runCold():undefined};
    original.diagnosticContinuation={primaryPhase:'desktop-runtime-rss',originalFailurePreserved:true};
    try{original.runtimeModuleCold=await runCold();}
    catch(error){original.runtimeModuleCold=error.runtimeModuleCold;original.diagnosticContinuation.coldError=error.stack||String(error);}
    throw original;
}
