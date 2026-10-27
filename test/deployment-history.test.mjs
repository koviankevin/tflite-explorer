import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readDeployedSite,assertDeployedHistory} from '../scripts/lib/deployment-history.mjs';
import {LEGACY_DEPLOYMENT,SITE_BASELINE} from '../scripts/lib/release-baseline.mjs';

function fixture({legacy=false}={}){
    const source=legacy?SITE_BASELINE.source:'a'.repeat(40),runId=legacy?LEGACY_DEPLOYMENT.runId:31,jobId=legacy?LEGACY_DEPLOYMENT.jobId:71,id=legacy?LEGACY_DEPLOYMENT.deploymentId:91;
    const data={deployments:[{id,environment:'github-pages',ref:'main',sha:source,performed_via_github_app:{id:15368}}],statuses:[{state:'success',environment_url:'https://koviankevin.github.io/tflite-explorer/',log_url:`https://github.com/koviankevin/tflite-explorer/actions/runs/${runId}/job/${jobId}`}],job:{id:jobId,name:legacy?'deploy':'Publish site '+'1'.repeat(64),run_id:runId,run_attempt:1,head_sha:source,status:'completed',conclusion:'success'},run:{id:runId,run_attempt:1,path:'.github/workflows/verified-pages.yml',event:'workflow_dispatch',head_branch:'main',head_sha:source,repository:{id:42,full_name:'koviankevin/tflite-explorer'},head_repository:{id:42,full_name:'koviankevin/tflite-explorer'},status:'completed',conclusion:'success'}};
    const calls=[],api=async route=>{calls.push(route);assert.ok(route.startsWith('repos/koviankevin/tflite-explorer/'));if(route.endsWith('deployments?environment=github-pages&per_page=1'))return data.deployments;if(route.endsWith(`/deployments/${id}/statuses?per_page=100`))return data.statuses;if(route.endsWith('/actions/jobs/'+jobId))return data.job;if(route.endsWith(`/actions/runs/${runId}/attempts/1`))return data.run;throw Error('Unexpected source lookup.');};
    return {data,calls,api};
}

test('successful environment deployment binds the exact full-site ID through its authenticated job and attempt',async()=>{
    const f=fixture(),result=await readDeployedSite(f.api);assert.equal(result.siteId,'1'.repeat(64));assert.equal(result.legacy,false);assert.equal(result.controllerSource,'a'.repeat(40));assert.equal(result.runId,31);assert.equal(result.jobId,71);assert.ok(f.calls.some(s=>s.endsWith('/attempts/1')));assert.equal(assertDeployedHistory({liveSite:{siteId:result.siteId}},result),true);
});

test('root-only migration accepts exactly the independently verified original deployment',async()=>{
    const f=fixture({legacy:true}),result=await readDeployedSite(f.api),release={version:SITE_BASELINE.version,buildId:SITE_BASELINE.build,source:{commit:SITE_BASELINE.source}};
    assert.equal(result.legacy,true);assert.equal(result.siteId,null);assert.equal(assertDeployedHistory({liveSite:null,legacyRelease:release},result),true);
    await assert.rejects(readDeployedSite(fixture().api).then(value=>assertDeployedHistory({liveSite:null,legacyRelease:release},value)),/history/);
    f.data.job.name='deploy a different site';await assert.rejects(readDeployedSite(f.api),/record/);
    for(const key of ['deploymentId','runId','jobId'])assert.throws(()=>assertDeployedHistory({liveSite:null,legacyRelease:release},{...result,[key]:0}));
});

test('foreign, pending, failed or unbound deployment metadata cannot authorize history replacement',async()=>{
    const changes=[d=>d.deployments=[],d=>d.deployments[0].performed_via_github_app.id=1,d=>d.deployments[0].ref='feature',d=>d.statuses[0].state='queued',d=>d.statuses[0].state='failure',d=>d.statuses[0].environment_url='https://other.invalid/',d=>d.statuses[0].log_url='https://other.invalid/actions/runs/31/job/71',d=>d.job.run_id=32,d=>d.job.head_sha='b'.repeat(40),d=>d.job.status='in_progress',d=>d.job.conclusion='failure',d=>d.job.name='deploy',d=>d.run.head_repository.id=99,d=>d.run.head_branch='feature',d=>d.run.event='pull_request',d=>d.run.path='other.yml',d=>d.run.head_sha='b'.repeat(40),d=>d.run.status='in_progress'];
    for(const change of changes){const f=fixture();change(f.data);await assert.rejects(readDeployedSite(f.api));}
});

test('a stale HTTP index is rejected even if it names the same active core version',async()=>{
    const result=await readDeployedSite(fixture().api),current={siteId:'1'.repeat(64),current:{release:{buildId:'8'.repeat(16)}}},stale={...current,siteId:'0'.repeat(64)};
    assert.equal(assertDeployedHistory({liveSite:current},result),true);assert.throws(()=>assertDeployedHistory({liveSite:stale},result),/history/);assert.throws(()=>assertDeployedHistory({liveSite:null},result),/history/);
    assert.throws(()=>assertDeployedHistory({liveSite:{siteId:''}},{legacy:false,siteId:''}),/history/);
});

test('later Release failure does not erase a successful deployed site identity',async()=>{
    const f=fixture();f.data.run.conclusion='failure';const result=await readDeployedSite(f.api);assert.equal(result.siteId,'1'.repeat(64));assert.equal(result.deploymentId,91);
});
