import {readFile,readdir} from 'node:fs/promises';

export function parseProcProcess(pid,status,stat){
    const at=stat.lastIndexOf(')'),fields=stat.slice(at+1).trim().split(/\s+/),rss=status.match(/^VmRSS:\s+(\d+)\s+kB$/m);
    if(!Number.isSafeInteger(pid)||pid<=0||at<0||Number(stat.slice(0,stat.indexOf('(')).trim())!==pid||fields.length<20||!/^\d+$/.test(fields[19])||!Number.isSafeInteger(Number(fields[1]))||Number(fields[1])<0||!/^\w$/.test(fields[0]))throw Error('Invalid /proc process identity.');
    return {pid,parent:Number(fields[1]),startTicks:fields[19],state:fields[0],rssBytes:rss?Number(rss[1])*1024:0};
}
export async function readProcessTable(){
    if(process.platform!=='linux')throw Error('Owned process RSS requires isolated Linux CI.');
    const ids=(await readdir('/proc')).filter(id=>/^\d+$/.test(id));if(ids.length>16384)throw Error('Process table exceeds the observation budget.');
    return (await Promise.all(ids.map(async id=>{
        try{const [status,stat]=await Promise.all([readFile(`/proc/${id}/status`,'utf8'),readFile(`/proc/${id}/stat`,'utf8')]);return status&&stat?parseProcProcess(Number(id),status,stat):null;}
        catch(error){if(['ENOENT','ESRCH'].includes(error.code))return null;throw error;}
    }))).filter(Boolean);
}
export async function findOwnedBrowserRoot(rows,parentPid,marker,readEnvironment=pid=>readFile(`/proc/${pid}/environ`,'utf8')){
    if(!Number.isSafeInteger(parentPid)||parentPid<=0||!/^[a-f0-9]{32}$/.test(marker))throw Error('Missing launch ownership marker.');
    const matches=[];
    // Only inspect children of this test's Node process, never arbitrary user
    // process environments. Return identity metadata, no environment contents.
    for(const row of rows.filter(r=>r.parent===parentPid&&r.state!=='Z')){
        try{if((await readEnvironment(row.pid)).split('\0').includes('MODEL_LENS_PHYSICAL_OWNER='+marker))matches.push(row);}
        catch(error){if(!['ENOENT','ESRCH'].includes(error.code))throw Error('Cannot verify owned browser child.');}
    }
    if(matches.length!==1)throw Error('Expected one directly owned browser root.');
    return {pid:matches[0].pid,startTicks:matches[0].startTicks};
}
const key=row=>`${row.pid}:${row.startTicks}`;
export class OwnedProcessTree {
    #root;#known=new Map();
    constructor(root){if(!root||!Number.isSafeInteger(root.pid)||root.pid<=0||!/^\d+$/.test(root.startTicks))throw Error('Missing owned root process identity.');this.#root={pid:root.pid,startTicks:root.startTicks};this.#known.set(key(root),this.#root);}
    get identities(){return [...this.#known.values()].map(row=>({...row}));}
    sample(rows){
        if(!Array.isArray(rows)||!rows.some(row=>key(row)===key(this.#root)&&row.rssBytes>0&&row.state!=='Z'))throw Error('Owned browser root disappeared or its PID was reused.');
        const owned=new Set(rows.filter(row=>this.#known.has(key(row))).map(row=>row.pid));
        for(let size=-1;size!==owned.size;){size=owned.size;for(const row of rows)if(owned.has(row.parent))owned.add(row.pid);}
        const selected=rows.filter(row=>owned.has(row.pid));
        for(const row of selected){if(!Number.isFinite(row.rssBytes)||row.rssBytes<0)throw Error('Missing owned process RSS.');this.#known.set(key(row),{pid:row.pid,startTicks:row.startTicks});}
        if(this.#known.size>1024)throw Error('Owned process identities exceed the observation budget.');
        const rssBytes=selected.reduce((n,row)=>n+row.rssBytes,0);if(rssBytes<=0)throw Error('Owned browser RSS unavailable.');
        return {rssBytes,processes:selected.length};
    }
    remaining(rows){return rows.filter(row=>this.#known.has(key(row))).map(row=>({...row}));}
}
