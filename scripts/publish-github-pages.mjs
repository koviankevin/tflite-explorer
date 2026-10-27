// The local entry can dispatch the gated workflow; it never pushes gh-pages.
import {execFileSync} from 'node:child_process';
import {verifyReleaseGates} from './lib/release-gates.mjs';
import {assertPagesConfiguration,ghJSON} from './lib/pages-release.mjs';
const args=process.argv.slice(2);if(args.length!==2||args[0]!=='--site-id'||!/^[a-f0-9]{64}$/.test(args[1]))throw Error('Usage: node scripts/publish-github-pages.mjs --site-id <exact site ID from successful preparation>');
const expectedSiteId=args[1];
const {release,repository,gates}=await verifyReleaseGates({directory:'dist'});
const main=ghJSON(`repos/${repository}/branches/main`);if(main.commit?.sha!==release.source.commit)throw Error('Publish only the exact current main commit.');
assertPagesConfiguration(ghJSON(`repos/${repository}/pages`),ghJSON(`repos/${repository}/environments/github-pages`),ghJSON(`repos/${repository}/environments/github-pages/deployment-branch-policies`));
const output=execFileSync(process.env.GH_BIN||'gh',['workflow','run','verified-pages.yml','--repo',repository,'--ref','main','-f','publish=true','-f',`expected_build_id=${release.buildId}`,'-f',`expected_site_id=${expectedSiteId}`],{encoding:'utf8',timeout:30000,windowsHide:true});
console.log(JSON.stringify({dispatched:true,expectedBuildId:release.buildId,expectedSiteId,source:release.source.commit,gates:gates.map(g=>({kind:g.kind,runId:g.runId})),workflow:output.trim()}));
