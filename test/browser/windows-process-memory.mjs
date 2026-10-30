import assert from 'node:assert/strict';
import {spawn,execFileSync} from 'node:child_process';
import {once} from 'node:events';
import {createInterface} from 'node:readline';
import {fileURLToPath} from 'node:url';
const integer=n=>Number.isSafeInteger(n)&&n>0;
const ticks=n=>typeof n==='string'&&/^\d+$/.test(n);
export function windowsAllocatedBytes(python,file){
 assert.equal(process.platform,'win32');assert.ok(python);
 const result=JSON.parse(execFileSync(python,[fileURLToPath(new URL('./windows-process-memory.py',import.meta.url)),'--allocated-size',file],{encoding:'utf8',windowsHide:true,timeout:5000,maxBuffer:4096}));
 assert.ok(integer(result.allocatedBytes));return result.allocatedBytes;
}
export function validateWindowsRows(value,{memory=true}={}){
 if(!value||!Array.isArray(value.rows)||value.rows.length>1024||!Array.isArray(value.identities)||value.identities.length>1024||!ticks(value.observedAtNs))throw Error('Invalid native observation');
 const identities=new Set();for(const row of value.identities){if(!integer(row.pid)||!ticks(row.startTicks)||identities.has(row.pid+':'+row.startTicks))throw Error('Invalid native identity');identities.add(row.pid+':'+row.startTicks);}
 const pids=new Set();for(const row of value.rows){if(!integer(row.pid)||!Number.isSafeInteger(row.parent)||row.parent<0||!ticks(row.startTicks)||!identities.has(row.pid+':'+row.startTicks)||pids.has(row.pid)||row.state!=='R')throw Error('Unverified native row');pids.add(row.pid);if(memory&&(!integer(row.rssBytes)||!Number.isSafeInteger(row.privateCommitBytes)||row.privateCommitBytes<0))throw Error('Missing native memory counter');}
 return value;
}
export async function windowsProcessObserver({python,cdp,channel}){
 assert.equal(process.platform,'win32');assert.ok(['chrome','msedge'].includes(channel));assert.ok(python);
 const info=await cdp.send('SystemInfo.getProcessInfo'),roots=info.processInfo.filter(p=>p.type==='browser');assert.equal(roots.length,1);assert.ok(integer(roots[0].id));
 const child=spawn(python,['-u',fileURLToPath(new URL('./windows-process-memory.py',import.meta.url))],{windowsHide:true,stdio:['pipe','pipe','pipe']});
 let stderr='',closed=false,exitCode=null,pending=null,chain=Promise.resolve(),broken=null;
 child.stderr.on('data',b=>{stderr=(stderr+b.toString()).slice(-8192);});
 const lines=createInterface({input:child.stdout});lines.on('line',line=>{if(!pending)return;const item=pending;pending=null;clearTimeout(item.timer);try{assert.ok(line.length<=1024**2);const row=JSON.parse(line);if(row.ok!==true)throw Error(row.error||'Native failure');item.resolve(row.result??null);}catch(e){item.reject(e);}});
 child.on('exit',code=>{closed=true;exitCode=code;if(pending){clearTimeout(pending.timer);pending.reject(Error('Native observer exited: '+code+' '+stderr));pending=null;}});
 await once(child,'spawn');
 const request=message=>{const result=chain.then(()=>new Promise((resolve,reject)=>{if(closed||broken){reject(broken||Error('Native observer closed'));return;}pending={resolve,reject,timer:setTimeout(()=>{pending=null;broken=Error('Native observer response timeout');child.stdin.end();reject(broken);},5000)};child.stdin.write(JSON.stringify(message)+'\n',error=>{if(error&&pending){clearTimeout(pending.timer);pending=null;broken=error;child.stdin.end();reject(error);}});}));chain=result.catch(()=>{});return result;};
 let initialized;
 try{initialized=await request({action:'init',rootPid:roots[0].id,parentPid:process.pid,name:channel+'.exe'});assert.equal(initialized.root.pid,roots[0].id);assert.equal(initialized.root.parent,process.pid);assert.ok(/^\d+$/.test(initialized.root.startTicks));}
 catch(error){child.stdin.end();throw error;}
 return {root:{pid:initialized.root.pid,startTicks:initialized.root.startTicks},backend:initialized.backend,counter:initialized.counter,supplementary:initialized.supplementary,
  async sample(){return validateWindowsRows(await request({action:'sample'}));},
  async remaining(){return validateWindowsRows(await request({action:'remaining'}),{memory:false});},
  async close(){if(!closed){if(!broken)await request({action:'close'});child.stdin.end();if(!closed)await Promise.race([once(child,'exit'),new Promise((_,reject)=>{const timer=setTimeout(()=>reject(Error('Native observer did not exit')),5000);timer.unref();})]);}lines.close();assert.equal(exitCode,0,stderr);return {exitCode,stderr};}
 };
}
