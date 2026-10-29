// Diagnostics never turn a failed original RSS acceptance into success.
export async function afterRSSDiagnostics(run,collect){
    if(!collect)return run();
    let outcome,original;
    try{outcome=await run();}catch(error){
        const r=error?.desktopRuntimeRSS,e=r?.evaluation;
        if(error?.diagnosticContinuation?.originalFailurePreserved!==true||r?.browserClosed!==true||r.processCleanup?.allReaped!==true||e?.status!=='failed'||!e.summary||!Array.isArray(e.issues)||!e.issues.length||!e.issues.every(i=>['closed-rss-slope','settled-rss-drift','peak-growth'].includes(i)))throw error;
        original=error;
    }
    try{const diagnostic=await collect();if(original){original.firefoxNativeControl=diagnostic;throw original;}return {...outcome,firefoxNativeControl:diagnostic};}
    catch(error){if(!original||error===original)throw error;original.diagnosticContinuation.nativeMemoryError=error?.stack||String(error);if(error?.firefoxNativeControl)original.firefoxNativeControl=error.firefoxNativeControl;throw original;}
}
