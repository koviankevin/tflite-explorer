import {readFile} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import {browserRunnerAllowed,ubuntuMirrorText} from './install-browser.mjs';
import {desktopPhysicalSettings} from './lib/desktop-physical-policy.mjs';
const {engine}=desktopPhysicalSettings(process.env,process.platform);
if(!browserRunnerAllowed(process.env,process.platform,await readFile('/etc/os-release','utf8')))throw Error('Expected hosted Ubuntu 24.04.');
const file='/etc/apt/apt-mirrors.txt',before=await readFile(file,'utf8'),after=ubuntuMirrorText(before);
if(after!==before)execFileSync('sudo',['-n','tee',file],{input:after,stdio:['pipe','pipe','inherit'],timeout:10000});
execFileSync(process.execPath,['node_modules/playwright/cli.js','install','--with-deps',engine],{stdio:'inherit'});
