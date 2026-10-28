export const DESKTOP_ENGINE_BASE='https://koviankevin.github.io/tflite-explorer/';
export function desktopEngineSettings(env,platform){
    if(platform!=='linux'||env.GITHUB_ACTIONS!=='true'||env.GITHUB_REPOSITORY!=='koviankevin/tflite-explorer'||env.GITHUB_WORKFLOW!=='Desktop engine compatibility'||env.GITHUB_REF!=='refs/heads/main'||env.GITHUB_EVENT_NAME!=='workflow_dispatch')throw Error('Desktop engine acceptance is restricted to this repository on hosted main CI.');
    if(!['firefox','webkit'].includes(env.DESKTOP_ENGINE))throw Error('Expected the pinned Firefox or WebKit engine.');
    const target=env.DESKTOP_TARGET||'production';
    if(!['production','candidate'].includes(target))throw Error('Expected production or a fresh public candidate.');
    if(target==='candidate'){
        if(env.EXPECTED_BUILD||env.EXPECTED_SITE_ID)throw Error('Candidate identities must come from the fresh verified build.');
        return {engine:env.DESKTOP_ENGINE,target,expectedBuild:null,expectedSiteId:null,base:null};
    }
    if(!/^[a-f0-9]{16}$/.test(env.EXPECTED_BUILD||'')||!/^[a-f0-9]{64}$/.test(env.EXPECTED_SITE_ID||''))throw Error('Require exact public build and complete site IDs.');
    return {engine:env.DESKTOP_ENGINE,target,expectedBuild:env.EXPECTED_BUILD,expectedSiteId:env.EXPECTED_SITE_ID,base:DESKTOP_ENGINE_BASE};
}
