import assert from 'node:assert/strict';
import {RUNTIME_ENGINE,RUNTIME_INTERPRETER_ENGINE} from '../../src/tflite-runtime-policy.js';
export const VALUE_SHAPE_EXPECTATIONS=[
    ['TRANSPOSE-input','39a925781e302a0305208c7c8ee29c69184edc4efc872a7a13260793957ba3ba',[1,4,2,5,3,6],[3,2],true],
    ['TRANSPOSE-constant','c99def9a4ffb55499bedfcb402fb1d62d5879074a4ecbb052b3c9677cec227a3',[1,4,2,5,3,6],[3,2],false],
    ['EXPAND_DIMS-input','d893f4e3e905180668291841b28583767c579f1c88dbc63419e08beb9258e603',[1,2,3,4,5,6],[2,1,3],true],
    ['EXPAND_DIMS-constant','b43e3da21000435f15c694967a26025412934174fd901a3ad2b189b89f49d0b7',[1,2,3,4,5,6],[2,1,3],false],
    ['RESHAPE-input','54102148da445460369f73afee102772a1874edb3e5a221225b0882d243ff76b',[1,2,3,4,5,6],[3,2],true],
    ['RESHAPE-constant','cde597890ec340cb9d7e0b27ddf54a1e90d289c8df80a9439493a6b431afae71',[1,2,3,4,5,6],[3,2],false],
    ['GATHER-integer-input-control','374697f6d4b29a7fd50bd5b925e49e8fb27406868865151c5b398303055ae22d',[3,1],[2],false],
    ['ADD-integer-input-control','7273f0d9d3e6376c3f2c400e65bc9655109ed665fe2e7da600d0c19cef01834b',[11,22],[2],false]
];
export function assertValueShapeProof(proof){
    assert.ok(proof?.status==='passed'&&proof.modelWorkers===8&&proof.runtimeWorkers===8&&proof.downloads===8&&proof.cases?.length===8,'missing value-dependent shape runtime proof.');
    for(const [i,[name,hash,output,shape,interpreter]]of VALUE_SHAPE_EXPECTATIONS.entries()){
        const c=proof.cases[i];
        assert.ok(c.name===name&&c.modelSHA256===hash&&c.engine===(interpreter?RUNTIME_INTERPRETER_ENGINE:RUNTIME_ENGINE)&&c.status==='passed'&&c.inputsMatch===true&&c.numericMatches===true&&c.automaticRuntime===false&&/^[a-f0-9]{64}$/.test(c.zipSHA256),'invalid value-dependent shape model, engine or IO proof.');
        assert.deepEqual(c.expected,output);assert.deepEqual(c.output,output);assert.deepEqual(c.outputShape,shape);
    }
}
