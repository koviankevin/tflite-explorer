import assert from 'node:assert/strict';
// Exact serialized synthetic models, independently exercised by native LiteRT.
export const SOFTMAX_EXPECTATIONS=[
    [
        "SOFTMAX-bad-shape",
        "647b3b0cabb2ba61ebbbb559f78719735f538f49da99059af3d5adb066cf564c",
        "rejected",
        null
    ],
    [
        "SOFTMAX-bad-dtype",
        "021ca839908ab9a90f4ff24e3fdbcf10777a83e06f81a5a0f3b495b2c00df07a",
        "rejected",
        null
    ],
    [
        "LOG_SOFTMAX-bad-shape",
        "3893cca49832062c08659f29c4147f3424bab9e246314c095014a61451a2b5e3",
        "rejected",
        null
    ],
    [
        "LOG_SOFTMAX-bad-dtype",
        "77372d41e4307911f1eee312255b56b05237c617fbaa1c76444b12b813ac99f4",
        "rejected",
        null
    ],
    [
        "SOFTMAX-float",
        "d255fdd1d71f94f0046ef9ed58def823d1d4fb9950c6c35d620d878c9acd29cd",
        "passed",
        [
            0.09003057317038046,
            0.24472847105479764,
            0.6652409557748218,
            0.09003057317038046,
            0.24472847105479764,
            0.6652409557748218
        ]
    ],
    [
        "LOG_SOFTMAX-float",
        "07e4d7094ce190d4a6e5ac8c1695206971086baf369ca943b37ba7a31d516190",
        "passed",
        [
            -2.4076059644443806,
            -1.4076059644443804,
            -0.4076059644443804,
            -2.4076059644443806,
            -1.4076059644443804,
            -0.4076059644443804
        ]
    ],
    [
        "SOFTMAX-beta-0",
        "8694b78196ac37632f6edb908f6dc9d181ff292d918e22dcad7b5f62a6e5c4b6",
        "passed",
        [
            0.3333333333333333,
            0.3333333333333333,
            0.3333333333333333,
            0.3333333333333333,
            0.3333333333333333,
            0.3333333333333333
        ]
    ],
    [
        "SOFTMAX-beta--1",
        "5196e0aeb5be875a5a845fd121e71ee7022803b96dfb1839b3bde3e22faf5601",
        "passed",
        [
            0.6652409557748218,
            0.24472847105479764,
            0.09003057317038046,
            0.6652409557748218,
            0.24472847105479764,
            0.09003057317038046
        ]
    ],
    [
        "SOFTMAX-3-to-7",
        "311752a31711f8ccd55ef43c0655483c98a88f923fee5dfbe68b287ebecc0c98",
        "not-run",
        null
    ],
    [
        "SOFTMAX-9-to-7",
        "fe01588601ca8709cc9af433c522e5cb327772ef6a7d19a8623f15b3fd27ae97",
        "not-run",
        null
    ]
];
export function assertSoftmaxProof(proof){
    assert.ok(proof?.status==='passed'&&proof.modelWorkers===16&&proof.runtimeWorkers===4&&proof.downloads===16&&proof.allWorkersClosed===true&&proof.cases?.length===10,'missing Softmax validation proof.');
    for(const [i,[name,hash,status,expected]]of SOFTMAX_EXPECTATIONS.entries()){
        const c=proof.cases[i];assert.ok(c?.name===name&&c.modelSHA256===hash&&c.status===status,'invalid Softmax model or validation status.');
        if(status==='rejected'){
            assert.ok(c.runtimeWorkers===0&&c.downloads===0&&typeof c.preflight==='string'&&/subgraph 0.*OP #0.*SOFTMAX/.test(c.preflight)&&typeof c.error==='string'&&/Subgraph #0.*OP #0.*SOFTMAX/.test(c.error),'missing Softmax export/runtime rejection.');
        }else{
            assert.ok(c.operators===2&&c.reopened===true&&c.quantizationPreserved===true&&c.byteComparison==='not-applicable'&&/^[a-f0-9]{64}$/.test(c.outputSHA256)&&c.automaticRuntime===false,'missing Softmax edit/reopen proof.');
            if(expected){
                assert.ok(c.inputsMatch===true&&c.numericMatches===true&&/^[a-f0-9]{64}$/.test(c.zipSHA256),'missing Softmax raw BIN or numeric proof.');assert.deepEqual(c.expected,expected);assert.equal(c.output?.length,expected.length);
                c.output.forEach((v,j)=>assert.ok(typeof v==='number'&&Number.isFinite(v)&&Math.abs(v-expected[j])<=1e-6,'incorrect Softmax numerical output.'));
            }
        }
    }
}
