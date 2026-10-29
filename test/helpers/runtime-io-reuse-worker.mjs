import {parentPort} from 'node:worker_threads';
import {runtimeArchive} from '../../src/tflite-runtime-archive.js';
import {runtimeIOTransfers} from '../../src/runtime-io.js';
parentPort.once('message',data=>{
    const buffer=data.ioBuffer??null,provided=buffer!==null,zeroBefore=!buffer||new Uint8Array(buffer).every(n=>n===0),tensor={dtype:'float32',shape:[1048576],toTypedArray:()=>new Float32Array(1048576).fill(data.plan.round)},detail={dtype:'float32',name:'public'},io=runtimeArchive({validation:{status:'passed'},inputs:[tensor],outputs:[tensor],inputDetails:[detail],outputDetails:[detail],specs:[{mode:'zero'}],modelSHA256:'a'.repeat(64),transferable:true,ioBuffer:buffer});
    parentPort.postMessage({result:{status:'passed',io,scratch:{provided,zeroBefore,reused:!!buffer&&io.archive.buffer===buffer}}},runtimeIOTransfers(io));parentPort.close();
});
