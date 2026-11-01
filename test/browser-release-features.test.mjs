import test from 'node:test';
import assert from 'node:assert/strict';
import {browserReleaseFeatures,fontReflowRequired,operatorValidationRequired,quantizationValidationRequired,legacyShapeValidationRequired} from './browser/release-features.mjs';
import {partialRuntimeIORequired} from './browser/release-features.mjs';

test('partial runtime IO is required for current and unknown candidates, while exact published history remains compatible',()=>{
    for(const version of ['0.2.0-preview.7','0.2.0-preview.34','1.0.0','1.0.1','1.1.0','1.2.0','1.2.1','1.3.0','1.3.1','1.4.0'])assert.equal(partialRuntimeIORequired(version),false,version);
    for(const version of ['1.4.1','1.4.2','1.4.3','2.0.0','1.4.0+company.1','0.2.0-preview.35'])assert.equal(partialRuntimeIORequired(version),true,version);
    for(const version of [null,'candidate','v1.4.1'])assert.throws(()=>partialRuntimeIORequired(version));
});

test('legacy shape checks skip exact older immutable releases and remain required for new or unknown labels',()=>{
    for(const v of ['0.2.0-preview.7','0.2.0-preview.34','1.0.0','1.0.1','1.1.0','1.2.0','1.2.1','1.3.0','1.3.1','1.4.0'])assert.equal(legacyShapeValidationRequired(v),false,v);
    for(const v of ['1.4.1','1.4.2','1.4.3','1.5.0','2.0.0','1.4.0+company.1','0.2.0-preview.35'])assert.equal(legacyShapeValidationRequired(v),true,v);
    for(const v of [null,'candidate','v1.4.1'])assert.throws(()=>legacyShapeValidationRequired(v));
});
const all={demoRuntime:true,inputCleanup:true,workspaceStorage:true,desktopRuntimeRSS:true};

test('quantization browser coverage skips only exact immutable pre-feature releases',()=>{
    for(const version of ['0.2.0-preview.7','0.2.0-preview.34','1.0.0','1.0.1','1.1.0','1.2.0','1.2.1','1.3.0','1.3.1'])assert.equal(quantizationValidationRequired(version),false,version);
    for(const version of ['1.4.0','1.4.2','1.4.3','2.0.0','1.3.2','1.3.1+company.1','0.2.0-preview.35'])assert.equal(quantizationValidationRequired(version),true,version);
    assert.throws(()=>quantizationValidationRequired('candidate'),/version/);
});

test('stable and future releases retain all current browser coverage',()=>{
    for(const version of ['1.0.0','1.0.1','1.1.0','1.4.2','1.4.3','2.0.0','1.0.1-rc.1','1.0.0+company.2','0.2.1'])assert.deepEqual(browserReleaseFeatures(version),all,version);
});
test('the preview28 published-demo boundary remains explicit',()=>{
    assert.equal(browserReleaseFeatures('0.2.0-preview.27').demoRuntime,false);assert.equal(browserReleaseFeatures('0.2.0-preview.28').demoRuntime,true);
});
test('the preview31 input-cleanup and RSS boundaries remain explicit',()=>{
    for(const feature of ['inputCleanup','desktopRuntimeRSS']){assert.equal(browserReleaseFeatures('0.2.0-preview.30')[feature],false);assert.equal(browserReleaseFeatures('0.2.0-preview.31')[feature],true);}
});
test('the preview34 workspace-storage boundary remains explicit',()=>{
    assert.equal(browserReleaseFeatures('0.2.0-preview.33').workspaceStorage,false);assert.equal(browserReleaseFeatures('0.2.0-preview.34').workspaceStorage,true);
});
test('immutable legacy previews cannot acquire unsupported modern scenarios',()=>{
    for(const n of [7,8,9,10,11,12,13,14,15,16,17,18,19,20,21,22,23,24,25,26])assert.deepEqual(browserReleaseFeatures(`0.2.0-preview.${n}`),{demoRuntime:false,inputCleanup:false,workspaceStorage:false,desktopRuntimeRSS:false});
});
test('unknown but valid labels cannot silently reduce required coverage',()=>{
    for(const version of ['0.2.0-beta.1','0.2.0-preview.12+repacked.1'])assert.deepEqual(browserReleaseFeatures(version),all,version);
});
test('missing or malformed release metadata fails selection instead of skipping tests',()=>{
    for(const version of [undefined,null,{},[],0,'','1','1.0','v1.0.0',' 1.0.0','1.0.0/../x','0.2.0-preview.0','0.2.0-preview.9007199254740992'])assert.throws(()=>browserReleaseFeatures(version),undefined,String(version));
});

test('font reflow is required for new sources while exact immutable pre-fix releases remain usable',()=>{
    for(const version of ['1.0.0','1.0.1','1.1.0','0.2.0-preview.1','0.2.0-preview.28','0.2.0-preview.34'])assert.equal(fontReflowRequired(version),false,version);
    for(const version of ['1.2.0','1.2.1','1.4.2','1.4.3','2.0.0','1.1.0+repacked.1','0.2.0-preview.35','0.2.0-preview.01','0.2.0-preview.12+repacked.1','0.2.1','1.2.0-rc.1'])assert.equal(fontReflowRequired(version),true,version);
});

test('font reflow cannot be skipped using missing or malformed release metadata',()=>{
    for(const version of [undefined,null,'','1.2','v1.2.0','1.2.0/../x','0.2.0-preview.0'])assert.throws(()=>fontReflowRequired(version));
});

test('per-OP validation is required for new releases without breaking exact immutable rollback labels',()=>{
    for(const v of ['1.0.0','1.0.1','1.1.0','1.2.0','1.2.1','0.2.0-preview.34'])assert.equal(operatorValidationRequired(v),false,v);
    for(const v of ['1.3.0','1.4.2','1.4.3','2.0.0','1.2.1+repacked.1','0.2.0-preview.35','0.2.0-preview.01'])assert.equal(operatorValidationRequired(v),true,v);
    for(const v of [undefined,null,'','v1.3.0','1.3.0/../x'])assert.throws(()=>operatorValidationRequired(v));
});
