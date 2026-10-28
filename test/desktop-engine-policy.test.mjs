import {test} from 'node:test';
import assert from 'node:assert/strict';
import {desktopEngineSettings,DESKTOP_ENGINE_BASE} from '../scripts/lib/desktop-engine-policy.mjs';

const env={GITHUB_ACTIONS:'true',GITHUB_REPOSITORY:'koviankevin/tflite-explorer',GITHUB_WORKFLOW:'Desktop engine compatibility',GITHUB_REF:'refs/heads/main',GITHUB_EVENT_NAME:'workflow_dispatch',DESKTOP_ENGINE:'firefox',EXPECTED_BUILD:'b279d3ea3f3d7ec5',EXPECTED_SITE_ID:'b68ad1da9211af5c8b39309954148f95131be0cea23508f166d028ec829340f1'};
test('desktop compatibility pins public production and explicit immutable identities',()=>{
    for(const engine of ['firefox','webkit'])assert.deepEqual(desktopEngineSettings({...env,DESKTOP_ENGINE:engine},'linux'),{engine,expectedBuild:env.EXPECTED_BUILD,expectedSiteId:env.EXPECTED_SITE_ID,base:DESKTOP_ENGINE_BASE});
});
test('desktop acceptance rejects local, foreign, PR, unpinned and arbitrary-engine execution before launching a browser',()=>{
    for(const [key,value] of Object.entries({GITHUB_ACTIONS:'false',GITHUB_REPOSITORY:'other/repo',GITHUB_WORKFLOW:'other',GITHUB_REF:'refs/pull/1/merge',GITHUB_EVENT_NAME:'push',DESKTOP_ENGINE:'../../chromium',EXPECTED_BUILD:'latest',EXPECTED_SITE_ID:''}))assert.throws(()=>desktopEngineSettings({...env,[key]:value},'linux'),key);
    assert.throws(()=>desktopEngineSettings(env,'win32'));
    assert.throws(()=>desktopEngineSettings(env,'darwin'));
});
