import {execFileSync} from 'node:child_process';
import {mkdir,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {readDeployedSite,assertDeployedHistory} from './deployment-history.mjs';
import {parseLiveSite,readPublicSiteFile} from './site-history.mjs';
import {assertExpectedBuild,assertExpectedSite,assertVersionAvailable,fileSHA256,ghJSON,validateDelivery} from './pages-release.mjs';
import {sha256} from './release-artifact.mjs';

const archiveLimit=64*1024**2;
const extractDelivery=[
    'import pathlib,sys,zipfile',
    'root=pathlib.Path(sys.argv[2])',
    'with zipfile.ZipFile(sys.argv[1]) as archive:',
    ' entries=archive.infolist()',
    ' assert sorted(e.filename for e in entries)==sorted(sys.argv[3:])',
    ' assert all(not e.is_dir() and 0<e.file_size<=512*1024*1024 for e in entries)',
    ' for entry in entries:',
    "  with (root/entry.filename).open('xb') as target: target.write(archive.read(entry))"
].join('\n');

export async function resumePagesRelease(originalRun){
    const deployment=await readDeployedSite();
    if(deployment.legacy||String(deployment.runId)!==originalRun)throw Error('Resumption requires the current authoritative Pages run.');
    const raw=await readPublicSiteFile('site-manifest.json');
    if(!raw)throw Error('Deployed version manifest is unavailable.');
    const site=parseLiveSite(raw),current=site.current,release=current.release;
    assertDeployedHistory({liveSite:site},deployment);
    if(release.source.commit!==deployment.controllerSource)throw Error('Only a newly published core can resume its fixed Release.');
    assertExpectedBuild('true',process.env.EXPECTED_BUILD,release.buildId);
    assertExpectedSite('true',process.env.EXPECTED_SITE_ID,site.siteId);

    const repo=process.env.GITHUB_REPOSITORY,route='repos/'+repo+'/actions/';
    const artifacts=ghJSON(route+'runs/'+deployment.runId+'/artifacts?per_page=100');
    if(artifacts.total_count!==artifacts.artifacts?.length)throw Error('Incomplete original artifact list.');
    const matches=artifacts.artifacts.filter(artifact=>artifact.name==='release-delivery');
    const [artifact]=matches;
    if(matches.length!==1||artifact.expired!==false||!Number.isSafeInteger(artifact.id)||artifact.id<=0||
        !Number.isSafeInteger(artifact.size_in_bytes)||artifact.size_in_bytes<=0||artifact.size_in_bytes>archiveLimit)throw Error('Original release bundle is missing or ambiguous.');

    const archive=execFileSync(process.env.GH_BIN||'gh',['api',route+'artifacts/'+artifact.id+'/zip'],{timeout:90000,maxBuffer:archiveLimit,windowsHide:true});
    if(archive.length!==artifact.size_in_bytes||artifact.digest!=='sha256:'+sha256(archive))throw Error('Original release archive hash or size differs.');
    const archivePath=path.join(process.env.RUNNER_TEMP,'original-release-delivery.zip');
    await writeFile(archivePath,archive,{flag:'wx'});
    const zipName='model-lens-public-'+release.version+'-'+release.buildId+'.zip';
    const delivery=path.resolve('build/pages-delivery');
    await mkdir(delivery,{recursive:true});
    execFileSync(process.env.PYTHON_BIN||(process.platform==='win32'?'python':'python3'),['-I','-c',extractDelivery,
        archivePath,delivery,'release-manifest.json','release-gates.json',zipName,zipName+'.sha256'],{timeout:30000,windowsHide:true});
    const expected={source:release.source.commit,build:release.buildId,manifest:current.manifestSHA256,
        receipt:await fileSHA256(path.join(delivery,'release-gates.json')),zip:await fileSHA256(path.join(delivery,zipName))};
    const bundle=await validateDelivery(delivery,expected);
    assertVersionAvailable(bundle.manifest,bundle.assets);
    return {build_id:release.buildId,core_source:release.source.commit,promotion:'false',site_id:site.siteId,
        site_manifest_sha:sha256(raw),version:release.version,delivery_directory:delivery,
        manifest_sha:expected.manifest,receipt_sha:expected.receipt,zip_sha:expected.zip};
}
