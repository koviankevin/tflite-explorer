import test from 'node:test';
import assert from 'node:assert/strict';
import {storageErrorMessage} from '../src/storage-errors.js';
test('empty browser DOMException messages retain an actionable reason without inventing success',()=>{
    for(const [name,reason]of [['QuotaExceededError',/配額不足/],['SecurityError',/權限/],['InvalidStateError',/連線已關閉/],['AbortError',/尚未完成保存/]])assert.match(storageErrorMessage(new DOMException('',name)),reason);
    assert.equal(storageErrorMessage(new Error('specific failure')),'specific failure');assert.ok(storageErrorMessage({message:'x'.repeat(9999)}).length<=512);
});
