// Page lifetime bindings are kept together so navigation can be tested at the
// same boundary that calls the real save session and fingerprint controller.
export function editRecoveryLifecycle({session,fingerprint,document:doc,window:win}){
    const hidden=()=>{if(doc.visibilityState==='hidden')session.flush();};
    // pagehide may run after the document loses its active browsing context.
    // New module Workers are then forbidden. Preserve the unsaved session for
    // bfcache restoration, but cancel incomplete fingerprint preparation.
    const hide=()=>{session.suspend();fingerprint.cancel();};
    const show=()=>session.resume();
    doc.addEventListener('visibilitychange',hidden);win.addEventListener('pagehide',hide);win.addEventListener('pageshow',show);
    return ()=>{doc.removeEventListener('visibilitychange',hidden);win.removeEventListener('pagehide',hide);win.removeEventListener('pageshow',show);};
}
