// Fail early on native diagnostic access, in a separate owned browser. This
// snapshot is never used as an application RSS sample or a heap subtraction.
import assert from 'node:assert/strict';
import {randomBytes} from 'node:crypto';
import {gitSource} from '../../scripts/lib/release-artifact.mjs';
import {OwnedProcessTree,readProcessTable,findOwnedBrowserRoot,waitOwnedProcessExit} from './owned-processes.mjs';
import {installedFirefoxReporterProof} from './firefox-native-memory-report.mjs';
import {nativeReportDirectory,captureFirefoxSignalReport} from './firefox-native-signal-report.mjs';

export async function firefoxNativeAccessProbe(browserType){
    const source=gitSource(),report={format:'model-lens-firefox-native-access',version:1,status:'failed',source,browserClosed:false,modelsLoaded:0,runtimeInvocations:0,forcedGC:false,errors:[]};
    let browser,context,tree,failure,temp;
    try{
        const proof=installedFirefoxReporterProof(browserType.executablePath());report.sourceProof=proof;
        temp=await nativeReportDirectory();report.nativeTemp=temp.record;
        const marker=randomBytes(16).toString('hex');browser=await browserType.launch({headless:true,env:{...process.env,TMPDIR:temp.directory,MODEL_LENS_PHYSICAL_OWNER:marker}});report.browserVersion=browser.version();
        const root=await findOwnedBrowserRoot(await readProcessTable(),process.pid,marker);tree=new OwnedProcessTree(root);report.ownership={root,parentPid:process.pid,method:'direct Node child plus exact per-launch random environment marker'};
        context=await browser.newContext();await context.newPage();
        report.nativeMemory=await captureFirefoxSignalReport({root,parentPid:process.pid,marker,executable:browserType.executablePath(),temp,publicOnly:true,browserVersion:report.browserVersion});
    }catch(error){failure=error;if(error.firefoxNativeMemory)report.nativeMemory=error.firefoxNativeMemory;report.error=error.stack||String(error);}
    finally{
        // Discover diagnostic descendants before normal closure; never adopt
        // processes by name or claim that unobserved short-lived PIDs were seen.
        if(tree)try{tree.sample(await readProcessTable());report.ownedProcesses=tree.identities;}catch(error){failure ||= error;report.errors.push('Ownership: '+error.message);}
        try{await context?.close();await browser?.close();report.browserClosed=Boolean(browser);}catch(error){failure ||= error;report.errors.push('Close: '+error.message);}
        if(tree)try{report.processCleanup=await waitOwnedProcessExit(tree);assert.equal(report.processCleanup.allReaped,true);}catch(error){failure ||= error;report.errors.push('Reap: '+error.message);}
        if(temp)try{await temp.cleanup({browserClosed:report.browserClosed,processCleanup:report.processCleanup});}catch(error){failure ||= error;report.errors.push('Native report cleanup: '+error.message);}
        const end=gitSource();report.sourceUnchanged=end.commit===source.commit&&end.tree===source.tree&&!end.dirty;
        if(!report.sourceUnchanged)failure ||= Error('Native probe source changed');
    }
    if(failure)throw Object.assign(failure,{firefoxNativeAccess:report});report.status='passed';return report;
}
