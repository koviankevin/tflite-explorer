import {mkdir,readFile,writeFile,cp,mkdtemp,rename,lstat} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {fixture} from '../test/fixture.mjs';
import {MLIR_BRANCH} from '../test/mlir-fixture.mjs';
import {root,gitSource,webSources,canonical,sha256,filesIn,writeManifest,verifyArtifact,buildDestination,buildEvent} from './lib/release-artifact.mjs';
import {readProfile,installProfile,copyWebTree} from './lib/build-profile.mjs';

export async function buildSite({output='dist',profile:profilePath}={}) {
    const destination=await buildDestination(output),profile=await readProfile(profilePath);
    if(profile.extension && destination===path.join(root,'dist'))throw new Error('內網建置必須使用獨立輸出，例如 --out build/internal。');
    await buildEvent({event:'create_intent',operation:'build',destination,kind:'temporary',producer:'scripts/build.mjs',purpose:'Fresh static release, no models or credentials copied',cleanup_condition:'Keep output until superseded; prior outputs are retained in build/previous for rollback.'});
    const stage=await mkdtemp(path.join(root,'build','.stage-'));
    const dest=name=>path.join(stage,name),source=name=>path.join(root,name);
    try {
        const included=webSources();
        await copyWebTree(source('vendor'),dest('vendor'),{include:name=>included.has('vendor/'+name)});
        await copyWebTree(source('src'),dest('src'),{include:name=>included.has('src/'+name)});
        await installProfile(stage,profile);
        let html=await readFile(source('vendor/netron/index.html'),'utf8');
        html=html.replace('<html lang="en">','<html lang="zh-Hant">')
            .replace('initial-scale=1.0, maximum-scale=1.0, user-scalable=no, viewport-fit=cover','initial-scale=1.0, viewport-fit=cover')
            .replace('<title>Netron</title>','<title>模鏡｜TFLite・MLIR 模型探索</title>')
            .replace('Visualizer for neural network, deep learning and machine learning models.','在本機搜尋 TFLite、MLIR operations、SSA values 與連接模式。')
            .replace("script-src 'self'; frame-src 'none'","default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; worker-src 'self'; connect-src 'self'; img-src 'self' data: blob:; style-src 'self' 'unsafe-inline'; frame-src 'none'; object-src 'none'; base-uri 'self'; form-action 'none'")
            .replace('<script type="text/javascript" src="index.js"></script>','<script type="module" src="src/app.js"></script>')
            .replaceAll('href="grapher.css"','href="vendor/netron/grapher.css"')
            .replaceAll('href="favicon.ico"','href="vendor/netron/favicon.ico"')
            .replaceAll('href="icon.png"','href="vendor/netron/icon.png"')
            .replace('<body class="welcome spinner">',`<body class="welcome">\n${await readFile(source('src/shell.html'),'utf8')}`);
        const styles=['app','pattern-workspace','mobile','model-visibility','typography','overview-canvas','explorer-resize','workspace','laptop','release','model-edit-workspace','model-tabs'];
        html=html.replace('</head>',styles.map(s=>`<link rel="stylesheet" href="src/${s}.css">`).join('\n')+'\n</head>');
        await writeFile(dest('index.html'),html);
        await writeFile(dest('.nojekyll'),'');
        const translations=new Map([['Node Properties','節點詳細資料'],['Tensor Properties','Tensor 詳細資料'],['Connection Properties','連接詳細資料'],['Model Properties','模型詳細資料'],['Graph Properties','Subgraph 詳細資料'],['Inputs','輸入'],['Outputs','輸出'],['Attributes','屬性']]);
        let view=await readFile(dest('vendor/netron/view.js'),'utf8');
        for(const [en,zh] of translations)view=view.replaceAll(`'${en}'`,`'${zh}'`);
        await writeFile(dest('vendor/netron/view.js'),view);
        for(const [name,options] of [['demo.tflite',{graphCount:2,repeats:4}],['lora-demo.tflite',{graphCount:1,variant:'lora'}]]) {
            const demo=fixture(options),buffer=new Uint8Array(demo.totalBytes);buffer.set(demo.data);await writeFile(dest(name),buffer);
        }
        await writeFile(dest('demo.mlir'),MLIR_BRANCH+'\n');
        await cp(source('vendor/netron/LICENSE'),dest('LICENSE-Netron.txt'));
        await cp(source('LICENSE'),dest('LICENSE'));
        // The offline verifier travels with both public and internal ZIPs.
        // Its relative import resolves the same pure report module as the UI.
        await mkdir(dest('tools'));
        await cp(source('scripts/verify-export.mjs'),dest('tools/verify-export.mjs'));
        await cp(source('docs/export-reports.md'),dest('tools/export-reports.md'));
        const pkg=JSON.parse(await readFile(source('package.json'),'utf8'));
        const release={schemaVersion:1,version:pkg.version,distribution:profile.distribution,extension:profile.extension,source:gitSource()};
        const files=await filesIn(stage),hashParts=[JSON.stringify(release)],modules=[];
        for(const name of files) {
            let bytes=await readFile(dest(name));
            if(/\.(m?js|css|html|json|svg|md|txt|py)$/i.test(name) || path.basename(name).startsWith('LICENSE')){bytes=canonical(bytes);await writeFile(dest(name),bytes);}
            hashParts.push(name,sha256(bytes));if(name.endsWith('.js'))modules.push(name);
        }
        release.buildId=sha256(Buffer.from(hashParts.join('\n'))).slice(0,16);
        for(const name of modules) {
            const text=await readFile(dest(name),'utf8');
            const stamped=text.replace(/(\b(?:from\s*|import\s*(?:\(\s*)?|new\s+URL\(\s*))(['"`])([^'"`\r\n]*\.js)\2/g,(all,prefix,quote,url)=>url.startsWith('.')?`${prefix}${quote}${url}?v=${release.buildId}${quote}`:all);
            await writeFile(dest(name),stamped);
        }
        html=(await readFile(dest('index.html'),'utf8')).replace(/((?:src|href)="(?:src|vendor)\/[^"?]+\.(?:js|css))"/g,`$1?v=${release.buildId}"`);
        await writeFile(dest('index.html'),html);
        await writeFile(dest('release.json'),JSON.stringify(release,null,2)+'\n');
        const manifest=await writeManifest(stage,release);await verifyArtifact(stage);
        // Preserve the prior directory before installing a complete fresh tree.
        // Neither the source checkout nor arbitrary paths can be renamed here.
        let previous=null;
        try {
            await lstat(destination);
            await buildEvent({event:'move_intent',operation:'replace-build',destination,stage,purpose:'Preserve previous generated output before replacement'});
            await mkdir(source('build/previous'),{recursive:true});
            previous=path.join(await mkdtemp(source('build/previous/release-')),'site');
            await rename(destination,previous);
        } catch(error){if(error.code!=='ENOENT')throw error;}
        await mkdir(path.dirname(destination),{recursive:true});
        try {await rename(stage,destination);} catch(error) {if(previous)await rename(previous,destination);throw error;}
        await buildEvent({event:'created',operation:'build',destination,previous,release,files:manifest.files.length});
        return {directory:destination,release,previous,files:manifest.files.length};
    } catch(error) {await buildEvent({event:'failed',operation:'build',stage,destination,error:error.message});throw error;}
}

if(process.argv[1] && path.resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
    const options={};
    for(let i=2;i<process.argv.length;i+=2) {
        const key=process.argv[i],value=process.argv[i+1];
        if(!['--out','--profile'].includes(key) || !value)throw new Error('Usage: node scripts/build.mjs [--out build/name] [--profile path/to/profile.json]');
        options[key==='--out'?'output':'profile']=value;
    }
    console.log(JSON.stringify(await buildSite(options)));
}
