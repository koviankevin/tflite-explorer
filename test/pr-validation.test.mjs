import {test} from 'node:test';
import assert from 'node:assert/strict';
import {prValidationPlan} from '../scripts/lib/pr-validation-plan.mjs';
test('documentation/evidence changes do not repeat unchanged runtime checks',()=>{
    assert.equal(prValidationPlan(['README.md','docs/new-result.json','release-evidence.json']).runtimeRequired,false);
    assert.equal(prValidationPlan(['scripts/lib/pages-release.mjs','.github/workflows/verified-pages.yml','test/pages-release.test.mjs']).runtimeRequired,false);
    assert.equal(prValidationPlan(['scripts/compose-site.mjs','scripts/lib/versioned-site.mjs','test/versioned-site.test.mjs']).runtimeRequired,false);
    assert.equal(prValidationPlan(['scripts/lib/site-browser-policy.mjs','test/site-browser-policy.test.mjs','test/browser/versioned-site.mjs']).runtimeRequired,false);
});
test('runtime, shipped documents, fixtures and unknown changes keep Node/build validation',()=>{
    for(const file of ['src/app.js','vendor/netron/tflite-schema.js','scripts/build.mjs','scripts/verify-export.mjs','docs/export-reports.md','docs/results/browser-lifecycle-2026-10-27.json','test/fixture.mjs','test/model.test.mjs','new-unknown-file'])assert.equal(prValidationPlan([file]).runtimeRequired,true,file);
});
test('only version labels can be excluded from dependency changes',()=>{
    const before={version:'1.0.0',type:'module',devDependencies:{yaml:'2.9.1'}},after={...before,version:'1.0.1'},lock={version:'1.0.0',packages:{'':{version:'1.0.0',devDependencies:{yaml:'2.9.1'}}}};
    assert.equal(prValidationPlan(['package.json','package-lock.json'],{packageBefore:before,packageAfter:after,lockBefore:lock,lockAfter:{...lock,version:'1.0.1',packages:{'':{...lock.packages[''],version:'1.0.1'}}}}).runtimeRequired,false);
    assert.equal(prValidationPlan(['package.json'],{packageBefore:before,packageAfter:{...after,devDependencies:{yaml:'other'}}}).runtimeRequired,true);
    assert.equal(prValidationPlan(['package.json']).runtimeRequired,true);
    assert.equal(prValidationPlan(['package.json'],{packageBefore:before,packageAfter:{...after,version:'invalid version'}}).runtimeRequired,true);
});
