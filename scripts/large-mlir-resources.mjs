import {readFile,statfs} from 'node:fs/promises';
import os from 'node:os';

export const GiB=1024**3;
export const HEX_MIB=2560;
export const SOURCE_BYTES=2684355495;
export const SOURCE_SHA256='91f73e977e3d7787657a11cfa9b8369da58249faed0b63ebbd5187105402d3b4';
export const PAYLOAD_SHA256='bee4d7dfdad770188e021938c81fd7d8e41e4e899f2a0fca4da0250822f0f560';
export const requirements={diskBytes:HEX_MIB*1024**2*3+GiB,memoryBytes:2*GiB};

const optionalRead=async file=>readFile(file,'utf8').catch(()=>null);
export function parseMemoryInfo(text) {
    const match=text?.match(/^MemAvailable:\s+(\d+) kB$/m);
    return match?Number(match[1])*1024:null;
}
export function resourceShortfalls(snapshot) {
    return Object.entries(requirements).filter(([key,value])=>snapshot[key]<value).map(([key])=>key);
}
export async function resources(directory) {
    const disk=await statfs(directory);
    const [meminfo,limit,current,events]=await Promise.all([
        optionalRead('/proc/meminfo'),optionalRead('/sys/fs/cgroup/memory.max'),
        optionalRead('/sys/fs/cgroup/memory.current'),optionalRead('/sys/fs/cgroup/memory.events')
    ]);
    const hostAvailable=parseMemoryInfo(meminfo)??os.freemem();
    const cgroupLimit=limit?.trim()!=='max'&&Number(limit)>0?Number(limit):null;
    const cgroupCurrent=current===null?null:Number(current);
    const cgroupAvailable=cgroupLimit!==null&&cgroupCurrent!==null?Math.max(0,cgroupLimit-cgroupCurrent):null;
    return {diskBytes:disk.bavail*disk.bsize,memoryBytes:Math.min(hostAvailable,cgroupAvailable??Infinity),
        hostAvailable,hostTotal:os.totalmem(),cgroupLimit,cgroupCurrent,
        // cgroup v2 evidence, when exposed; SIGKILL alone is not proof of OOM.
        oomKills:Number(events?.match(/^oom_kill (\d+)$/m)?.[1]??0)};
}
export function classifyFailure({stderr='',signal=null,oomBefore=0,oomAfter=0}) {
    if(/ENOSPC|EDQUOT|Insufficient free space|heap out of memory|ENOMEM|Cannot allocate memory/i.test(stderr) || oomAfter>oomBefore)
        return 'resource_exhausted';
    if(signal || /Command terminated by signal/.test(stderr))return 'interrupted_unknown';
    return 'verification_failed';
}
