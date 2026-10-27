import {writeFile,mkdir,copyFile,appendFile} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import path from 'node:path';
import {buildSite} from './build.mjs';
import {packageRelease} from './package-release.mjs';
import {verifyArtifact,gitSource} from './lib/release-artifact.mjs';
import {verifyReleaseGates} from './lib/release-gates.mjs';
import {preparePublicSnapshot} from './lib/site-history.mjs';
import {fetchPublishedDelivery} from './lib/release-history.mjs';
import {readWorkflowInventory,validateWorkflowInventory,checkDispatchContext,assertExpectedBuild,assertExpectedSite,assertPagesConfiguration,assertVersionAvailable,validateDelivery,ghJSON,fileSHA256,immutableGateEvidence} from './lib/pages-release.mjs';
checkDispatchContext();
await validateWorkflowInventory(await readWorkflowInventory());
const source=gitSource();if(source.dirty||source.commit!==process.env.GITHUB_SHA)throw Error('Wrong/dirty checkout.');
if(process.env.PUBLISH_SITE==='true')assertPagesConfiguration(ghJSON(`repos/${process.env.GITHUB_REPOSITORY}/pages`),ghJSON(`repos/${process.env.GITHUB_REPOSITORY}/environments/github-pages`),ghJSON(`repos/${process.env.GITHUB_REPOSITORY}/environments/github-pages/deployment-branch-policies`));
const candidate=await buildSite({output:'build/pages-candidate'});
const checkedGates=await verifyReleaseGates({directory:candidate.directory}),promotion=Boolean(process.env.PROMOTE_VERSION);
let preparedDirectory=checkedGates.preparedDirectory,receipt=immutableGateEvidence(checkedGates),manifest,delivery,expected;
if(promotion){
    const published=await fetchPublishedDelivery(process.env.PROMOTE_VERSION,{outputDirectory:'build/pages-promotion'});
    preparedDirectory=published.directory;receipt=published.receipt;manifest=published.manifest;delivery=published.deliveryDirectory;expected=published.expected;
}else{
    manifest=await verifyArtifact(preparedDirectory,{publicOnly:true,requireClean:true});delivery=path.resolve('build/pages-delivery');await mkdir(delivery);
    const pkg=await packageRelease(preparedDirectory,{output:delivery});
    await copyFile(path.join(preparedDirectory,'release-manifest.json'),path.join(delivery,'release-manifest.json'));
    await writeFile(path.join(delivery,'release-gates.json'),JSON.stringify(receipt,null,2)+'\n',{flag:'wx'});
    expected={source:source.commit,build:manifest.release.buildId,manifest:await fileSHA256(path.join(delivery,'release-manifest.json')),receipt:await fileSHA256(path.join(delivery,'release-gates.json')),zip:pkg.sha256};
}
assertExpectedBuild(process.env.PUBLISH_SITE,process.env.EXPECTED_BUILD,manifest.release.buildId);
const checked=await validateDelivery(delivery,expected,{allowBaselineHistory:promotion});assertVersionAvailable(manifest,checked.assets);
const snapshot=await preparePublicSnapshot({currentDirectory:preparedDirectory,outputDirectory:'build/pages-snapshot',historyDirectory:'build/pages-history'});
assertExpectedSite(process.env.PUBLISH_SITE,process.env.EXPECTED_SITE_ID,snapshot.manifest.siteId);
const siteManifestSHA=await fileSHA256(path.join(snapshot.directory,'site-manifest.json'));
// Equivalent to the official Pages upload composite, with the nested upload
// action pinned independently. Only the verified static snapshot enters this tar.
const tar=path.join(process.env.RUNNER_TEMP,'artifact.tar');execFileSync('tar',['--hard-dereference','-cf',tar,'--directory',snapshot.directory,'.'],{windowsHide:true});
const outputs={build_id:manifest.release.buildId,core_source:manifest.release.source.commit,promotion:String(promotion),site_id:snapshot.manifest.siteId,site_manifest_sha:siteManifestSHA,version:manifest.release.version,delivery_directory:delivery,pages_tar:tar,manifest_sha:expected.manifest,receipt_sha:expected.receipt,zip_sha:expected.zip};
await appendFile(process.env.GITHUB_OUTPUT,Object.entries(outputs).map(([key,value])=>`${key}=${value}\n`).join(''));
console.log(JSON.stringify({prepared:true,promotion,controllerSource:source.commit,coreSource:manifest.release.source.commit,checkedAt:checkedGates.verifiedAt,buildId:manifest.release.buildId,siteId:snapshot.manifest.siteId,siteManifestSHA256:siteManifestSHA,previousSiteId:snapshot.plan.liveSiteId,previousDeployment:snapshot.plan.deployment,history:snapshot.history,gates:checkedGates.gates.map(g=>({kind:g.kind,runId:g.runId,reused:g.reused})),zipSHA256:expected.zip}));
