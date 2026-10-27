import {writeFile,mkdir,copyFile,appendFile} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import path from 'node:path';
import {buildSite} from './build.mjs';
import {packageRelease} from './package-release.mjs';
import {verifyArtifact,gitSource} from './lib/release-artifact.mjs';
import {verifyReleaseGates} from './lib/release-gates.mjs';
import {readWorkflowInventory,validateWorkflowInventory,checkDispatchContext,assertExpectedBuild,assertPagesConfiguration,assertVersionAvailable,validateDelivery,ghJSON,fileSHA256,immutableGateEvidence} from './lib/pages-release.mjs';
checkDispatchContext();
await validateWorkflowInventory(await readWorkflowInventory());
const source=gitSource();if(source.dirty||source.commit!==process.env.GITHUB_SHA)throw Error('Wrong/dirty checkout.');
if(process.env.PUBLISH_SITE==='true')assertPagesConfiguration(ghJSON(`repos/${process.env.GITHUB_REPOSITORY}/pages`),ghJSON(`repos/${process.env.GITHUB_REPOSITORY}/environments/github-pages`),ghJSON(`repos/${process.env.GITHUB_REPOSITORY}/environments/github-pages/deployment-branch-policies`));
const candidate=await buildSite({output:'build/pages-candidate'});
const checkedGates=await verifyReleaseGates({directory:candidate.directory}),{preparedDirectory}=checkedGates,receipt=immutableGateEvidence(checkedGates);
assertExpectedBuild(process.env.PUBLISH_SITE,process.env.EXPECTED_BUILD,receipt.release.buildId);
const manifest=await verifyArtifact(preparedDirectory,{publicOnly:true,requireClean:true}),delivery=path.resolve('build/pages-delivery');await mkdir(delivery);
const pkg=await packageRelease(preparedDirectory,{output:delivery});
await copyFile(path.join(preparedDirectory,'release-manifest.json'),path.join(delivery,'release-manifest.json'));
await writeFile(path.join(delivery,'release-gates.json'),JSON.stringify(receipt,null,2)+'\n',{flag:'wx'});
const manifestSHA=await fileSHA256(path.join(delivery,'release-manifest.json')),receiptSHA=await fileSHA256(path.join(delivery,'release-gates.json'));
const checked=await validateDelivery(delivery,{source:source.commit,build:receipt.release.buildId,manifest:manifestSHA,receipt:receiptSHA,zip:pkg.sha256});assertVersionAvailable(manifest,checked.assets);
// Equivalent to the official Pages upload composite, with the nested upload
// action pinned independently. Only the verified static snapshot enters this tar.
const tar=path.join(process.env.RUNNER_TEMP,'artifact.tar');execFileSync('tar',['--hard-dereference','-cf',tar,'--directory',preparedDirectory,'.'],{windowsHide:true});
const outputs={build_id:receipt.release.buildId,version:receipt.release.version,delivery_directory:delivery,pages_tar:tar,manifest_sha:manifestSHA,receipt_sha:receiptSHA,zip_sha:pkg.sha256};
await appendFile(process.env.GITHUB_OUTPUT,Object.entries(outputs).map(([key,value])=>`${key}=${value}\n`).join(''));
console.log(JSON.stringify({prepared:true,checkedAt:checkedGates.verifiedAt,buildId:receipt.release.buildId,gates:receipt.gates.map(g=>({kind:g.kind,runId:g.runId,reused:g.reused})),zipSHA256:pkg.sha256}));
