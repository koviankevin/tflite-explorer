import {writeFile} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import path from 'node:path';
import {validateDelivery,expectedDelivery,assertVersionAvailable} from './lib/pages-release.mjs';
const report={format:'model-lens-published-release',version:1,status:'failed'};
try{
    const bundle=await validateDelivery('build/pages-delivery',expectedDelivery()),version=assertVersionAvailable(bundle.manifest,bundle.assets),repo=process.env.GITHUB_REPOSITORY,r=bundle.manifest.release;
    if(!version.exists){
        const notes=path.join(process.env.RUNNER_TEMP,'release-notes.md');await writeFile(notes,`模鏡 ${r.version}\n\n固定來源：${r.source.commit}\nBuild ID：${r.buildId}\n\n三項來源綁定驗收已通過，正式站 ${bundle.manifest.files.length} 個檔案已逐檔核對。\n工作流程：https://github.com/${repo}/actions/runs/${process.env.GITHUB_RUN_ID}\n\n模型全程在本機處理。公司私有 dialect 請依 docs/intranet-release.md 保留擴充並重新建置內網包。\n`,{flag:'wx'});
        const args=['release','create',version.tag,...bundle.assets.map(a=>path.join('build/pages-delivery',a.name)),'--repo',repo,'--target',r.source.commit,'--title',`模鏡 ${r.version}`,'--notes-file',notes];if(r.version.includes('-'))args.push('--prerelease');execFileSync(process.env.GH_BIN||'gh',args,{stdio:'inherit',windowsHide:true,timeout:90000});
    }
    const confirmed=assertVersionAvailable(bundle.manifest,bundle.assets);if(!confirmed.exists)throw Error('Release not present after create.');
    Object.assign(report,{status:'passed',url:confirmed.url,release:r,assets:bundle.assets});
}catch(error){report.error=error.message;process.exitCode=1;}
finally{await writeFile(path.join(process.env.RUNNER_TEMP,'pages-release-report.json'),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report));}
