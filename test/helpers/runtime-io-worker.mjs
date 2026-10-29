import {parentPort,workerData} from 'node:worker_threads';
import {runtimeArchive} from '../../src/tflite-runtime-archive.js';
import {runtimeIOTransfers} from '../../src/runtime-io.js';
const large=workerData?.large===true,tensor={dtype:'float32',shape:[large?1048576:2],toTypedArray:()=>large?new Float32Array(1048576).fill(7):Float32Array.of(4,6)},detail={dtype:'float32',name:'public/input'},io=runtimeArchive({validation:{status:'passed'},inputs:[tensor],outputs:[tensor],inputDetails:[detail],outputDetails:[detail],specs:[{mode:'zero'}],modelSHA256:'a'.repeat(64),transferable:true});
parentPort.postMessage(io,runtimeIOTransfers(io));parentPort.postMessage({detached:io.archive.buffer.byteLength===0,bytes:io.archive.byteLength});parentPort.close();
