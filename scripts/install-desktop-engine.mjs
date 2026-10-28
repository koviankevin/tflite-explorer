import {readFile} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import {browserRunnerAllowed,ubuntuMirrorText} from './install-browser.mjs';
import {desktopEngineSettings} from './lib/desktop-engine-policy.mjs';

// Deliberately separate from the existing Chromium release installer. Running
// this optional compatibility check must not invalidate its measured closure.
const {engine}=desktopEngineSettings(process.env,process.platform);
if(!browserRunnerAllowed(process.env,process.platform,await readFile('/etc/os-release','utf8')))throw Error('Expected the hosted Ubuntu 24.04 runner.');
const file='/etc/apt/apt-mirrors.txt',before=await readFile(file,'utf8'),after=ubuntuMirrorText(before);
if(after!==before)execFileSync('sudo',['-n','tee',file],{input:after,stdio:['pipe','pipe','inherit'],timeout:10000});
execFileSync(process.execPath,['node_modules/playwright/cli.js','install','--with-deps',engine],{stdio:'inherit'});
