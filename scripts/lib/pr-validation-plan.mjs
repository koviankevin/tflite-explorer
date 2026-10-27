// Unknown changes retain the existing full Node/build check. Known release
// tooling is covered by the mandatory release-contract job on the same PR.
export function prValidationPlan(files,{packageBefore,packageAfter,lockBefore,lockAfter}={}){
    const stripVersion=data=>{const copy=structuredClone(data);delete copy.version;if(copy.packages?.[''])delete copy.packages[''].version;return copy;};
    const version=data=>/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/.test(data?.version||'');
    const same=(a,b)=>version(a)&&version(b)&&JSON.stringify(stripVersion(a))===JSON.stringify(stripVersion(b));
    const releaseTools=new Set(["scripts/lib/release-baseline.mjs","test/published-delivery.test.mjs","scripts/lib/live-site.mjs","test/live-site.test.mjs","scripts/lib/site-history.mjs","test/site-history.test.mjs","scripts/lib/release-history.mjs","test/release-history.test.mjs","scripts/lib/site-browser-policy.mjs","test/site-browser-policy.test.mjs","test/browser/versioned-site.mjs","scripts/compose-site.mjs","scripts/lib/versioned-site.mjs","test/versioned-site.test.mjs",'scripts/accept-release-contract.mjs','scripts/publish-github-pages.mjs','scripts/verify-release-gates.mjs','scripts/drill-release-rollback.mjs','scripts/prepare-pages-release.mjs','scripts/verify-pages-live.mjs','scripts/publish-release-bundle.mjs','scripts/plan-pr-validation.mjs','scripts/lib/release-gates.mjs','scripts/lib/release-test-plan.mjs','scripts/lib/pages-release.mjs','scripts/lib/pr-validation-plan.mjs','test/release.test.mjs','test/release-gates.test.mjs','test/pages-release.test.mjs','test/pr-validation.test.mjs','test/browser/production-smoke.mjs']);
    const runtime=[];
    for(const file of files){
        if(file==='package.json'&&same(packageBefore,packageAfter)||file==='package-lock.json'&&same(lockBefore,lockAfter))continue;
        if(file==='release-evidence.json'||file==='README.md'||file.startsWith('.github/workflows/')||file.startsWith('docs/')&&file!=='docs/export-reports.md'&&file!=='docs/results/browser-lifecycle-2026-10-27.json'||releaseTools.has(file))continue;
        runtime.push(file);
    }
    return {runtimeRequired:runtime.length>0,reason:runtime.length?'runtime/build/test inputs changed; retain full Node/build check':'only documentation, evidence selection or release tooling; release-contract covers its scope',runtimeFiles:runtime};
}
