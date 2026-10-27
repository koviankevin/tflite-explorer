import {ghJSON,PAGES_WORKFLOW} from './pages-release.mjs';
import {LEGACY_DEPLOYMENT,SITE_BASELINE} from './release-baseline.mjs';

const repository='koviankevin/tflite-explorer',route='repos/'+repository+'/',siteURL='https://koviankevin.github.io/tflite-explorer/';
const positive=value=>Number.isSafeInteger(value)&&value>0;

// GitHub job metadata binds the deployed full-site ID without downloading an
// expiring artifact. A missing/deleted run or job fails closed.
export async function readDeployedSite(api=ghJSON){
    const deployments=await api(route+'deployments?environment=github-pages&per_page=1');
    if(!Array.isArray(deployments)||deployments.length!==1)throw Error('Latest authoritative Pages deployment is unavailable.');
    const deployment=deployments[0];
    if(!positive(deployment.id)||deployment.environment!=='github-pages'||deployment.ref!=='main'||deployment.performed_via_github_app?.id!==15368||typeof deployment.sha!=='string'||!/^[a-f0-9]{40}$/.test(deployment.sha))throw Error('Untrusted Pages deployment source.');
    const statuses=await api(route+'deployments/'+deployment.id+'/statuses?per_page=100'),status=statuses?.[0];
    if(!Array.isArray(statuses)||!statuses.length||statuses.length>100||status.state!=='success'||status.environment_url!==siteURL)throw Error('Latest Pages deployment is not a confirmed success; inspect it before replacing the site.');
    const link=/^https:\/\/github\.com\/koviankevin\/tflite-explorer\/actions\/runs\/(\d+)\/job\/(\d+)$/.exec(status.log_url||'');
    if(!link)throw Error('Pages deployment has no authenticated workflow job link.');
    const runId=Number(link[1]),jobId=Number(link[2]);if(!positive(runId)||!positive(jobId))throw Error('Invalid deployed run/job identity.');
    const job=await api(route+'actions/jobs/'+jobId);
    if(job.id!==jobId||job.run_id!==runId||!positive(job.run_attempt)||job.head_sha!==deployment.sha||job.status!=='completed'||job.conclusion!=='success')throw Error('Deployed job source, attempt or result differs.');
    const run=await api(route+'actions/runs/'+runId+'/attempts/'+job.run_attempt);
    if(run.id!==runId||run.run_attempt!==job.run_attempt||run.path!==PAGES_WORKFLOW||run.event!=='workflow_dispatch'||run.head_branch!=='main'||run.head_sha!==deployment.sha||run.repository?.full_name!==repository||run.head_repository?.full_name!==repository||!positive(run.repository.id)||run.repository.id!==run.head_repository.id||run.status!=='completed')throw Error('Untrusted deployed workflow attempt.');
    const bound=/^Publish site ([a-f0-9]{64})$/.exec(job.name||'');
    const legacy=!bound&&job.name==='deploy'&&deployment.id===LEGACY_DEPLOYMENT.deploymentId&&runId===LEGACY_DEPLOYMENT.runId&&jobId===LEGACY_DEPLOYMENT.jobId&&deployment.sha===LEGACY_DEPLOYMENT.source;
    if(!bound&&!legacy)throw Error('Deployment did not record its immutable full-site ID.');
    return {deploymentId:deployment.id,controllerSource:deployment.sha,runId,attempt:job.run_attempt,jobId,siteId:bound?.[1]??null,legacy};
}

export function assertDeployedHistory({liveSite,legacyRelease},deployment){
    if(deployment?.legacy===true){
        if(liveSite||deployment.deploymentId!==LEGACY_DEPLOYMENT.deploymentId||deployment.runId!==LEGACY_DEPLOYMENT.runId||deployment.jobId!==LEGACY_DEPLOYMENT.jobId||deployment.controllerSource!==SITE_BASELINE.source||legacyRelease?.version!==SITE_BASELINE.version||legacyRelease.buildId!==SITE_BASELINE.build||legacyRelease.source?.commit!==SITE_BASELINE.source)throw Error('HTTP history differs from the pinned original deployment.');
    }else if(!liveSite||deployment?.legacy!==false||typeof deployment.siteId!=='string'||!/^[a-f0-9]{64}$/.test(deployment.siteId)||liveSite.siteId!==deployment.siteId)throw Error('HTTP history differs from the latest deployed site ID; wait for CDN consistency or inspect the deployment.');
    return true;
}
