import test from 'node:test';
import assert from 'node:assert/strict';
import {GiB,requirements,parseMemoryInfo,resourceShortfalls,classifyFailure} from '../scripts/large-mlir-resources.mjs';

test('large MLIR preflight requires disk headroom and available memory independently',()=>{
    assert.deepEqual(resourceShortfalls(requirements),[]);
    assert.deepEqual(resourceShortfalls({...requirements,diskBytes:5*GiB}),['diskBytes']);
    assert.deepEqual(resourceShortfalls({...requirements,memoryBytes:GiB}),['memoryBytes']);
    assert.deepEqual(resourceShortfalls({diskBytes:0,memoryBytes:0}),['diskBytes','memoryBytes']);
    assert.equal(parseMemoryInfo('MemTotal: 10000 kB\nMemAvailable:   1234 kB\n'),1234*1024);
    assert.equal(parseMemoryInfo(null),null);
});
test('resource failures are separate from assertions and unproven SIGKILL',()=>{
    for(const stderr of ['ENOSPC: write','ENOMEM','FATAL ERROR: Reached heap limit Allocation failed - JavaScript heap out of memory'])
        assert.equal(classifyFailure({stderr}),'resource_exhausted');
    assert.equal(classifyFailure({oomBefore:2,oomAfter:3}),'resource_exhausted');
    assert.equal(classifyFailure({signal:'SIGKILL'}),'interrupted_unknown');
    assert.equal(classifyFailure({stderr:'Command terminated by signal 9'}),'interrupted_unknown');
    assert.equal(classifyFailure({stderr:'AssertionError: payload hash mismatch'}),'verification_failed');
});
