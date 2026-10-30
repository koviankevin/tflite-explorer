import test from 'node:test';
import assert from 'node:assert/strict';
import {browserReleaseFeatures} from './browser/release-features.mjs';
const all={demoRuntime:true,inputCleanup:true,workspaceStorage:true,desktopRuntimeRSS:true};

test('stable and future releases retain all current browser coverage',()=>{
    for(const version of ['1.0.0','1.0.1','1.1.0','2.0.0','1.0.1-rc.1','1.0.0+company.2','0.2.1'])assert.deepEqual(browserReleaseFeatures(version),all,version);
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
