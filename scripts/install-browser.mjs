import {readFile} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import {pathToFileURL} from 'node:url';

export function browserRunnerAllowed(env,platform,release){
    return platform==='linux'&&env.GITHUB_ACTIONS==='true'&&env.GITHUB_REPOSITORY==='koviankevin/tflite-explorer'&&/^ID=ubuntu$/m.test(release)&&/^VERSION_ID="24\.04"$/m.test(release);
}
export function ubuntuMirrorText(text){
    if(typeof text!=='string'||!text.trim()||text.length>65536)throw Error('Invalid runner mirror list.');
    // Only substitute official Ubuntu endpoints. Package names, suites, GPG
    // keys and Playwright's pinned dependency installation remain unchanged.
    return text.replace(/https?:\/\/azure\.archive\.ubuntu\.com\/ubuntu\/?(?=\s|$)/g,'https://archive.ubuntu.com/ubuntu')
        .replace(/http:\/\/(archive|security)\.ubuntu\.com\/ubuntu\/?(?=\s|$)/g,'https://$1.ubuntu.com/ubuntu');
}
export async function installBrowser(){
    if(process.platform!=='linux'||process.env.GITHUB_ACTIONS!=='true')throw Error('Browser installation is restricted to hosted Linux CI.');
    const release=await readFile('/etc/os-release','utf8');
    if(!browserRunnerAllowed(process.env,process.platform,release))throw Error('Expected this repository on Ubuntu 24.04 CI.');
    const file='/etc/apt/apt-mirrors.txt',before=await readFile(file,'utf8'),after=ubuntuMirrorText(before);
    if(after!==before){execFileSync('sudo',['-n','tee',file],{input:after,stdio:['pipe','pipe','inherit'],timeout:10000});console.log('Using official Ubuntu HTTPS mirrors; apt signature checks unchanged.');}
    execFileSync(process.execPath,['node_modules/playwright/cli.js','install','--with-deps','chromium'],{stdio:'inherit'});
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href)await installBrowser();
