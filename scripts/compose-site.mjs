import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {composeSite,verifySite} from './lib/versioned-site.mjs';

export async function runSiteCLI(args){
    const options={retainedDirectories:[],publicOnly:true},seen=new Set();let verifyDirectory;
    const names={'--current':'currentDirectory','--legacy':'legacyDirectory','--out':'outputDirectory'};
    for(let i=0;i<args.length;i++){
        const flag=args[i];
        if(flag==='--internal'){if(seen.has(flag))throw Error('Duplicate --internal.');seen.add(flag);options.publicOnly=false;continue;}
        if(!['--verify','--retain',...Object.keys(names)].includes(flag))throw Error(`Unknown option: ${flag}`);
        const value=args[++i];if(!value||value.startsWith('--'))throw Error(`Missing value for ${flag}.`);
        if(flag!=='--retain'&&seen.has(flag))throw Error(`Duplicate option: ${flag}`);seen.add(flag);
        if(flag==='--verify')verifyDirectory=value;else if(flag==='--retain')options.retainedDirectories.push(value);else options[names[flag]]=value;
    }
    if(verifyDirectory){
        if(options.currentDirectory||options.legacyDirectory||options.outputDirectory||options.retainedDirectories.length)throw Error('--verify cannot be combined with assembly inputs.');
        const manifest=await verifySite(verifyDirectory,{publicOnly:options.publicOnly});return {status:'passed',operation:'verify',directory:path.resolve(verifyDirectory),siteId:manifest.siteId,currentBuild:manifest.current.release.buildId,legacyBuild:manifest.legacyRoot.release.buildId};
    }
    if(!options.currentDirectory||!options.outputDirectory)throw Error('Usage: node scripts/compose-site.mjs --current release-directory --legacy original-root-release --retain previous-release --out build/new-site [--internal]\nVerify: node scripts/compose-site.mjs --verify build/new-site [--internal]');
    if(options.retainedDirectories.length&&!options.legacyDirectory)throw Error('An upgrade with retained versions needs an explicit --legacy baseline; do not replace the original root release.');
    const {directory,manifest}=await composeSite(options);return {status:'passed',operation:'compose',directory,siteId:manifest.siteId,currentBuild:manifest.current.release.buildId,legacyBuild:manifest.legacyRoot.release.buildId,retainedBuilds:manifest.retainedBuildIds};
}

if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href){
    try{console.log(JSON.stringify(await runSiteCLI(process.argv.slice(2)),null,2));}catch(error){console.error(error.message);process.exitCode=1;}
}
