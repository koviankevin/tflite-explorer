import {readDeployedSite} from './deployment-history.mjs';
import {ghJSON,PAGES_WORKFLOW} from './pages-release.mjs';
import {PUBLIC_SITE} from './site-history.mjs';

const repository='koviankevin/tflite-explorer',prefix='repos/'+repository+'/';
const latest=prefix+'deployments?environment=github-pages&per_page=1';
const positive=value=>Number.isSafeInteger(value)&&value>0;

export async function readPagesPreparationBase(api=ghJSON){
    const deployments=await api(prefix+'deployments?environment=github-pages&per_page=10');
    if(!Array.isArray(deployments)||!deployments.length||deployments.length>10)throw Error('Pages deployment history is unavailable.');
    for(const deployment of deployments){
        if(!positive(deployment.id)||deployment.environment!=='github-pages'||deployment.ref!=='main'||
            deployment.performed_via_github_app?.id!==15368||!/^[a-f0-9]{40}$/.test(deployment.sha||''))throw Error('Untrusted Pages deployment history.');
        const statusPath=prefix+'deployments/'+deployment.id+'/statuses?per_page=100';
        const statuses=await api(statusPath),status=statuses?.[0];
        if(!Array.isArray(statuses)||!statuses.length||statuses.length>100)throw Error('Pages deployment status is unavailable.');
        if(status.state==='success')return readDeployedSite(route=>route===latest?[deployment]:route===statusPath?statuses:api(route));
        // Only a terminal failure in the same gated workflow can be skipped.
        // The caller still binds the successful deployment to the live site ID.
        if(status.state!=='failure'||status.environment_url!==PUBLIC_SITE)throw Error('Pages may still be changing. Wait for its deployment to finish.');
        const link=/^https:\/\/github\.com\/koviankevin\/tflite-explorer\/actions\/runs\/(\d+)\/job\/(\d+)$/.exec(status.log_url||'');
        if(!link)throw Error('Failed Pages deployment has no authenticated job.');
        const runId=Number(link[1]),jobId=Number(link[2]),job=await api(prefix+'actions/jobs/'+jobId);
        if(!positive(runId)||!positive(jobId)||job.id!==jobId||job.run_id!==runId||!positive(job.run_attempt)||
            job.head_sha!==deployment.sha||job.status!=='completed'||job.conclusion!=='failure'||
            !/^Publish site [a-f0-9]{64}$/.test(job.name||''))throw Error('Pages job is not a confirmed gated deployment failure.');
        const run=await api(prefix+'actions/runs/'+runId+'/attempts/'+job.run_attempt);
        if(run.id!==runId||run.run_attempt!==job.run_attempt||run.path!==PAGES_WORKFLOW||run.event!=='workflow_dispatch'||
            run.head_branch!=='main'||run.head_sha!==deployment.sha||run.repository?.full_name!==repository||
            run.head_repository?.full_name!==repository||!positive(run.repository.id)||run.head_repository.id!==run.repository.id||
            run.status!=='completed'||run.conclusion!=='failure')throw Error('Failed Pages workflow source or result differs.');
    }
    throw Error('No confirmed successful Pages deployment within the recent history.');
}
